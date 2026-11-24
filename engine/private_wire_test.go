package main

import (
	"bufio"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/anacrolix/dht/v2"
	"github.com/anacrolix/dht/v2/krpc"
	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
	pp "github.com/anacrolix/torrent/peer_protocol"
)

func newPrivateWireClient(t *testing.T, registry *privateRegistry, configure func(*torrent.ClientConfig)) *torrent.Client {
	t.Helper()
	cfg := peerConfig()
	cfg.DataDir = t.TempDir()
	cfg.PeriodicallyAnnounceTorrentsToDht = false
	cfg.DhtStartingNodes = func(string) dht.StartingNodesGetter {
		return func() ([]dht.Addr, error) { return nil, nil }
	}
	registry.configure(cfg)
	if configure != nil {
		configure(cfg)
	}
	client, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	for _, listener := range client.Listeners() {
		if packet, ok := listener.(net.PacketConn); ok {
			if err := registry.attachDHT(client, packet); err != nil {
				t.Fatal(err)
			}
		}
	}
	if len(client.DhtServers()) != 1 {
		t.Fatalf("expected one loopback DHT listener, got %d", len(client.DhtServers()))
	}
	return client
}

func TestPrivateWireDHTRejectsOnlyPrivateHash(t *testing.T) {
	var registry privateRegistry
	meta := &metainfo.MetaInfo{InfoBytes: bencode.MustMarshal(metainfo.Info{Name: "Private.Test", PieceLength: 16 << 10})}
	privateHash := meta.HashInfoBytes()
	registry.registerMeta(meta)
	publicHash := metainfo.Hash{2}
	client := newPrivateWireClient(t, &registry, nil)
	server := client.DhtServers()[0]
	_, _ = client.AddTorrentInfoHash(privateHash)
	_, _ = client.AddTorrentInfoHash(publicHash)

	announce, err := server.Announce(privateHash, client.LocalPort(), false)
	if err != nil {
		t.Fatal(err)
	}
	defer announce.Close()
	select {
	case _, ok := <-announce.Peers():
		if ok {
			t.Fatal("private DHT announce returned peers")
		}
	default:
		t.Fatal("private DHT announce was started")
	}

	probe, err := net.DialUDP("udp4", nil, server.Addr().(*net.UDPAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Close()
	for _, method := range []string{"get_peers", "announce_peer"} {
		query := krpc.Msg{
			Y: krpc.YQuery, Q: method, T: method,
			A: &krpc.MsgArgs{ID: krpc.ID{3}, InfoHash: krpc.ID(privateHash)},
		}
		if _, err := probe.Write(bencode.MustMarshal(query)); err != nil {
			t.Fatal(err)
		}
		if err := probe.SetReadDeadline(time.Now().Add(250 * time.Millisecond)); err != nil {
			t.Fatal(err)
		}
		for {
			response, err := receiveWireDHT(probe)
			if err != nil {
				requireWireTimeout(t, err)
				break
			}
			// A bootstrap query can arrive at the same test socket independently.
			if response.T == query.T && response.Y != krpc.YQuery ||
				response.A != nil && response.A.InfoHash == krpc.ID(privateHash) {
				t.Fatalf("unexpected DHT traffic for the private hash: %+v", response)
			}
		}
	}

	public := krpc.Msg{
		Y: krpc.YQuery, Q: "get_peers", T: "public",
		A: &krpc.MsgArgs{ID: krpc.ID{3}, InfoHash: krpc.ID(publicHash)},
	}
	if _, err := probe.Write(bencode.MustMarshal(public)); err != nil {
		t.Fatal(err)
	}
	readWireDHT(t, probe, 2*time.Second, func(response krpc.Msg) bool {
		return response.Y == krpc.YResponse && response.T == public.T
	})
}

func TestPrivateWireSuppressesPortAndPeerExchange(t *testing.T) {
	var registry privateRegistry
	meta := &metainfo.MetaInfo{InfoBytes: bencode.MustMarshal(metainfo.Info{Name: "Private.Wire", PieceLength: 16 << 10})}
	privateHash := meta.HashInfoBytes()
	registry.registerMeta(meta)
	publicHash := metainfo.Hash{4}
	remoteExtensions := make(chan [2]bool, 2)
	client := newPrivateWireClient(t, &registry, func(cfg *torrent.ClientConfig) {
		observe := cfg.Callbacks.ReadExtendedHandshake
		cfg.Callbacks.ReadExtendedHandshake = func(peer *torrent.PeerConn, hello *pp.ExtendedHandshakeMessage) {
			observe(peer, hello)
			remoteExtensions <- [2]bool{hello.M[pp.ExtensionNamePex] != 0, hello.M["ut_holepunch"] != 0}
		}
	})
	_, _ = client.AddTorrentInfoHash(privateHash)
	_, _ = client.AddTorrentInfoHash(publicHash)
	portReceiver, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IP{127, 0, 0, 1}})
	if err != nil {
		t.Fatal(err)
	}
	defer portReceiver.Close()
	for _, tc := range []struct {
		hash    metainfo.Hash
		private bool
	}{
		{privateHash, true},
		{publicHash, false},
	} {
		conn := connectWirePeer(t, client, tc.hash)
		var hello pp.ExtendedHandshakeMessage
		decoder := pp.Decoder{R: bufio.NewReader(conn), MaxLength: 1 << 16}
		var initial pp.Message
		if err := decoder.Decode(&initial); err != nil {
			t.Fatal(err)
		}
		if initial.Type != pp.Extended || initial.ExtendedID != pp.HandshakeExtendedID {
			t.Fatalf("expected extended handshake, got %v", initial.Type)
		}
		if err := bencode.Unmarshal(initial.ExtendedPayload, &hello); err != nil {
			t.Fatal(err)
		}
		if hello.M[pp.ExtensionNameMetadata] == 0 || (hello.M[pp.ExtensionNamePex] == 0) != tc.private ||
			(hello.M["ut_holepunch"] == 0) != tc.private {
			t.Fatalf("private=%v advertised unexpected extensions: %v", tc.private, hello.M)
		}
		writeWireMessage(t, conn, pp.Message{Type: pp.Port, Port: uint16(portReceiver.LocalAddr().(*net.UDPAddr).Port)})
		writeWireMessage(t, conn, pp.Message{
			Type:       pp.Extended,
			ExtendedID: pp.HandshakeExtendedID,
			ExtendedPayload: bencode.MustMarshal(pp.ExtendedHandshakeMessage{
				M: map[pp.ExtensionName]pp.ExtensionNumber{
					pp.ExtensionNamePex: 77, "ut_holepunch": 78,
				},
			}),
		})
		select {
		case offered := <-remoteExtensions:
			if offered != [2]bool{!tc.private, !tc.private} {
				t.Fatalf("private=%v remote extension handling = %v", tc.private, offered)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("peer handshake was not handled")
		}

		if tc.private {
			if err := portReceiver.SetReadDeadline(time.Now().Add(250 * time.Millisecond)); err != nil {
				t.Fatal(err)
			}
			_, err := portReceiver.Read(make([]byte, 2048))
			requireWireTimeout(t, err)
			if err := conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond)); err != nil {
				t.Fatal(err)
			}
			for {
				var msg pp.Message
				err := decoder.Decode(&msg)
				if err != nil {
					requireWireTimeout(t, err)
					break
				}
				if msg.Type == pp.Port || msg.Type == pp.Extended && (msg.ExtendedID == 77 || msg.ExtendedID == 78) {
					t.Fatalf("private connection sent forbidden message: %+v", msg)
				}
			}
		} else {
			readWireDHT(t, portReceiver, 2*time.Second, func(response krpc.Msg) bool {
				return response.Q == "ping" && response.Y == krpc.YQuery
			})
			for {
				var msg pp.Message
				if err := decoder.Decode(&msg); err != nil {
					t.Fatal(err)
				}
				if msg.Type == pp.Port && msg.Port != 0 {
					break
				}
			}
		}
		_ = conn.Close()
	}
}

func connectWirePeer(t *testing.T, client *torrent.Client, hash metainfo.Hash) net.Conn {
	t.Helper()
	var addr string
	for _, address := range client.ListenAddrs() {
		if address.Network() == "tcp" {
			addr = address.String()
			break
		}
	}
	conn, err := net.DialTimeout("tcp4", addr, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := conn.SetDeadline(time.Now().Add(4 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var bits pp.PeerExtensionBits
	bits.SetBit(pp.ExtensionBitLtep, true)
	bits.SetBit(pp.ExtensionBitDht, true)
	if _, err := pp.Handshake(t.Context(), conn, &hash, [20]byte{5}, bits); err != nil {
		t.Fatal(err)
	}
	return conn
}

func writeWireMessage(t *testing.T, conn net.Conn, msg pp.Message) {
	t.Helper()
	packet, err := msg.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write(packet); err != nil {
		t.Fatal(err)
	}
}

func readWireDHT(t *testing.T, conn *net.UDPConn, timeout time.Duration, accept func(krpc.Msg) bool) {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		t.Fatal(err)
	}
	for {
		message, err := receiveWireDHT(conn)
		if err != nil {
			t.Fatal(err)
		}
		if accept(message) {
			return
		}
	}
}

func receiveWireDHT(conn *net.UDPConn) (krpc.Msg, error) {
	packet := make([]byte, 2048)
	n, err := conn.Read(packet)
	if err != nil {
		return krpc.Msg{}, err
	}
	var decoded krpc.Msg
	err = bencode.Unmarshal(packet[:n], &decoded)
	return decoded, err
}

func requireWireTimeout(t *testing.T, err error) {
	t.Helper()
	var netErr net.Error
	if !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Fatalf("expected a read timeout, got %v", err)
	}
}
