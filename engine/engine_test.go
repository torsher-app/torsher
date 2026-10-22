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

	cfg, store, err := newClientConfig(filepath.Join(dataDir, "downloads"), dataDir, 0, true)
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

	engine := newAPI(client, sess, store, slog.New(slog.NewTextHandler(io.Discard, nil)))
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

	if deleted.StatusCode != http.StatusOK || missing.StatusCode != http.StatusNotFound || body["kind"] != "torrent_not_found" {
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

func waitFor(t *testing.T, timeout time.Duration, done func() bool) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for !done() {
		if time.Now().After(deadline) {
			t.Fatal("condition was not met in time")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func put(t *testing.T, url string, body string) *http.Response {
	t.Helper()

	request, _ := http.NewRequest(http.MethodPut, url, bytes.NewReader([]byte(body)))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}

	return response
}

func stateOfHash(t *testing.T, engine *api, hash metainfo.Hash) torrentState {
	t.Helper()

	added, ok := engine.client.Torrent(hash)
	if !ok {
		t.Fatal("torrent is not in the engine")
	}

	return engine.stateOf(added)
}

// Раздача добавлена, выбран файл 0 и сразу качается с сидера
func downloadFixture(t *testing.T, engine *api, server *httptest.Server, fx fixture) metainfo.Hash {
	t.Helper()

	hash := fx.meta.HashInfoBytes()
	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()

	response := put(t, server.URL+"/torrents/"+hash.HexString()+"/files", `{"files":[0],"now":true}`)
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("select: status %d", response.StatusCode)
	}

	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)

	return hash
}

func TestDownloadNowFetchesTheWholeFile(t *testing.T) {
	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	hash := downloadFixture(t, engine, server, fx)

	waitFor(t, 30*time.Second, func() bool {
		state := stateOfHash(t, engine, hash)
		return state.WantedCompleted == int64(len(fx.content))
	})

	response, _ := http.Get(server.URL + "/torrents")
	states := decode[[]torrentState](t, response)

	if len(states) != 1 || !states[0].Background || states[0].BytesWanted != int64(len(fx.content)) || states[0].Selected[0] != 0 {
		t.Fatalf("unexpected list %+v", states)
	}
}

func TestPauseStopsDownloadAndSurvivesRestart(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := fx.meta.HashInfoBytes()

	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()

	paused := post(t, server.URL+"/torrents/"+hash.HexString()+"/pause", nil)
	paused.Body.Close()
	if paused.StatusCode != http.StatusNoContent {
		t.Fatalf("pause: status %d", paused.StatusCode)
	}

	put(t, server.URL+"/torrents/"+hash.HexString()+"/files", `{"files":[0],"now":true}`).Body.Close()
	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)

	time.Sleep(time.Second)

	state := stateOfHash(t, engine, hash)
	if !state.Paused || state.Seeding || state.WantedCompleted != 0 {
		t.Fatalf("paused torrent downloaded: %+v", state)
	}

	restartDir := t.TempDir()
	copyDir(t, filepath.Join(dataDir, "torrents"), filepath.Join(restartDir, "torrents"))
	restarted, _ := newTestEngine(t, restartDir)
	restarted.restore()

	if state := stateOfHash(t, restarted, hash); !state.Paused || !state.Background {
		t.Fatalf("pause was not restored: %+v", state)
	}

	post(t, server.URL+"/torrents/"+hash.HexString()+"/resume", nil).Body.Close()

	waitFor(t, 30*time.Second, func() bool {
		return stateOfHash(t, engine, hash).WantedCompleted == int64(len(fx.content))
	})
}

func TestForgetWithFilesDeletesDataAndCompletion(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := downloadFixture(t, engine, server, fx)
	downloads := filepath.Join(dataDir, "downloads")

	waitFor(t, 30*time.Second, func() bool {
		return stateOfHash(t, engine, hash).WantedCompleted == int64(len(fx.content))
	})

	neighbour := filepath.Join(downloads, "keep.txt")
	if err := os.WriteFile(neighbour, []byte("not part of the torrent"), 0o644); err != nil {
		t.Fatal(err)
	}

	request, _ := http.NewRequest(http.MethodDelete, server.URL+"/torrents/"+hash.HexString()+"?delete_files=true", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	deleted := decode[forgetResponse](t, response)

	if response.StatusCode != http.StatusOK || deleted.DeletedBytes != int64(len(fx.content)) {
		t.Fatalf("status %d, deleted %+v", response.StatusCode, deleted)
	}

	for _, path := range []string{"Sample.Movie.mkv", "Sample.Movie.mkv" + partFileSuffix} {
		if _, err := os.Stat(filepath.Join(downloads, path)); !os.IsNotExist(err) {
			t.Fatalf("%s was not deleted: %v", path, err)
		}
	}

	if _, err := os.Stat(neighbour); err != nil {
		t.Fatalf("neighbour file was touched: %v", err)
	}

	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()

	if state := stateOfHash(t, engine, hash); state.BytesCompleted != 0 {
		t.Fatalf("re-added torrent counts deleted pieces: %+v", state)
	}
}

func TestDeleteFilesStaysInsideDownloads(t *testing.T) {
	root := t.TempDir()
	downloads := filepath.Join(root, "downloads")
	outside := filepath.Join(root, "escape.txt")

	for _, dir := range []string{filepath.Join(downloads, "pack", "Season 1"), filepath.Join(downloads, "pack", "Extras")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	files := map[string]string{
		outside: "outside",
		filepath.Join(downloads, "pack", "Season 1", "e01.mkv"):      "one",
		filepath.Join(downloads, "pack", "Season 1", "e02.mkv.part"): "two",
		filepath.Join(downloads, "pack", "Extras", "user.txt"):       "user",
	}
	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	info := &metainfo.Info{
		Name: "pack",
		Files: []metainfo.FileInfo{
			{Path: []string{"Season 1", "e01.mkv"}, Length: 3},
			{Path: []string{"Season 1", "e02.mkv"}, Length: 3},
			{Path: []string{"..", "..", "escape.txt"}, Length: 7},
		},
	}

	freed, err := deleteTorrentFiles(downloads, info)
	if err == nil {
		t.Fatal("path outside the downloads directory must be reported")
	}

	if freed != 6 {
		t.Fatalf("freed %d bytes, want 6", freed)
	}

	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("file outside downloads was touched: %v", err)
	}

	if _, err := os.Stat(filepath.Join(downloads, "pack", "Season 1")); !os.IsNotExist(err) {
		t.Fatalf("empty directory was kept: %v", err)
	}

	if _, err := os.Stat(filepath.Join(downloads, "pack", "Extras", "user.txt")); err != nil {
		t.Fatalf("unrelated file in the torrent directory was touched: %v", err)
	}
}

func TestDownloadedDataIsSeeded(t *testing.T) {
	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	hash := downloadFixture(t, engine, server, fx)

	waitFor(t, 30*time.Second, func() bool {
		return stateOfHash(t, engine, hash).WantedCompleted == int64(len(fx.content))
	})

	// Сидер ушёл: данные есть только у движка
	fx.seeder.Close()

	cfg := torrent.NewDefaultClientConfig()
	offline(cfg)
	cfg.DataDir = t.TempDir()

	leecher, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { leecher.Close() })

	lt, err := leecher.AddTorrent(fx.meta)
	if err != nil {
		t.Fatal(err)
	}
	lt.AddClientPeer(engine.client)
	lt.DownloadAll()

	waitFor(t, 30*time.Second, func() bool { return lt.BytesMissing() == 0 })

	if !stateOfHash(t, engine, hash).Seeding {
		t.Fatal("engine must report seeding")
	}
}

// Файл под итоговым именем полного размера, но без данных: хранилище считает
// его куски скачанными, и без проверки дыр поток отдал бы нули
func TestSparseFileIsNotTrustedAsComplete(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	downloads := filepath.Join(dataDir, "downloads")
	path := filepath.Join(downloads, "Sample.Movie.mkv")

	if err := os.MkdirAll(downloads, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(path, int64(len(fx.content))); err != nil {
		t.Fatal(err)
	}
	if holes, _ := fileHoles(path); len(holes) == 0 {
		t.Skip("file system has no sparse files")
	}

	engine, server := newTestEngine(t, dataDir)
	hash := fx.meta.HashInfoBytes()
	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()

	if state := stateOfHash(t, engine, hash); state.BytesCompleted != 0 {
		t.Fatalf("pieces over holes are still complete: %+v", state)
	}

	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/torrents/"+hash.HexString()+"/files/0/stream", nil)
	request.Header.Set("Range", "bytes=1000000-1000999")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(response.Body)
	if !bytes.Equal(body, fx.content[1000000:1001000]) {
		t.Fatal("stream served zeros instead of data from peers")
	}
}
