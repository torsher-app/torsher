package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
)

// Клиенты в тестах не ходят наружу: без DHT, трекеров и UPnP, только loopback
func offline(cfg *torrent.ClientConfig) {
	cfg.NoDHT = true
	cfg.DisableTrackers = true
	cfg.NoDefaultPortForwarding = true
	cfg.DisableIPv6 = true
	cfg.SetListenAddr("127.0.0.1:0")
}

type fixture struct {
	content []byte
	meta    *metainfo.MetaInfo
	raw     []byte
	seeder  *torrent.Client
}

// Синтетическая раздача из одного файла и сидер, который её раздаёт
func newFixture(t *testing.T) fixture {
	t.Helper()

	dir := t.TempDir()
	content := make([]byte, 3<<20+12345)
	_, _ = rand.Read(content)

	if err := os.WriteFile(filepath.Join(dir, "Sample.Movie.mkv"), content, 0o644); err != nil {
		t.Fatal(err)
	}

	info := metainfo.Info{PieceLength: 256 << 10}
	if err := info.BuildFromFilePath(filepath.Join(dir, "Sample.Movie.mkv")); err != nil {
		t.Fatal(err)
	}

	infoBytes, err := bencode.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}

	meta := &metainfo.MetaInfo{InfoBytes: infoBytes}

	var raw bytes.Buffer
	if err := meta.Write(&raw); err != nil {
		t.Fatal(err)
	}

	cfg := torrent.NewDefaultClientConfig()
	offline(cfg)
	cfg.Seed = true
	cfg.DataDir = dir

	seeder, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { seeder.Close() })

	st, err := seeder.AddTorrent(meta)
	if err != nil {
		t.Fatal(err)
	}

	if err := st.VerifyData(); err != nil {
		t.Fatal(err)
	}

	return fixture{content: content, meta: meta, raw: raw.Bytes(), seeder: seeder}
}

func newTestEngine(t *testing.T, dataDir string) (*api, *httptest.Server) {
	t.Helper()

	cfg, err := newClientConfig(filepath.Join(dataDir, "downloads"), dataDir, 0)
	if err != nil {
		t.Fatal(err)
	}
	offline(cfg)

	client, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}

	sess, err := newSession(filepath.Join(dataDir, "torrents"))
	if err != nil {
		t.Fatal(err)
	}

	engine := newAPI(client, sess, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(engine.routes())

	t.Cleanup(func() {
		server.Close()
		client.Close()
	})

	return engine, server
}

func post(t *testing.T, url string, body []byte) *http.Response {
	t.Helper()

	response, err := http.Post(url, "application/octet-stream", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}

	return response
}

func decode[T any](t *testing.T, response *http.Response) T {
	t.Helper()
	defer response.Body.Close()

	var value T
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatal(err)
	}

	return value
}

func TestInspectReturnsFilesWithoutAdding(t *testing.T) {
	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())

	response := post(t, server.URL+"/torrents/inspect", fx.raw)
	details := decode[torrentDetails](t, response)

	if response.StatusCode != http.StatusOK {
		t.Fatalf("status %d", response.StatusCode)
	}

	if details.InfoHash != fx.meta.HashInfoBytes().HexString() || details.PieceLength != 256<<10 {
		t.Fatalf("unexpected details %+v", details)
	}

	if len(details.Files) != 1 || details.Files[0].Path != "Sample.Movie.mkv" || details.Files[0].Length != int64(len(fx.content)) {
		t.Fatalf("unexpected files %+v", details.Files)
	}

	if len(engine.client.Torrents()) != 0 {
		t.Fatal("inspect must not add the torrent")
	}
}

func TestInspectRejectsGarbage(t *testing.T) {
	_, server := newTestEngine(t, t.TempDir())

	response := post(t, server.URL+"/torrents/inspect", []byte("not a torrent"))
	body := decode[map[string]string](t, response)

	if response.StatusCode != http.StatusBadRequest || body["kind"] != "invalid_torrent" {
		t.Fatalf("status %d, body %v", response.StatusCode, body)
	}
}

func TestStreamServesRangesFromPeers(t *testing.T) {
	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	hash := fx.meta.HashInfoBytes()

	if response := post(t, server.URL+"/torrents?files=0", fx.raw); response.StatusCode != http.StatusOK {
		t.Fatalf("add: status %d", response.StatusCode)
	}

	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)

	start := int64(1<<20 + 777)
	request, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/torrents/%s/files/0/stream", server.URL, hash.HexString()), nil)
	request.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, start+99))

	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(response.Body)

	if response.StatusCode != http.StatusPartialContent {
		t.Fatalf("status %d", response.StatusCode)
	}

	if want := fmt.Sprintf("bytes %d-%d/%d", start, start+99, len(fx.content)); response.Header.Get("Content-Range") != want {
		t.Fatalf("Content-Range %q, want %q", response.Header.Get("Content-Range"), want)
	}

	if response.Header.Get("Content-Type") != "video/x-matroska" {
		t.Fatalf("Content-Type %q", response.Header.Get("Content-Type"))
	}

	if !bytes.Equal(body, fx.content[start:start+100]) {
		t.Fatal("streamed bytes differ from the file")
	}
}

func TestRangeBeyondFileIsNotSatisfiable(t *testing.T) {
	fx := newFixture(t)
	_, server := newTestEngine(t, t.TempDir())
	hash := fx.meta.HashInfoBytes().HexString()

	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/torrents/"+hash+"/files/0/stream", nil)
	request.Header.Set("Range", fmt.Sprintf("bytes=%d-", len(fx.content)+10))

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()

	if response.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("status %d", response.StatusCode)
	}
}

func TestStatsAndForget(t *testing.T) {
	fx := newFixture(t)
	_, server := newTestEngine(t, t.TempDir())
	hash := fx.meta.HashInfoBytes().HexString()

	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()

	response, _ := http.Get(server.URL + "/torrents/" + hash + "/stats")
	stats := decode[statsResponse](t, response)

	if response.StatusCode != http.StatusOK || len(stats.FileProgress) != 1 || len(stats.Pieces) != 13 {
		t.Fatalf("status %d, stats %+v", response.StatusCode, stats)
	}

	request, _ := http.NewRequest(http.MethodDelete, server.URL+"/torrents/"+hash, nil)
	deleted, _ := http.DefaultClient.Do(request)
	deleted.Body.Close()

	missing, _ := http.Get(server.URL + "/torrents/" + hash + "/stats")
	body := decode[map[string]string](t, missing)

	if deleted.StatusCode != http.StatusNoContent || missing.StatusCode != http.StatusNotFound || body["kind"] != "torrent_not_found" {
		t.Fatalf("delete %d, stats after %d %v", deleted.StatusCode, missing.StatusCode, body)
	}
}

func TestTorrentsSurviveRestart(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	hash := fx.meta.HashInfoBytes()

	{
		_, server := newTestEngine(t, dataDir)
		post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()
	}

	// Второй экземпляр на том же каталоге данных; первый закроется в Cleanup,
	// но bolt-база занята — поэтому отдельный каталог данных с копией сессии
	restartDir := t.TempDir()
	copyDir(t, filepath.Join(dataDir, "torrents"), filepath.Join(restartDir, "torrents"))

	engine, _ := newTestEngine(t, restartDir)
	engine.restore()

	restored, ok := engine.client.Torrent(hash)
	if !ok || restored.Info() == nil {
		t.Fatal("torrent was not restored")
	}

	engine.mu.Lock()
	pending := engine.pending[hash]
	engine.mu.Unlock()

	if len(pending) != 1 || pending[0] != 0 {
		t.Fatalf("selection was not restored: %v", pending)
	}
}

func TestParseFiles(t *testing.T) {
	if files, err := parseFiles("0,2,5"); err != nil || len(files) != 3 || files[2] != 5 {
		t.Fatalf("files %v, err %v", files, err)
	}

	for _, raw := range []string{"a", "1,-2", "1,,2"} {
		if _, err := parseFiles(raw); err == nil {
			t.Fatalf("%q must be rejected", raw)
		}
	}
}

func copyDir(t *testing.T, from, to string) {
	t.Helper()

	if err := os.MkdirAll(to, 0o755); err != nil {
		t.Fatal(err)
	}

	entries, err := os.ReadDir(from)
	if err != nil {
		t.Fatal(err)
	}

	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(from, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}

		if err := os.WriteFile(filepath.Join(to, entry.Name()), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
