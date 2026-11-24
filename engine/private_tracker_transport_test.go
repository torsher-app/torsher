package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/tracker"
	"github.com/anacrolix/torrent/tracker/udp"
)

func TestPrivateTrackerHTTPUsesBoundDialerAndValidatesTLS(t *testing.T) {
	req := tracker.AnnounceRequest{InfoHash: [20]byte{1}, Event: tracker.Completed}
	var gotQuery atomic.Bool
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery.Store(strings.HasPrefix(r.URL.RawQuery, "keyphrase=test-token&") &&
			r.URL.Query().Get("left") == "0" &&
			r.URL.Query().Get("event") == "completed" &&
			r.URL.Query().Get("info_hash") == string(req.InfoHash[:]))
		_, _ = w.Write([]byte("d8:intervali1800e5:peers6:\x7f\x00\x00\x01\x30\x39e"))
	}))
	defer server.Close()

	var dials atomic.Int32
	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		dials.Add(1)
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	}
	endpoint := server.URL + "/announce?keyphrase=test-token"
	a, code := newPrivateAnnouncer(endpoint, dial)
	if code != "" {
		t.Fatal(code)
	}
	defer a.close()
	if _, code := a.announce(t.Context(), req); code != trackerTLSFailure {
		t.Fatalf("untrusted TLS code = %q", code)
	}
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	trusted, code := newPrivateAnnouncer(endpoint, dial)
	if code != "" {
		t.Fatal(code)
	}
	defer trusted.close()
	trusted.http.Transport.(*http.Transport).TLSClientConfig = &tls.Config{RootCAs: roots}
	result, code := trusted.announce(t.Context(), req)
	if code != "" || result.Interval != 1800 || len(result.Peers) != 1 || result.Peers[0].Port != 12345 ||
		!gotQuery.Load() || dials.Load() != 2 {
		t.Fatalf("trusted TLS code=%q result=%+v query=%v dials=%d", code, result, gotQuery.Load(), dials.Load())
	}
}

func TestPrivateTrackerHTTPKeepsCredentialsAtFirstEndpoint(t *testing.T) {
	var redirected atomic.Int32
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected.Add(1)
	}))
	defer second.Close()
	const token = "test-credential"
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch strings.TrimPrefix(r.URL.Path, "/"+token+"/") {
		case "redirect":
			http.Redirect(w, r, second.URL+"/"+token, http.StatusFound)
		case "error":
			http.Error(w, token, http.StatusInternalServerError)
		case "rejected":
			_, _ = w.Write(bencode.MustMarshal(map[string]string{"failure reason": token}))
		case "invalid":
			_, _ = w.Write([]byte("d8:intervali10e5:peersli0eee"))
		}
	}))
	defer first.Close()
	for path, want := range map[string]trackerErrorCode{
		"redirect": trackerRedirect,
		"error":    trackerHTTPStatus,
		"rejected": trackerRejected,
		"invalid":  trackerInvalidResponse,
	} {
		a, code := newPrivateAnnouncer(first.URL+"/"+token+"/"+path, nil)
		if code != "" {
			t.Fatal(code)
		}
		_, code = a.announce(t.Context(), tracker.AnnounceRequest{})
		a.close()
		if code != want {
			t.Errorf("%s: got code %q, want %q", path, code, want)
		}
	}
	if redirected.Load() != 0 {
		t.Fatal("tracker redirect was followed")
	}
	if _, code := newPrivateAnnouncer(first.URL+"/announce?auth=test-token&l%65ft=123", nil); code != trackerInvalidURL {
		t.Fatalf("endpoint with a conflicting left field accepted: %q", code)
	}
}

func TestPrivateTrackerUDPUsesConnectedDialer(t *testing.T) {
	server, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IP{127, 0, 0, 1}})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	other, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IP{127, 0, 0, 1}})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()

	const uri = "/announce?auth=test-token"
	if err := server.SetDeadline(time.Now().Add(4 * time.Second)); err != nil {
		t.Fatal(err)
	}
	serverResult := make(chan error, 1)
	go func() { serverResult <- servePrivateTrackerUDP(server, other, uri) }()
	var dialed string
	a, code := newPrivateAnnouncer("udp4://"+server.LocalAddr().String()+uri, func(ctx context.Context, network, addr string) (net.Conn, error) {
		dialed = network + "://" + addr
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	})
	if code != "" {
		t.Fatal(code)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Second)
	defer cancel()
	response, code := a.announce(ctx, tracker.AnnounceRequest{Event: tracker.Started, Left: 7, Port: 12345})
	if err := <-serverResult; err != nil {
		t.Fatal(err)
	}
	if code != "" || response.Interval != 30 || dialed != "udp4://"+server.LocalAddr().String() {
		t.Fatalf("announce used unexpected endpoint or response: code=%q interval=%d dial=%q", code, response.Interval, dialed)
	}
}

func servePrivateTrackerUDP(server, other *net.UDPConn, uri string) error {
	const connectionId = 17
	buf := make([]byte, 2048)
	n, peer, err := server.ReadFromUDP(buf)
	if err != nil {
		return err
	}
	var request udp.RequestHeader
	if err := udp.Read(bytes.NewReader(buf[:n]), &request); err != nil {
		return err
	}
	if request.Action != udp.ActionConnect || request.ConnectionId != udp.ConnectRequestConnectionId {
		return fmt.Errorf("expected connect, got %+v", request)
	}
	var reply bytes.Buffer
	if err := udp.Write(&reply, udp.ResponseHeader{Action: udp.ActionConnect, TransactionId: request.TransactionId}); err != nil {
		return err
	}
	if err := udp.Write(&reply, udp.ConnectionResponse{ConnectionId: connectionId}); err != nil {
		return err
	}
	if _, err := server.WriteToUDP(reply.Bytes(), peer); err != nil {
		return err
	}
	n, peer, err = server.ReadFromUDP(buf)
	if err != nil {
		return err
	}
	payload := bytes.NewBuffer(buf[:n])
	if err := udp.Read(payload, &request); err != nil {
		return err
	}
	var announce tracker.AnnounceRequest
	if err := udp.Read(payload, &announce); err != nil {
		return err
	}
	if request.Action != udp.ActionAnnounce || request.ConnectionId != connectionId ||
		announce.Event != tracker.Started || announce.Left != 7 || announce.Port != 12345 ||
		!bytes.Equal(payload.Bytes(), (udp.Options{RequestUri: uri}).Encode()) {
		return fmt.Errorf("invalid announce or URLData")
	}
	reply.Reset()
	if err := udp.Write(&reply, udp.ResponseHeader{Action: udp.ActionAnnounce, TransactionId: request.TransactionId}); err != nil {
		return err
	}
	if err := udp.Write(&reply, udp.AnnounceResponseHeader{Interval: 99}); err != nil {
		return err
	}
	if _, err := other.WriteToUDP(reply.Bytes(), peer); err != nil {
		return err
	}
	reply.Truncate(8)
	if err := udp.Write(&reply, udp.AnnounceResponseHeader{Interval: 30}); err != nil {
		return err
	}
	_, err = server.WriteToUDP(reply.Bytes(), peer)
	return err
}
