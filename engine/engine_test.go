package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
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

// Сторонний пир в тестах — тоже anacrolix v1.61: без короткого keepalive его
// писатель теряет пробуждение так же, как у движка (`peerKeepAlive`)
func peerConfig() *torrent.ClientConfig {
	cfg := torrent.NewDefaultClientConfig()
	offline(cfg)
	cfg.KeepAliveTimeout = peerKeepAlive

	return cfg
}

type fixture struct {
	content []byte
	meta    *metainfo.MetaInfo
	raw     []byte
	seeder  *torrent.Client
	// Файл, который раздаёт сидер
	path string
}

// Синтетическая раздача из одного файла и сидер, который её раздаёт
func newFixture(t *testing.T) fixture {
	t.Helper()

	return newNamedFixture(t, "Sample.Movie.mkv", 3<<20+12345)
}

// Две раздачи в одном движке — под разными именами: файл с одним именем в
// одном каталоге загрузок у них был бы общий
func newNamedFixture(t *testing.T, name string, size int) fixture {
	t.Helper()

	dir := t.TempDir()
	content := make([]byte, size)
	_, _ = rand.Read(content)

	if err := os.WriteFile(filepath.Join(dir, name), content, 0o644); err != nil {
		t.Fatal(err)
	}

	info := metainfo.Info{PieceLength: 256 << 10}
	if err := info.BuildFromFilePath(filepath.Join(dir, name)); err != nil {
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

	cfg := peerConfig()
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

	return fixture{content: content, meta: meta, raw: raw.Bytes(), seeder: seeder, path: filepath.Join(dir, name)}
}

func newTestEngine(t *testing.T, dataDir string) (*api, *httptest.Server) {
	t.Helper()

	cfg, store, err := newClientConfig(filepath.Join(dataDir, "downloads"), dataDir, defaultOptions())
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

	// Планировщик работает после `restore`, как в движке
	ctx, cancel := context.WithCancel(context.Background())
	go engine.schedule(ctx)
	go engine.limits.gate(ctx)

	t.Cleanup(func() {
		cancel()
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
	engine.restore(context.Background())

	restored, ok := engine.client.Torrent(hash)
	if !ok || restored.Info() == nil {
		t.Fatal("torrent was not restored")
	}

	if state := engine.stateOf(restored); len(state.Selected) != 1 || state.Selected[0] != 0 {
		t.Fatalf("selection was not restored: %v", state.Selected)
	}

	// Единственный недокачанный файл выбора идёт первым
	if priority := restored.Files()[0].Priority(); priority != torrent.PiecePriorityHigh {
		t.Fatalf("restored selection does not download: priority %v", priority)
	}
}

// Запись прежней версии: выбор без докачки сделал просмотр — целиком его не
// качаем; выбор с докачкой остаётся. Запись переводится в новый вид
func TestLegacySessionSelection(t *testing.T) {
	for _, legacy := range []struct {
		background bool
		selected   int
	}{{false, 0}, {true, 1}} {
		fx := newFixture(t)
		dataDir := t.TempDir()
		sess, err := newSession(filepath.Join(dataDir, "torrents"))
		if err != nil {
			t.Fatal(err)
		}

		background := legacy.background
		err = sess.save(fx.meta, func(saved *savedTorrent) {
			*saved = savedTorrent{Selected: []int{0}, Background: &background}
		})
		if err != nil {
			t.Fatal(err)
		}

		engine, _ := newTestEngine(t, dataDir)
		engine.restore(context.Background())

		hash := fx.meta.HashInfoBytes()
		if state := stateOfHash(t, engine, hash); len(state.Selected) != legacy.selected {
			t.Fatalf("background %v: selection %v", legacy.background, state.Selected)
		}

		if saved := engine.session.get(hash); saved.Background != nil {
			t.Fatalf("background %v: legacy field was kept", legacy.background)
		}
	}
}

func TestHealthWaitsForRestore(t *testing.T) {
	engine, server := newTestEngine(t, t.TempDir())

	health := func() (int, string) {
		response, err := http.Get(server.URL + "/health")
		if err != nil {
			t.Fatal(err)
		}

		return response.StatusCode, decode[map[string]string](t, response)["status"]
	}

	if code, status := health(); code != http.StatusServiceUnavailable || status != "restoring" {
		t.Fatalf("health before restore = %d %q", code, status)
	}

	engine.restore(context.Background())

	if code, status := health(); code != http.StatusOK || status != "ok" {
		t.Fatalf("health after restore = %d %q", code, status)
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

	response := put(t, server.URL+"/torrents/"+hash.HexString()+"/files", `{"files":[0]}`)
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("select: status %d", response.StatusCode)
	}

	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)

	return hash
}

func TestSelectedFileDownloadsWithoutStream(t *testing.T) {
	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	hash := downloadFixture(t, engine, server, fx)

	waitFor(t, 30*time.Second, func() bool {
		state := stateOfHash(t, engine, hash)
		return state.WantedCompleted == int64(len(fx.content))
	})

	response, _ := http.Get(server.URL + "/torrents")
	states := decode[[]torrentState](t, response)

	if len(states) != 1 || states[0].BytesWanted != int64(len(fx.content)) || states[0].Selected[0] != 0 {
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

	put(t, server.URL+"/torrents/"+hash.HexString()+"/files", `{"files":[0]}`).Body.Close()
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
	restarted.restore(context.Background())

	if state := stateOfHash(t, restarted, hash); !state.Paused || len(state.Selected) != 1 {
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

	cfg := peerConfig()
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

// Перепроверка возвращается, когда отметка уже записана: на этом держится
// перенос, который перепроверяет потерянные куски и сразу объявляет `done`
func TestVerifiedPiecesAreCompleteOnReturn(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	downloads := filepath.Join(dataDir, "downloads")

	if err := os.MkdirAll(downloads, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(downloads, "Sample.Movie.mkv"), fx.content, 0o644); err != nil {
		t.Fatal(err)
	}

	engine, server := newTestEngine(t, dataDir)
	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()
	added, _ := engine.client.Torrent(fx.meta.HashInfoBytes())

	for round := range 5 {
		var pieces []*torrent.Piece
		for index := range added.NumPieces() {
			piece := added.Piece(index)
			if err := piece.Storage().MarkNotComplete(); err != nil {
				t.Fatal(err)
			}
			piece.UpdateCompletion()
			pieces = append(pieces, piece)
		}

		engine.verifyPieces(added, pieces)

		for _, piece := range pieces {
			if !piece.State().Complete {
				t.Fatalf("round %d: piece %v is not complete after verify", round, piece)
			}
		}
	}
}

// Раздача из двух файлов: размер первого не кратен куску, поэтому кусок на
// стыке принадлежит обоим
func newTwoFileFixture(t *testing.T) (fixture, []byte, []byte) {
	t.Helper()

	root := t.TempDir()
	dir := filepath.Join(root, "Show")
	first := make([]byte, 3*(256<<10)+1000)
	second := make([]byte, 2*(256<<10)+5000)
	_, _ = rand.Read(first)
	_, _ = rand.Read(second)

	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "E01.mkv"), first, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "E02.mkv"), second, 0o644); err != nil {
		t.Fatal(err)
	}

	info := metainfo.Info{PieceLength: 256 << 10}
	if err := info.BuildFromFilePath(dir); err != nil {
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

	cfg := peerConfig()
	cfg.Seed = true
	cfg.DataDir = root

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

	return fixture{meta: meta, raw: raw.Bytes(), seeder: seeder}, first, second
}

// Докачанный файл не затирается, когда качают соседний: кусок на стыке пишет
// и в хвост первого файла
func TestNeighbourDownloadKeepsFinishedFile(t *testing.T) {
	fx, first, second := newTwoFileFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := fx.meta.HashInfoBytes()
	path := filepath.Join(dataDir, "downloads", "Show", "E01.mkv")

	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()
	put(t, server.URL+"/torrents/"+hash.HexString()+"/files", `{"files":[0]}`).Body.Close()
	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)

	waitFor(t, 30*time.Second, func() bool {
		data, err := os.ReadFile(path)
		return err == nil && bytes.Equal(data, first)
	})

	put(t, server.URL+"/torrents/"+hash.HexString()+"/files", `{"files":[0,1]}`).Body.Close()

	waitFor(t, 30*time.Second, func() bool {
		data, err := os.ReadFile(filepath.Join(dataDir, "downloads", "Show", "E02.mkv"))
		return err == nil && bytes.Equal(data, second)
	})

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, first) {
		t.Fatal("finished file was overwritten while the neighbour downloaded")
	}
}

func filePriorities(added *torrent.Torrent) []torrent.PiecePriority {
	var priorities []torrent.PiecePriority
	for _, file := range added.Files() {
		priorities = append(priorities, file.Priority())
	}

	return priorities
}

// Выбор качается по порядку, в котором его прислали: первым — первый
// недокачанный файл, а файлы, поднятые владельцем, — раньше порядка
func TestSelectionDownloadsInOrder(t *testing.T) {
	fx, _, _ := newTwoFileFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	hash := fx.meta.HashInfoBytes()

	post(t, server.URL+"/torrents?files=1,0", fx.raw).Body.Close()
	added, _ := engine.client.Torrent(hash)

	high, normal := torrent.PiecePriorityHigh, torrent.PiecePriorityNormal
	if got := filePriorities(added); !slices.Equal(got, []torrent.PiecePriority{normal, high}) {
		t.Fatalf("order of the selection is ignored: %v", got)
	}
	if got := engine.stateOf(added).High; !slices.Equal(got, []int{1}) {
		t.Fatalf("state reports %v first", got)
	}

	put(t, server.URL+"/torrents/"+hash.HexString()+"/files", `{"files":[1,0],"first":[0]}`).Body.Close()

	if got := filePriorities(added); !slices.Equal(got, []torrent.PiecePriority{high, normal}) {
		t.Fatalf("raised file does not go first: %v", got)
	}
}

// Докачанный файл уступает место следующему по порядку, и поднятый
// владельцем — тоже
func TestFinishedFileHandsOverToNext(t *testing.T) {
	fx, first, _ := newTwoFileFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := fx.meta.HashInfoBytes()

	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()
	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)

	waitFor(t, 30*time.Second, func() bool {
		data, err := os.ReadFile(filepath.Join(dataDir, "downloads", "Show", "E01.mkv"))
		return err == nil && bytes.Equal(data, first)
	})

	if got := highFiles(added, []int{0, 1}, nil); !slices.Equal(got, []int{1}) {
		t.Fatalf("next file is not first: %v", got)
	}
	if got := highFiles(added, []int{0, 1}, []int{0}); !slices.Equal(got, []int{1}) {
		t.Fatalf("finished raised file keeps the order: %v", got)
	}
	if got := highFiles(added, []int{0}, nil); got != nil {
		t.Fatalf("finished selection still has a first file: %v", got)
	}
}

// Готовый файл рядом с недокачанным `.part` переживает перезапуск: при
// открытии раздачи хранилище снимает отметку с куска на стыке, и без защиты
// повторная запись этого куска затирала готовый файл разреженным `.part`
func TestRestartKeepsFinishedFileNextToPartFile(t *testing.T) {
	fx, first, _ := newTwoFileFixture(t)
	dataDir := t.TempDir()
	hash := fx.meta.HashInfoBytes()
	path := filepath.Join(dataDir, "downloads", "Show", "E01.mkv")

	cfg, store, err := newClientConfig(filepath.Join(dataDir, "downloads"), dataDir, defaultOptions())
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

	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()
	put(t, server.URL+"/torrents/"+hash.HexString()+"/files", `{"files":[0]}`).Body.Close()
	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)

	waitFor(t, 30*time.Second, func() bool {
		data, err := os.ReadFile(path)
		return err == nil && bytes.Equal(data, first)
	})

	server.Close()
	client.Close()
	// Отметки кусков — bolt-файл: второй движок откроет его только после первого
	store.completion.Close()

	restarted, _ := newTestEngine(t, dataDir)
	restarted.restore(context.Background())
	again, _ := restarted.client.Torrent(hash)
	again.AddClientPeer(fx.seeder)

	// Кусок на стыке докачивается снова: ждём, пока движок снова считает файл готовым
	waitFor(t, 30*time.Second, func() bool {
		return restarted.stateOf(again).WantedCompleted == int64(len(first))
	})
	time.Sleep(300 * time.Millisecond)

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, first) {
		t.Fatal("finished file was overwritten after restart")
	}
}

// Недокачанный `.part` прежней версии движка становится файлом под итоговым
// именем, а готовый файл с тем же именем не трогается
func TestPartFilesAreAdopted(t *testing.T) {
	fx := newFixture(t)
	downloads := filepath.Join(t.TempDir(), "downloads")
	path := filepath.Join(downloads, "Sample.Movie.mkv")

	if err := os.MkdirAll(downloads, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+partFileSuffix, fx.content, 0o644); err != nil {
		t.Fatal(err)
	}

	info, err := fx.meta.UnmarshalInfo()
	if err != nil {
		t.Fatal(err)
	}

	adoptPartFiles(downloads, &info)

	if data, err := os.ReadFile(path); err != nil || !bytes.Equal(data, fx.content) {
		t.Fatalf("part file was not adopted: %v", err)
	}

	// Итоговый файл уже есть: второй `.part` его не заменяет
	if err := os.WriteFile(path+partFileSuffix, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}
	adoptPartFiles(downloads, &info)

	if data, _ := os.ReadFile(path); !bytes.Equal(data, fx.content) {
		t.Fatal("existing file was replaced by a part file")
	}
}

// Файл раздачи, чьё имя само оканчивается на `.part`, — настоящий файл, а не
// недокачанный хвост соседа: под имя соседа он не переименовывается
func TestPartFileOfTorrentIsNotAdopted(t *testing.T) {
	downloads := filepath.Join(t.TempDir(), "downloads")
	dir := filepath.Join(downloads, "Pack")
	info := metainfo.Info{
		Name:        "Pack",
		PieceLength: 16 << 10,
		Files: []metainfo.FileInfo{
			{Path: []string{"A.mkv"}, Length: 4},
			{Path: []string{"A.mkv" + partFileSuffix}, Length: 4},
		},
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "A.mkv"+partFileSuffix), []byte("part"), 0o644); err != nil {
		t.Fatal(err)
	}

	adoptPartFiles(downloads, &info)

	if _, err := os.Stat(filepath.Join(dir, "A.mkv"+partFileSuffix)); err != nil {
		t.Fatalf("torrent file was renamed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "A.mkv")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("sibling file was created: %v", err)
	}
}

// Паника в обработчике не оставляет движок жить с захваченной блокировкой
func TestHandlerPanicExitsEngine(t *testing.T) {
	engine, _ := newTestEngine(t, t.TempDir())

	var code int
	engine.exit = func(c int) { code = c }

	handler := engine.crashOnPanic(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("library failed while holding the client lock")
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/torrents", nil))

	if code != 2 {
		t.Fatalf("exit code %d, want 2", code)
	}
}

// Сторож с частой пробой и порогом `stuckFrom`; остановка ждёт его выхода,
// чтобы горутина не пережила тест
func startWatchdog(t *testing.T, engine *api, stuckFrom time.Duration, probe func()) {
	t.Helper()

	engine.watchEvery = 10 * time.Millisecond
	engine.lockStuckFrom = stuckFrom

	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		engine.watchdog(ctx, probe)
	}()

	t.Cleanup(func() {
		cancel()
		<-stopped
	})
}

func healthStatus(t *testing.T, url string) (int, string) {
	t.Helper()

	response, err := http.Get(url + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	var body struct{ Status string }
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	return response.StatusCode, body.Status
}

// Захваченная блокировка клиента: проба не возвращается — движок выходит, а
// `/health` до выхода честно говорит `stuck`
func TestStuckClientLockExitsEngine(t *testing.T) {
	engine, server := newTestEngine(t, t.TempDir())
	engine.restored.Store(true)

	exited := make(chan int, 1)
	engine.exit = func(code int) { exited <- code }

	held := make(chan struct{})
	t.Cleanup(func() { close(held) })
	startWatchdog(t, engine, 100*time.Millisecond, func() { <-held })

	select {
	case code := <-exited:
		if code != 2 {
			t.Fatalf("exit code %d, want 2", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("engine did not exit with the client lock held")
	}

	if status, body := healthStatus(t, server.URL); status != http.StatusServiceUnavailable || body != "stuck" {
		t.Fatalf("health %d %q, want 503 stuck", status, body)
	}
}

func TestFreeClientLockKeepsEngine(t *testing.T) {
	engine, server := newTestEngine(t, t.TempDir())
	engine.restored.Store(true)
	engine.exit = func(int) { t.Error("engine exited with a free client lock") }

	// Порог с запасом: под -race на нагруженной машине проба свободной
	// блокировки может занять заметно больше интервала
	startWatchdog(t, engine, time.Second, func() { engine.client.Torrents() })
	// Дольше порога: `/health` видит, что проба обновляется, а не одну первую
	time.Sleep(1200 * time.Millisecond)

	if status, body := healthStatus(t, server.URL); status != http.StatusOK || body != "ok" {
		t.Fatalf("health %d %q, want 200 ok", status, body)
	}
}

// Раздача на паузе с выбором после перезапуска: снятие выбора не вешает
// движок (пауза оставляла ожидающие куски несогласованными, и самопроверка
// библиотеки паниковала внутри `File.SetPriority` под блокировкой клиента)
func TestRestoredPausedSelectionCanBeCleared(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	hash := fx.meta.HashInfoBytes()

	{
		_, server := newTestEngine(t, dataDir)
		post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()
		post(t, server.URL+"/torrents/"+hash.HexString()+"/pause", nil).Body.Close()
	}

	restartDir := t.TempDir()
	copyDir(t, filepath.Join(dataDir, "torrents"), filepath.Join(restartDir, "torrents"))
	engine, server := newTestEngine(t, restartDir)
	engine.exit = func(int) { t.Error("engine exited after a handler panic") }
	engine.restore(context.Background())

	client := &http.Client{Timeout: 5 * time.Second}
	request, _ := http.NewRequest(http.MethodPut, server.URL+"/torrents/"+hash.HexString()+"/files", bytes.NewReader([]byte(`{"files":[]}`)))
	cleared, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	cleared.Body.Close()

	listed, err := client.Get(server.URL + "/torrents")
	if err != nil {
		t.Fatalf("engine hangs after clearing the selection: %v", err)
	}
	listed.Body.Close()

	if cleared.StatusCode != http.StatusNoContent || listed.StatusCode != http.StatusOK {
		t.Fatalf("clear %d, list %d", cleared.StatusCode, listed.StatusCode)
	}
}

func TestLibraryLogDropsCanceledReads(t *testing.T) {
	var out bytes.Buffer
	logger := slog.New(withoutCanceled{slog.NewTextHandler(&out, nil)}).With("torrent.ih", "abc")

	logger.Error("initial read failed", "err", context.Canceled)
	logger.Error("read failed after reader reset", "err", fmt.Errorf("wait: %w", context.Canceled))
	logger.Error("error reading", "err", io.ErrUnexpectedEOF)

	lines := strings.Split(strings.TrimSpace(out.String()), "\n")

	if len(lines) != 1 || !strings.Contains(lines[0], `msg="error reading"`) {
		t.Fatalf("journal %q", out.String())
	}
}

// Клиент с конфигурацией движка, но без HTTP API: обмен движка с движком
func newEngineClient(t *testing.T) (*torrent.Client, string) {
	t.Helper()

	dataDir := t.TempDir()
	downloads := filepath.Join(dataDir, "downloads")
	cfg, _, err := newClientConfig(downloads, dataDir, defaultOptions())
	if err != nil {
		t.Fatal(err)
	}
	offline(cfg)

	client, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}

	return client, downloads
}

// Писатель соединения anacrolix v1.61 изредка теряет пробуждение
// (`peerKeepAlive`): у качающего не уходит Interested или запрос, у
// отдающего — кусок. Без короткого keepalive такая закачка стоит минуту.
// Частота — несколько процентов коротких обменов под `-race`, поэтому их сотни
func TestEnginesExchangeWithoutStalls(t *testing.T) {
	const rounds, parallel = 16, 16

	for round := range rounds {
		exchangeRound(t, round, parallel)
	}
}

func exchangeRound(t *testing.T, round, parallel int) {
	t.Helper()

	var leechers []*torrent.Torrent
	var clients []*torrent.Client
	// И после `t.Fatal`: сотни клиентов под `-race` упираются в предел горутин
	defer func() {
		for _, client := range clients {
			client.Close()
		}
	}()

	for i := range parallel {
		name := fmt.Sprintf("Exchange.%d.%d.mkv", round, i)
		content := make([]byte, 64<<10)
		_, _ = rand.Read(content)

		seeder, downloads := newEngineClient(t)
		leecher, _ := newEngineClient(t)
		clients = append(clients, seeder, leecher)

		if err := os.WriteFile(filepath.Join(downloads, name), content, 0o644); err != nil {
			t.Fatal(err)
		}

		info := metainfo.Info{PieceLength: 32 << 10}
		if err := info.BuildFromFilePath(filepath.Join(downloads, name)); err != nil {
			t.Fatal(err)
		}
		infoBytes, err := bencode.Marshal(info)
		if err != nil {
			t.Fatal(err)
		}
		meta := &metainfo.MetaInfo{InfoBytes: infoBytes}

		st, err := seeder.AddTorrent(meta)
		if err != nil {
			t.Fatal(err)
		}
		if err := st.VerifyData(); err != nil {
			t.Fatal(err)
		}

		lt, err := leecher.AddTorrent(meta)
		if err != nil {
			t.Fatal(err)
		}
		lt.DownloadAll()
		lt.AddClientPeer(seeder)
		leechers = append(leechers, lt)
	}

	// Зависание с каждой стороны лечится за `peerKeepAlive`, без него — за
	// минуту: она в срок не влезает
	deadline := time.Now().Add(20 * time.Second)
	for _, lt := range leechers {
		for lt.BytesMissing() != 0 {
			if time.Now().After(deadline) {
				t.Fatalf("round %d: exchange stalled with %d bytes missing", round, lt.BytesMissing())
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
}
