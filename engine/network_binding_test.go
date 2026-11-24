package main

import (
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
)

func TestOfflineMagnetDoesNotFetchMetainfo(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	cfg, store, err := newClientConfig(t.TempDir(), t.TempDir(), defaultOptions())
	if err != nil {
		t.Fatal(err)
	}
	makeClientOffline(cfg)
	client, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	sess, err := newSession(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	engine := newAPI(client, sess, store, slog.New(slog.NewTextHandler(io.Discard, nil)))
	engine.networkOffline = true
	hash := metainfo.Hash{0xed}
	source := url.QueryEscape(server.URL)
	magnet := "magnet:?xt=urn:btih:" + hash.HexString() + "&xs=" + source + "&as=" + source + "/other"
	req := httptest.NewRequest(http.MethodPost, "/torrents/resolve?timeout_ms=100", strings.NewReader(magnet))
	response := httptest.NewRecorder()
	engine.routes().ServeHTTP(response, req)
	if response.Code != http.StatusGatewayTimeout {
		t.Fatalf("unexpected offline resolve status %d: %s", response.Code, response.Body)
	}

	if requests.Load() != 0 {
		t.Fatalf("offline client made %d source requests", requests.Load())
	}
}

func TestSocketScopeClosesCurrentAndLateSockets(t *testing.T) {
	scope := &socketScope{open: make(map[io.Closer]struct{})}
	a, b := net.Pipe()
	defer b.Close()
	if _, err := scope.add(a); err != nil {
		t.Fatal(err)
	}
	scope.close()
	if _, err := a.Write([]byte{1}); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("open socket after closing: %v", err)
	}
	c, d := net.Pipe()
	defer d.Close()
	if _, err := scope.add(c); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("late socket after closing: %v", err)
	}
}
