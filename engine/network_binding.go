package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"os"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/anacrolix/torrent"
)

const (
	networkGuardDefault = "/run/torsher-network/guard.sock"
	networkPollInterval = 2 * time.Second
)

var errNetworkChanged = errors.New("network binding changed")

type interfaceAddresses struct {
	Name     string   `json:"name"`
	Up       bool     `json:"up"`
	Loopback bool     `json:"loopback"`
	IPv4     []string `json:"ipv4"`
	IPv6     []string `json:"ipv6"`
}

type networkBinding struct {
	BindInterface string               `json:"bindInterface"`
	Status        string               `json:"status"`
	BoundIPv4     *string              `json:"boundIpv4"`
	BoundIPv6     *string              `json:"boundIpv6"`
	Recoverable   bool                 `json:"recoverable"`
	Interfaces    []interfaceAddresses `json:"interfaces"`
}

type guardedInterface struct {
	Index int        `json:"index"`
	IPv4  netip.Addr `json:"ipv4"`
	IPv6  netip.Addr `json:"ipv6"`
}

type guardRequest struct {
	Interface string `json:"interface"`
}
type guardResponse struct {
	Namespace string           `json:"namespace"`
	Status    string           `json:"status"`
	Device    guardedInterface `json:"device"`
}

func interfaceIPs(iface net.Interface) ([]string, []string) {
	v4 := []string{}
	v6 := []string{}
	addrs, _ := iface.Addrs()
	for _, address := range addrs {
		prefix, err := netip.ParsePrefix(address.String())
		if err != nil {
			continue
		}
		ip := prefix.Addr().Unmap()
		if !ip.IsGlobalUnicast() {
			continue
		}
		if ip.Is4() {
			v4 = append(v4, ip.String())
		} else {
			v6 = append(v6, ip.String())
		}
	}
	slices.Sort(v4)
	slices.Sort(v6)
	return slices.Compact(v4), slices.Compact(v6)
}

func interfaceForBinding(name string) (guardedInterface, string) {
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return guardedInterface{}, "missing"
	}
	if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
		return guardedInterface{}, "down"
	}
	v4, v6 := interfaceIPs(*iface)
	device := guardedInterface{Index: iface.Index}
	if len(v4) != 0 {
		device.IPv4 = netip.MustParseAddr(v4[0])
	}
	if len(v6) != 0 {
		device.IPv6 = netip.MustParseAddr(v6[0])
	}
	if !device.IPv4.IsValid() && !device.IPv6.IsValid() {
		return guardedInterface{}, "down"
	}
	return device, "bound"
}

func listNetworkInterfaces() []interfaceAddresses {
	interfaces := []interfaceAddresses{}
	all, _ := net.Interfaces()
	for _, iface := range all {
		v4, v6 := interfaceIPs(iface)
		interfaces = append(interfaces, interfaceAddresses{
			Name: iface.Name, Up: iface.Flags&net.FlagUp != 0,
			Loopback: iface.Flags&net.FlagLoopback != 0, IPv4: v4, IPv6: v6,
		})
	}
	return interfaces
}

func guardSocketPath() string {
	if value := os.Getenv("ENGINE_BIND_GUARD_SOCKET"); value != "" {
		return value
	}
	return networkGuardDefault
}

func authorizeBinding(ctx context.Context, name string) guardResponse {
	if !bindingSupported() || !validBindInterface(name) {
		return guardResponse{Status: "unsupported"}
	}
	expected, status := interfaceForBinding(name)
	if status != "bound" {
		return guardResponse{Status: status}
	}
	namespace, err := os.Readlink("/proc/self/ns/net")
	if err != nil {
		return guardResponse{Status: "unsupported"}
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	conn, err := (&net.Dialer{}).DialContext(ctx, "unix", guardSocketPath())
	if err != nil {
		return guardResponse{Status: "permission_denied"}
	}
	defer conn.Close()
	if uid, err := guardPeerUID(conn); err != nil || uid != 0 {
		return guardResponse{Status: "permission_denied"}
	}
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)
	if err := json.NewEncoder(conn).Encode(guardRequest{Interface: name}); err != nil {
		return guardResponse{Status: "permission_denied"}
	}
	var reply guardResponse
	if json.NewDecoder(conn).Decode(&reply) != nil || reply.Namespace != namespace {
		return guardResponse{Status: "permission_denied"}
	}
	if reply.Status == "bound" && reply.Device != expected {
		return guardResponse{Status: "changed"}
	}
	return reply
}

func makeClientOffline(cfg *torrent.ClientConfig) {
	cfg.DisableTCP = true
	cfg.DisableUTP = true
	cfg.NoDHT = true
	cfg.DisableTrackers = true
	cfg.DisableWebtorrent = true
	cfg.DisableWebseeds = true
	cfg.NoDefaultPortForwarding = true
	cfg.AcceptPeerConnections = false
	cfg.DialForPeerConns = false
	cfg.WebTransport = offlineTransport{}
	cfg.MetainfoSourcesClient = &http.Client{Transport: offlineTransport{}}
}

type offlineTransport struct{}

func (offlineTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, net.ErrClosed
}

func statusAddress(ip netip.Addr) *string {
	if !ip.IsValid() {
		return nil
	}
	value := ip.String()
	return &value
}

func validBindInterface(name string) bool {
	return len(name) > 0 && len(name) <= 15 && name != "." && name != ".." && strings.IndexFunc(name, func(ch rune) bool {
		return !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || strings.ContainsRune("._@-", ch))
	}) == -1
}

func bindFailureStatus(err error) string {
	if errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EACCES) {
		return "permission_denied"
	}
	return "changed"
}
