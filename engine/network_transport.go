package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/dialer"
	"github.com/anacrolix/utp"
)

type boundTransport struct {
	*socketScope
	device    guardedInterface
	iface     string
	port      int
	stopped   chan struct{}
	ctx       context.Context
	cancel    context.CancelFunc
	stopOnce  sync.Once
	listeners []boundPeerListener
}

type boundPeerListener struct {
	tcp     net.Listener
	udp     *utp.Socket
	network string
}

type socketScope struct {
	mu     sync.Mutex
	closed bool
	open   map[io.Closer]struct{}
}

func (s *socketScope) add(socket io.Closer) (func(), error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		_ = socket.Close()
		return nil, net.ErrClosed
	}
	s.open[socket] = struct{}{}
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.open, socket)
		s.mu.Unlock()
	}, nil
}

func (s *socketScope) close() {
	s.mu.Lock()
	s.closed = true
	destinations := s.open
	s.open = nil
	s.mu.Unlock()
	for socket := range destinations {
		_ = socket.Close()
	}
}

type trackedNetworkConn struct {
	net.Conn
	remove func()
}

func (c *trackedNetworkConn) Close() error {
	defer c.remove()
	return c.Conn.Close()
}

type trackedNetworkUDP struct {
	*net.UDPConn
	remove func()
}

func (c *trackedNetworkUDP) Close() error {
	defer c.remove()
	return c.UDPConn.Close()
}

type trackedNetworkPacket struct {
	net.PacketConn
	remove func()
}

func (c *trackedNetworkPacket) Close() error {
	defer c.remove()
	return c.PacketConn.Close()
}

type boundPeerAccept struct {
	net.Listener
	scope        *socketScope
	clientClosed <-chan struct{}
	stopped      <-chan struct{}
}

func (l boundPeerAccept) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		// anacrolix повторяет Accept сразу. Временные ошибки пережидаем,
		// при закрытии транспорта ждём завершения всего клиента.
		timer := time.NewTimer(100 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-l.clientClosed:
		case <-l.stopped:
			<-l.clientClosed
		case <-timer.C:
		}
		return nil, err
	}
	remove, err := l.scope.add(conn)
	if err != nil {
		<-l.clientClosed
		return nil, err
	}
	return &trackedNetworkConn{Conn: conn, remove: remove}, nil
}

func openBoundTransport(parent context.Context, iface string, device guardedInterface, port int) (*boundTransport, error) {
	ctx, cancel := context.WithCancel(parent)
	b := &boundTransport{
		socketScope: &socketScope{open: make(map[io.Closer]struct{})},
		device:      device, iface: iface, port: port, stopped: make(chan struct{}),
		ctx: ctx, cancel: cancel,
	}
	for _, family := range []struct {
		ip      netip.Addr
		version string
	}{{device.IPv4, "4"}, {device.IPv6, "6"}} {
		if !family.ip.IsValid() {
			continue
		}
		pc, err := b.packet("udp"+family.version, net.JoinHostPort(family.ip.String(), strconv.Itoa(b.port)))
		if err != nil {
			b.stop()
			return nil, err
		}
		if b.port == 0 {
			b.port = pc.LocalAddr().(*net.UDPAddr).Port
		}
		udp, err := utp.NewSocketFromPacketConn(pc)
		if err != nil {
			b.stop()
			return nil, err
		}
		listen := &net.ListenConfig{Control: bindSocketControl(b.iface, b.device.IPv4, b.device.IPv6, false)}
		tcp, err := listen.Listen(ctx, "tcp"+family.version, net.JoinHostPort(family.ip.String(), strconv.Itoa(b.port)))
		if err != nil {
			b.stop()
			return nil, err
		}
		// The listening socket is registered for closing, not discarded on Accept.
		if _, err := b.add(tcp); err != nil {
			b.stop()
			return nil, err
		}
		b.listeners = append(b.listeners, boundPeerListener{tcp: tcp, udp: udp, network: family.version})
	}
	return b, nil
}

func (b *boundTransport) stop() {
	b.stopOnce.Do(func() {
		b.cancel()
		b.socketScope.close()
		close(b.stopped)
	})
}

func (b *boundTransport) dial(ctx context.Context, network, address string) (net.Conn, error) {
	if b.ctx.Err() != nil {
		return nil, net.ErrClosed
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(b.ctx, cancel)
	defer stop()
	dialer := net.Dialer{Control: bindSocketControl(b.iface, b.device.IPv4, b.device.IPv6, true), KeepAlive: -1}
	conn, err := dialer.DialContext(ctx, network, address)
	if err != nil {
		return nil, err
	}
	remove, err := b.add(conn)
	if err != nil {
		return nil, err
	}
	if udp, ok := conn.(*net.UDPConn); ok {
		// Go DNS распознаёт UDP по реализации net.PacketConn.
		return &trackedNetworkUDP{UDPConn: udp, remove: remove}, nil
	}
	return &trackedNetworkConn{Conn: conn, remove: remove}, nil
}

func (b *boundTransport) packet(network, address string) (net.PacketConn, error) {
	if b.ctx.Err() != nil {
		return nil, net.ErrClosed
	}
	listen := net.ListenConfig{Control: bindSocketControl(b.iface, b.device.IPv4, b.device.IPv6, false)}
	packet, err := listen.ListenPacket(b.ctx, network, address)
	if err != nil {
		return nil, err
	}
	remove, err := b.add(packet)
	if err != nil {
		return nil, err
	}
	return &trackedNetworkPacket{PacketConn: packet, remove: remove}, nil
}

func (b *boundTransport) configure(cfg *torrent.ClientConfig) {
	cfg.DisableTCP = true
	cfg.DisableUTP = true
	cfg.NoDHT = true
	cfg.DisableIPv4 = !b.device.IPv4.IsValid()
	cfg.DisableIPv6 = !b.device.IPv6.IsValid()
	cfg.DisableWebtorrent = true
	cfg.NoDefaultPortForwarding = true
	cfg.TrackerDialContext = b.dial
	cfg.HTTPDialContext = b.dial
	cfg.TrackerListenPacket = func(network, _ string) (net.PacketConn, error) {
		ip := b.device.IPv4
		if network == "udp6" || network == "udp" && !ip.IsValid() {
			ip = b.device.IPv6
		}
		if !ip.IsValid() {
			return closedTrackerSocket{}, nil
		}
		family := "udp4"
		if ip.Is6() {
			family = "udp6"
		}
		pc, err := b.packet(family, net.JoinHostPort(ip.String(), "0"))
		if err != nil {
			// v1.61 паникует при ошибке из TrackerListenPacket.
			b.stop()
			return closedTrackerSocket{}, nil
		}
		return pc, nil
	}
	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			if explicit := os.Getenv("ENGINE_BIND_DNS"); explicit != "" {
				address = net.JoinHostPort(explicit, "53")
			}
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ip, err := netip.ParseAddr(host)
			if err != nil || !ip.IsGlobalUnicast() {
				return nil, errors.New("network binding needs a DNS server reachable through the chosen interface")
			}
			return b.dial(ctx, network, address)
		},
	}
}

func (b *boundTransport) attach(client *torrent.Client, dht bool) error {
	for _, socket := range b.listeners {
		if dht {
			server, err := client.NewAnacrolixDhtServer(socket.udp)
			if err != nil {
				return err
			}
			client.AddDhtServer(torrent.AnacrolixDhtServerWrapper{Server: server})
			go func() {
				<-client.Closed()
				server.Close()
			}()
		}
		client.AddListener(boundPeerAccept{Listener: socket.tcp, scope: b.socketScope, clientClosed: client.Closed(), stopped: b.stopped})
		client.AddDialer(dialer.WithNetwork{Network: "tcp" + socket.network, Dialer: boundTCPDialer{binding: b}})
		client.AddListener(boundPeerAccept{Listener: socket.udp, scope: b.socketScope, clientClosed: client.Closed(), stopped: b.stopped})
		client.AddDialer(boundUTPDialer{socket: socket.udp, family: socket.network})
	}
	return nil
}

type boundTCPDialer struct{ binding *boundTransport }

func (d boundTCPDialer) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	return d.binding.dial(ctx, network, addr)
}

type boundUTPDialer struct {
	socket *utp.Socket
	family string
}

func (d boundUTPDialer) DialerNetwork() string { return "udp" + d.family }

func (d boundUTPDialer) Dial(ctx context.Context, address string) (net.Conn, error) {
	return d.socket.DialContext(ctx, "udp"+d.family, address)
}

type closedTrackerSocket struct{}

func (closedTrackerSocket) LocalAddr() net.Addr                    { return &net.UDPAddr{} }
func (closedTrackerSocket) ReadFrom([]byte) (int, net.Addr, error) { return 0, nil, net.ErrClosed }
func (closedTrackerSocket) WriteTo([]byte, net.Addr) (int, error)  { return 0, net.ErrClosed }
func (closedTrackerSocket) Close() error                           { return nil }
func (closedTrackerSocket) SetDeadline(time.Time) error            { return net.ErrClosed }
func (closedTrackerSocket) SetReadDeadline(time.Time) error        { return net.ErrClosed }
func (closedTrackerSocket) SetWriteDeadline(time.Time) error       { return net.ErrClosed }

func (b *boundTransport) watch(ctx context.Context) bool {
	ticker := time.NewTicker(networkPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-b.stopped:
			return ctx.Err() == nil
		case <-ticker.C:
			device, state := interfaceForBinding(b.iface)
			if state != "bound" || device != b.device {
				b.stop()
				return true
			}
		}
	}
}

// Fetching a snapshot in offline mode can install the next generation's
// firewall rules, but only a fresh client can open its transports.
func networkHandler(iface string, init guardResponse) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		reply := networkBinding{
			BindInterface: iface, Status: init.Status, Interfaces: listNetworkInterfaces(),
		}
		if init.Status == "bound" {
			reply.BoundIPv4 = statusAddress(init.Device.IPv4)
			reply.BoundIPv6 = statusAddress(init.Device.IPv6)
		}
		if iface != "" && init.Status != "bound" {
			current := authorizeBinding(req.Context(), iface)
			reply.Recoverable = current.Status == "bound" && init.Status != "unsupported"
			if current.Status != "bound" {
				reply.Status = current.Status
			}
		}
		writeJSON(w, http.StatusOK, reply)
	}
}
