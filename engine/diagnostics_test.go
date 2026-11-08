package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

type diagnosticOutput struct {
	mu sync.Mutex
	bytes.Buffer
}

func (b *diagnosticOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.Buffer.Write(p)
}
func (b *diagnosticOutput) text() string { b.mu.Lock(); defer b.mu.Unlock(); return b.Buffer.String() }

type blockedDiagnosticReader struct {
	torrent.Reader
	ctx              context.Context
	entered, release chan struct{}
	n                int
	err              error
}

func (r *blockedDiagnosticReader) Read(p []byte) (int, error) {
	r.entered <- struct{}{}
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	case <-r.release:
	}
	if r.n > 0 {
		p[0] = 'x'
	}
	return r.n, r.err
}
func (r *blockedDiagnosticReader) Close() error                            { return nil }
func (r *blockedDiagnosticReader) Seek(offset int64, _ int) (int64, error) { return offset, nil }
func TestStreamDiagnosticStallResumedAndTimers(t *testing.T) {
	for _, tc := range []struct {
		name   string
		n      int
		err    error
		cancel bool
	}{
		{"bytes", 1, nil, false}, {"eof", 0, io.EOF, false}, {"cancel", 0, nil, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var out diagnosticOutput
			source := &blockedDiagnosticReader{ctx: ctx, entered: make(chan struct{}, 1), release: make(chan struct{}), n: tc.n, err: tc.err}
			hash := metainfo.Hash{1}
			speeds := newSpeedTracker()
			snapshots := map[metainfo.Hash]peerDiagnosticSnapshot{hash: {time.Now(), 3, 12, 2, 1, 8192}}
			speeds.diagnostics.Store(&snapshots)
			reader := &streamDiagnostics{Reader: source, ctx: ctx, logger: slog.New(slog.NewTextHandler(&out, nil)), speeds: speeds, hash: hash, fileIndex: 2, offset: 8192, pieceLength: 1024, first: 5 * time.Millisecond, every: 10 * time.Millisecond}
			done := make(chan error, 1)
			go func() { _, err := reader.Read(make([]byte, 8)); done <- err }()
			<-source.entered
			waitFor(t, time.Second, func() bool { return strings.Count(out.text(), "event=engine.stream_wait") >= 2 })
			if tc.cancel {
				cancel()
			} else {
				close(source.release)
			}
			<-done
			reader.mu.Lock()
			active, timer, generation := reader.active, reader.timer, reader.generation
			reader.mu.Unlock()
			if active || timer != nil {
				t.Fatal("timer retained after Read")
			}
			reader.waiting(generation-1, 0)
			_ = reader.Close()
			text := out.text()
			if got := strings.Contains(text, "event=engine.stream_resumed"); got != (tc.n > 0 && !tc.cancel) {
				t.Fatalf("resumed=%v, log=%s", got, text)
			}
			if !strings.Contains(text, "seeders=2") || !strings.Contains(text, "statsKnown=true") || !strings.Contains(text, "piece=8") {
				t.Fatal(text)
			}
			time.Sleep(20 * time.Millisecond)
			reader.mu.Lock()
			active, timer = reader.active, reader.timer
			reader.mu.Unlock()
			if active || timer != nil {
				t.Fatal("inflight callback resurrected a timer")
			}
			text = out.text()
			reader.waiting(generation, 0)
			reader.waiting(generation-1, 0)
			if out.text() != text {
				t.Fatal("stale callback logged after return/close")
			}
		})
	}
}
func TestStreamDiagnosticCancelBeforeThreshold(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var out diagnosticOutput
	source := &blockedDiagnosticReader{ctx: ctx, entered: make(chan struct{}, 1), release: make(chan struct{})}
	reader := &streamDiagnostics{Reader: source, ctx: ctx, logger: slog.New(slog.NewTextHandler(&out, nil)), speeds: newSpeedTracker(), pieceLength: 1, first: time.Second, every: time.Second}
	done := make(chan struct{})
	go func() { _, _ = reader.Read(make([]byte, 1)); close(done) }()
	<-source.entered
	cancel()
	<-done
	_ = reader.Close()
	reader.waiting(1, 0)
	if out.text() != "" {
		t.Fatal(out.text())
	}
}

type blockingDiagnosticWriter struct{ entered, release chan struct{} }

func (w *blockingDiagnosticWriter) Write(p []byte) (int, error) {
	close(w.entered)
	<-w.release
	return len(p), nil
}
func TestStreamDiagnosticCloseDoesNotWaitForSamplerOrLogSink(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	source := &blockedDiagnosticReader{ctx: ctx, entered: make(chan struct{}, 1), release: make(chan struct{})}
	speeds := newSpeedTracker()
	speeds.mu.Lock()
	defer speeds.mu.Unlock()
	writer := &blockingDiagnosticWriter{entered: make(chan struct{}), release: make(chan struct{})}
	reader := &streamDiagnostics{Reader: source, ctx: ctx, logger: slog.New(slog.NewTextHandler(writer, nil)), speeds: speeds, pieceLength: 1, first: time.Millisecond, every: time.Second}
	done := make(chan struct{})
	go func() { _, _ = reader.Read(make([]byte, 1)); close(done) }()
	<-source.entered
	<-writer.entered
	closed := make(chan struct{})
	go func() { _ = reader.Close(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("Close waits for diagnostic IO")
	}
	cancel()
	<-done
	close(writer.release)
}
func TestMetadataTimeoutDiagnosticWithoutMetadata(t *testing.T) {
	a, server := newTestEngine(t, t.TempDir())
	var out diagnosticOutput
	a.logger = slog.New(slog.NewTextHandler(&out, nil))
	a.speeds.mu.Lock()
	defer a.speeds.mu.Unlock()
	started := time.Now()
	hash := metainfo.Hash{2}.HexString()
	response := post(t, server.URL+"/torrents/resolve?timeout_ms=5&token=SECRET_MARKER", []byte("magnet:?xt=urn:btih:"+hash+"&dn=PRIVATE_NAME_MARKER"))
	defer response.Body.Close()
	if response.StatusCode != 504 {
		t.Fatal(response.StatusCode)
	}
	if time.Since(started) > time.Second {
		t.Fatal("metadata timeout waited for sampler")
	}
	text := out.text()
	for _, want := range []string{"event=engine.metadata_timeout", "infoHash=" + hash, "statsKnown=false", "event=engine.api_error", `operation="POST /torrents/resolve"`, "statusCode=504", "errorKind=timeout"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %s in %s", want, text)
		}
	}
	if strings.Contains(text, "MARKER") || strings.Contains(text, "magnet:") {
		t.Fatal(text)
	}
}
func TestEngineAPIErrorPreservesBodyAndSafeKind(t *testing.T) {
	var out diagnosticOutput
	a := &api{logger: slog.New(slog.NewTextHandler(&out, nil))}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /torrents/{hash}/pause", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, 500, "storage", &os.PathError{Op: "open", Path: "PRIVATE_PATH_MARKER", Err: syscall.EACCES})
	})
	handler := a.diagnosticErrors(mux)
	for range 2 {
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, httptest.NewRequest("POST", "/torrents/0123456789abcdef0123456789abcdef01234567/pause?token=SECRET_MARKER", nil))
		if result.Code != 500 || !strings.Contains(result.Body.String(), "PRIVATE_PATH_MARKER") {
			t.Fatal("response changed")
		}
	}
	text := out.text()
	if strings.Contains(text, "MARKER") || strings.Count(text, "event=engine.api_error") != 1 || !strings.Contains(text, "errorKind=storage") {
		t.Fatal(text)
	}
}

type shortDiagnosticPiece struct{ storage.PieceImpl }

func (shortDiagnosticPiece) WriteAt([]byte, int64) (int, error) { return 1, nil }
func TestStorageWriteDiagnosticActualPermissionAndShortWrite(t *testing.T) {
	private := filepath.Join(t.TempDir(), "PRIVATE_PATH_MARKER")
	if err := os.Mkdir(private, 0o755); err != nil {
		t.Fatal(err)
	}
	diagnostics := newStorageDiagnostics()
	life := &storageLifecycle{torrents: map[metainfo.Hash]*storageLifetime{}, diagnostics: diagnostics}
	underlying := permissionDiagnosticPiece{path: filepath.Join(private, "PRIVATE_NAME_MARKER")}
	lifeState := &storageLifetime{}
	hash := metainfo.Hash{3}
	life.torrents[hash] = lifeState
	piece := trackedPiece{PieceImpl: underlying, life: lifeState, diagnostics: diagnostics, hash: hash, index: 0}
	if err := os.Chmod(private, 0o555); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(private, 0o755)
	_, err := piece.WriteAt([]byte("data"), 0)
	if !errors.Is(err, syscall.EACCES) {
		t.Fatalf("expected real EACCES, got %v", err)
	}
	select {
	case event := <-diagnostics.pending:
		if event.kind != "EACCES" {
			t.Fatal(event)
		}
	default:
		t.Fatal("missing diagnostic")
	}
	_, _ = piece.WriteAt([]byte("data"), 0)
	select {
	case <-diagnostics.pending:
		t.Fatal("write failure not throttled")
	default:
	}
	short := trackedPiece{PieceImpl: shortDiagnosticPiece{}, life: &storageLifetime{}, diagnostics: diagnostics, hash: metainfo.Hash{4}, index: 5}
	n, err := short.WriteAt([]byte("data"), 0)
	if n != 1 || err != nil {
		t.Fatal("short write return changed")
	}
	select {
	case event := <-diagnostics.pending:
		if !event.short || event.kind != "other" || event.piece != 5 {
			t.Fatal(event)
		}
	default:
		t.Fatal("short write missing")
	}
	short.life.closed = true
	if _, err := short.WriteAt([]byte("data"), 0); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	select {
	case <-diagnostics.pending:
		t.Fatal("late callback logged as disk failure")
	default:
	}
}
func TestLibraryProjectionDoesNotLeakWriteFailure(t *testing.T) {
	var out bytes.Buffer
	logger := slog.New(withoutCanceled{Handler: slog.NewTextHandler(&out, nil), throttle: &apiErrorThrottle{}}).WithGroup("PRIVATE_GROUP_MARKER").With(slog.Group("torrent", "name", "PRIVATE_NAME_MARKER", "ih", strings.Repeat("a", 40)), "url", "https://private.example?token=SECRET_MARKER")
	err := &os.PathError{Op: "write", Path: "PRIVATE_PATH_MARKER", Err: syscall.EACCES}
	for range 5 {
		logger.Error("writing received chunk PRIVATE_MESSAGE_MARKER", "err", err)
	}
	logger.Error("initial read failed", "err", context.Canceled)
	text := out.String()
	if strings.Contains(text, "MARKER") || strings.Count(text, "torrent library diagnostic") != 1 || !strings.Contains(text, "errorKind=EACCES") || !strings.Contains(text, "infoHash="+strings.Repeat("a", 40)) {
		t.Fatal(text)
	}
}

type permissionDiagnosticPiece struct {
	storage.PieceImpl
	path string
}

func (p permissionDiagnosticPiece) WriteAt(b []byte, off int64) (int, error) {
	f, err := os.OpenFile(p.path, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return f.WriteAt(b, off)
}
func TestStreamDiagnosticActualTorrentReadWait(t *testing.T) {
	info := metainfo.Info{Name: "Synthetic.Stream.mkv", PieceLength: 1024, Length: 1024, Pieces: make([]byte, 20)}
	encoded, err := bencode.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	meta := &metainfo.MetaInfo{InfoBytes: encoded}
	var raw bytes.Buffer
	if err := meta.Write(&raw); err != nil {
		t.Fatal(err)
	}
	a, server := newTestEngine(t, t.TempDir())
	response := post(t, server.URL+"/torrents", raw.Bytes())
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode)
	}
	tor, _ := a.client.Torrent(meta.HashInfoBytes())
	file := tor.Files()[0]
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var out diagnosticOutput
	reader := &streamDiagnostics{Reader: newStreamReader(ctx, file), ctx: ctx, logger: slog.New(slog.NewTextHandler(&out, nil)), speeds: a.speeds, hash: tor.InfoHash(), pieceLength: tor.Info().PieceLength, first: time.Millisecond, every: time.Second}
	done := make(chan error, 1)
	go func() { _, err := reader.Read(make([]byte, 64)); done <- err }()
	waitFor(t, time.Second, func() bool { return strings.Contains(out.text(), "event=engine.stream_wait") })
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	_ = reader.Close()
	if strings.Contains(out.text(), "engine.stream_resumed") {
		t.Fatal(out.text())
	}
}

func TestHealthRestoringIsExpectedButStuckRemainsAPIFailure(t *testing.T) {
	var out diagnosticOutput
	a := &api{logger: slog.New(slog.NewTextHandler(&out, nil)), lockStuckFrom: time.Second}
	handler := a.routes()
	restoring := httptest.NewRecorder()
	handler.ServeHTTP(restoring, httptest.NewRequest("GET", "/health", nil))
	if restoring.Code != 503 || strings.TrimSpace(restoring.Body.String()) != `{"status":"restoring"}` {
		t.Fatal(restoring.Code, restoring.Body.String())
	}
	if strings.Contains(out.text(), "engine.api_error") {
		t.Fatal("normal restore logged as an API failure", out.text())
	}
	a.lockAlive.Store(time.Now().Add(-time.Minute).UnixNano())
	stuck := httptest.NewRecorder()
	handler.ServeHTTP(stuck, httptest.NewRequest("GET", "/health", nil))
	if stuck.Code != 503 || strings.TrimSpace(stuck.Body.String()) != `{"status":"stuck"}` {
		t.Fatal(stuck.Code, stuck.Body.String())
	}
	if !strings.Contains(out.text(), "event=engine.api_error") || !strings.Contains(out.text(), "statusCode=503") {
		t.Fatal(out.text())
	}
}
