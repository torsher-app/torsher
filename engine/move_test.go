package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/anacrolix/torrent/metainfo"
)

func moveTorrent(t *testing.T, server string, hash metainfo.Hash, dir string) moveState {
	t.Helper()

	response := post(t, server+"/torrents/"+hash.HexString()+"/move", []byte(fmt.Sprintf(`{"dir":%q}`, dir)))
	if response.StatusCode != http.StatusAccepted && response.StatusCode != http.StatusOK {
		t.Fatalf("move: status %d", response.StatusCode)
	}
	response.Body.Close()

	var state moveState
	waitFor(t, 30*time.Second, func() bool {
		response, err := http.Get(server + "/torrents/" + hash.HexString() + "/move")
		if err != nil {
			t.Fatal(err)
		}
		state = decode[moveState](t, response)
		return state.State != "running"
	})

	return state
}

func downloaded(t *testing.T, engine *api, server *httptest.Server, fx fixture) metainfo.Hash {
	t.Helper()

	hash := downloadFixture(t, engine, server, fx)
	waitFor(t, 30*time.Second, func() bool {
		return stateOfHash(t, engine, hash).WantedCompleted == int64(len(fx.content))
	})

	return hash
}

func TestMoveKeepsDataAndPieces(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := downloaded(t, engine, server, fx)
	target := filepath.Join(t.TempDir(), "big")

	state := moveTorrent(t, server.URL, hash, target)
	if state.State != "done" || state.BytesDone != int64(len(fx.content)) {
		t.Fatalf("unexpected move state %+v", state)
	}

	moved, err := os.ReadFile(filepath.Join(target, "Sample.Movie.mkv"))
	if err != nil || !bytes.Equal(moved, fx.content) {
		t.Fatalf("moved file differs: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dataDir, "downloads", "Sample.Movie.mkv")); !os.IsNotExist(err) {
		t.Fatalf("source file was not removed: %v", err)
	}

	if got := stateOfHash(t, engine, hash); got.BytesCompleted != int64(len(fx.content)) || len(got.Selected) != 1 {
		t.Fatalf("pieces or selection lost after move: %+v", got)
	}

	if saved := engine.session.get(hash); saved.Dir != target || saved.MovingTo != "" || saved.MovedFrom != "" {
		t.Fatalf("unexpected session %+v", saved)
	}

	// Перезапуск открывает раздачу в новом каталоге со скачанными кусками
	restartDir := t.TempDir()
	copyDir(t, filepath.Join(dataDir, "torrents"), filepath.Join(restartDir, "torrents"))
	restarted, _ := newTestEngine(t, restartDir)
	restarted.restore(context.Background())

	if dir := restarted.dirOf(hash); dir != target {
		t.Fatalf("restored in %q, want %q", dir, target)
	}
}

func TestMoveCopiesAcrossVolumes(t *testing.T) {
	linkFile = func(string, string) error { return &os.LinkError{Op: "link", Err: syscall.EXDEV} }
	t.Cleanup(func() { linkFile = os.Link })

	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := downloaded(t, engine, server, fx)
	target := t.TempDir()

	if state := moveTorrent(t, server.URL, hash, target); state.State != "done" {
		t.Fatalf("unexpected move state %+v", state)
	}

	moved, err := os.ReadFile(filepath.Join(target, "Sample.Movie.mkv"))
	if err != nil || !bytes.Equal(moved, fx.content) {
		t.Fatalf("copied file differs: %v", err)
	}

	if _, err := os.Stat(filepath.Join(target, "Sample.Movie.mkv"+moveSuffix)); !os.IsNotExist(err) {
		t.Fatal("temporary file is left behind")
	}
}

func TestAddPutsTorrentIntoItsDir(t *testing.T) {
	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	hash := fx.meta.HashInfoBytes()
	target := t.TempDir()

	response := post(t, server.URL+"/torrents?files=0&dir="+target, fx.raw)
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("add: status %d", response.StatusCode)
	}

	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)
	waitFor(t, 30*time.Second, func() bool {
		return stateOfHash(t, engine, hash).WantedCompleted == int64(len(fx.content))
	})

	if data, err := os.ReadFile(filepath.Join(target, "Sample.Movie.mkv")); err != nil || !bytes.Equal(data, fx.content) {
		t.Fatalf("file is not in the torrent dir: %v", err)
	}

	if saved := engine.session.get(hash); saved.Dir != target {
		t.Fatalf("dir is not saved: %+v", saved)
	}

	if response := post(t, server.URL+"/torrents?dir=relative", fx.raw); response.StatusCode != http.StatusBadRequest {
		t.Fatalf("relative dir: status %d", response.StatusCode)
	}
}

func TestCopySparseKeepsHoles(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	data := bytes.Repeat([]byte("torsher"), 1<<16)

	f, err := os.Create(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(64 << 20); err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt(data, 32<<20); err != nil {
		t.Fatal(err)
	}
	f.Close()

	if holes, _ := fileHoles(src); len(holes) == 0 {
		t.Skip("file system has no sparse files")
	}

	var copied int64
	dst := filepath.Join(dir, "dst")
	if err := copySparse(src, dst, func(n int64) { copied += n }); err != nil {
		t.Fatal(err)
	}

	want, _ := os.ReadFile(src)
	got, _ := os.ReadFile(dst)
	if !bytes.Equal(got, want) {
		t.Fatal("copy differs from the source")
	}

	if copied >= 64<<20 || copied < int64(len(data)) {
		t.Fatalf("copied %d bytes: holes were not skipped", copied)
	}

	if dataSize(dst) >= 64<<20 {
		t.Fatal("copy is not sparse")
	}
}

// Перезапуск посреди переноса: поставленное в новом каталоге убирается,
// раздача остаётся в старом
func TestInterruptedMoveIsRolledBack(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := downloaded(t, engine, server, fx)
	target := t.TempDir()

	if err := os.WriteFile(filepath.Join(target, "Sample.Movie.mkv"+moveSuffix), []byte("half"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := engine.session.update(hash, func(saved *savedTorrent) { saved.MovingTo = target }); err != nil {
		t.Fatal(err)
	}

	restartDir := t.TempDir()
	copyDir(t, filepath.Join(dataDir, "torrents"), filepath.Join(restartDir, "torrents"))
	restarted, _ := newTestEngine(t, restartDir)
	restarted.downloads = filepath.Join(dataDir, "downloads")
	restarted.restore(context.Background())

	if entries, _ := os.ReadDir(target); len(entries) != 0 {
		t.Fatalf("placed files are left in the new dir: %v", entries)
	}

	if saved := restarted.session.get(hash); saved.MovingTo != "" || saved.Dir != "" {
		t.Fatalf("unexpected session %+v", saved)
	}

	if _, err := os.Stat(filepath.Join(dataDir, "downloads", "Sample.Movie.mkv")); err != nil {
		t.Fatalf("source file is gone: %v", err)
	}
}

// Перезапуск после переключения каталога: исходники в старом удаляются
func TestSwitchedMoveRemovesSourcesOnRestore(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := downloaded(t, engine, server, fx)
	source := filepath.Join(dataDir, "downloads")
	target := t.TempDir()

	if err := os.Link(filepath.Join(source, "Sample.Movie.mkv"), filepath.Join(target, "Sample.Movie.mkv")); err != nil {
		t.Fatal(err)
	}
	if err := engine.session.update(hash, func(saved *savedTorrent) {
		saved.Dir = target
		saved.MovedFrom = source
	}); err != nil {
		t.Fatal(err)
	}

	restartDir := t.TempDir()
	copyDir(t, filepath.Join(dataDir, "torrents"), filepath.Join(restartDir, "torrents"))
	restarted, _ := newTestEngine(t, restartDir)
	restarted.restore(context.Background())

	if _, err := os.Stat(filepath.Join(source, "Sample.Movie.mkv")); !os.IsNotExist(err) {
		t.Fatalf("source file was not removed: %v", err)
	}

	if saved := restarted.session.get(hash); saved.MovedFrom != "" || saved.Dir != target {
		t.Fatalf("unexpected session %+v", saved)
	}
}

func TestMovingTorrentIsBusy(t *testing.T) {
	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	hash := fx.meta.HashInfoBytes()
	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()

	engine.moves[hash] = &moveJob{state: moveState{State: "running"}}

	response, _ := http.Get(server.URL + "/torrents/" + hash.HexString() + "/stats")
	body := decode[map[string]string](t, response)
	if response.StatusCode != http.StatusConflict || body["kind"] != "torrent_moving" {
		t.Fatalf("status %d, body %v", response.StatusCode, body)
	}

	if response := post(t, server.URL+"/torrents?files=0", fx.raw); response.StatusCode != http.StatusConflict {
		t.Fatalf("add while moving: status %d", response.StatusCode)
	}
}

func postMove(t *testing.T, server string, hash metainfo.Hash, dir string) (int, map[string]any) {
	t.Helper()

	response := post(t, server+"/torrents/"+hash.HexString()+"/move", []byte(fmt.Sprintf(`{"dir":%q}`, dir)))

	return response.StatusCode, decode[map[string]any](t, response)
}

// Симлинк на текущий каталог — тот же каталог: перенос удалил бы исходники
func TestMoveIntoSameDirUnderOtherPathSwitchesPath(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := downloaded(t, engine, server, fx)
	downloads := filepath.Join(dataDir, "downloads")
	alias := filepath.Join(t.TempDir(), "alias")

	if err := os.Symlink(downloads, alias); err != nil {
		t.Fatal(err)
	}

	status, body := postMove(t, server.URL, hash, alias)
	if status != http.StatusOK || body["state"] != "done" {
		t.Fatalf("status %d, body %v", status, body)
	}

	if data, err := os.ReadFile(filepath.Join(downloads, "Sample.Movie.mkv")); err != nil || !bytes.Equal(data, fx.content) {
		t.Fatalf("file is lost: %v", err)
	}

	if saved := engine.session.get(hash); saved.Dir != alias || saved.MovingTo != "" {
		t.Fatalf("session is not switched: %+v", saved)
	}

	if dir := engine.dirOf(hash); dir != alias {
		t.Fatalf("dir is %q, want %q", dir, alias)
	}

	if _, ok := engine.client.Torrent(hash); !ok {
		t.Fatal("torrent is not reopened")
	}

	if entries, _ := os.ReadDir(downloads); len(entries) != 1 {
		t.Fatalf("probe file is left behind: %v", entries)
	}

	start := int64(1<<20 + 777)
	request, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/torrents/%s/files/0/stream", server.URL, hash.HexString()), nil)
	request.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, start+99))

	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	streamed, _ := io.ReadAll(response.Body)

	if response.StatusCode != http.StatusPartialContent || !bytes.Equal(streamed, fx.content[start:start+100]) {
		t.Fatalf("stream after switch: status %d", response.StatusCode)
	}
}

func TestParallelMovesStartOnce(t *testing.T) {
	release := make(chan struct{})
	linkFile = func(src, dst string) error {
		<-release
		return os.Link(src, dst)
	}
	t.Cleanup(func() { linkFile = os.Link })

	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := downloaded(t, engine, server, fx)
	target := filepath.Join(t.TempDir(), "moved")

	type result struct {
		status int
		kind   any
	}

	results := make(chan result, 8)
	start := make(chan struct{})
	var wg sync.WaitGroup

	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			response, err := http.Post(server.URL+"/torrents/"+hash.HexString()+"/move", "application/json", strings.NewReader(fmt.Sprintf(`{"dir":%q}`, target)))
			if err != nil {
				results <- result{status: -1}
				return
			}
			var body map[string]any
			_ = json.NewDecoder(response.Body).Decode(&body)
			response.Body.Close()
			results <- result{status: response.StatusCode, kind: body["kind"]}
		}()
	}

	close(start)
	wg.Wait()
	close(release)
	close(results)

	accepted := 0
	for got := range results {
		switch {
		case got.status == http.StatusAccepted:
			accepted++
		case got.status != http.StatusConflict || got.kind != "torrent_moving":
			t.Fatalf("unexpected response %+v", got)
		}
	}

	if accepted != 1 {
		t.Fatalf("%d moves started", accepted)
	}

	var state moveState
	waitFor(t, 30*time.Second, func() bool {
		response, err := http.Get(server.URL + "/torrents/" + hash.HexString() + "/move")
		if err != nil {
			t.Fatal(err)
		}
		state = decode[moveState](t, response)
		return state.State != "running"
	})

	if state.State != "done" {
		t.Fatalf("unexpected move state %+v", state)
	}

	if data, err := os.ReadFile(filepath.Join(target, "Sample.Movie.mkv")); err != nil || !bytes.Equal(data, fx.content) {
		t.Fatalf("moved file differs: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dataDir, "downloads", "Sample.Movie.mkv")); !os.IsNotExist(err) {
		t.Fatalf("source file was not removed: %v", err)
	}
}

// Раздача только из поиска метаданных: `.torrent` в сессии нет
func TestMoveWithoutSessionIsNotFound(t *testing.T) {
	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())

	if _, err := engine.client.AddTorrent(fx.meta); err != nil {
		t.Fatal(err)
	}

	hash := fx.meta.HashInfoBytes()
	status, body := postMove(t, server.URL, hash, t.TempDir())
	if status != http.StatusNotFound || body["kind"] != "torrent_not_found" {
		t.Fatalf("status %d, body %v", status, body)
	}

	if response, _ := http.Get(server.URL + "/torrents/" + hash.HexString() + "/move"); response.StatusCode != http.StatusNotFound {
		t.Fatalf("move job is left: status %d", response.StatusCode)
	}
}

func TestMoveKeepsForeignFileInTarget(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := downloaded(t, engine, server, fx)
	target := t.TempDir()
	foreign := []byte("someone else's movie")

	if err := os.WriteFile(filepath.Join(target, "Sample.Movie.mkv"), foreign, 0o644); err != nil {
		t.Fatal(err)
	}

	state := moveTorrent(t, server.URL, hash, target)
	if state.State != "failed" || state.Kind != "exists" {
		t.Fatalf("unexpected move state %+v", state)
	}

	if data, _ := os.ReadFile(filepath.Join(target, "Sample.Movie.mkv")); !bytes.Equal(data, foreign) {
		t.Fatal("foreign file was changed")
	}

	source := filepath.Join(dataDir, "downloads")
	if data, err := os.ReadFile(filepath.Join(source, "Sample.Movie.mkv")); err != nil || !bytes.Equal(data, fx.content) {
		t.Fatalf("source file is lost: %v", err)
	}

	if _, ok := engine.client.Torrent(hash); !ok || engine.dirOf(hash) != source {
		t.Fatal("torrent is not back in its dir")
	}

	if saved := engine.session.get(hash); saved.MovingTo != "" || len(saved.Placed) != 0 {
		t.Fatalf("unexpected session %+v", saved)
	}
}

// Перезапуск посреди переноса: чужой файл под тем же именем откат не трогает
func TestInterruptedMoveKeepsForeignFile(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := downloaded(t, engine, server, fx)
	target := t.TempDir()
	foreign := []byte("someone else's movie")

	if err := os.WriteFile(filepath.Join(target, "Sample.Movie.mkv"), foreign, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := engine.session.update(hash, func(saved *savedTorrent) { saved.MovingTo = target }); err != nil {
		t.Fatal(err)
	}

	restartDir := t.TempDir()
	copyDir(t, filepath.Join(dataDir, "torrents"), filepath.Join(restartDir, "torrents"))
	restarted, _ := newTestEngine(t, restartDir)
	restarted.downloads = filepath.Join(dataDir, "downloads")
	restarted.restore(context.Background())

	if data, _ := os.ReadFile(filepath.Join(target, "Sample.Movie.mkv")); !bytes.Equal(data, foreign) {
		t.Fatal("foreign file was removed")
	}
}

// Файл, поставленный прошлой попыткой, — свой: повтор ставит его заново
func TestRetriedMoveReplacesOwnFile(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	hash := downloaded(t, engine, server, fx)
	target := t.TempDir()

	if err := os.WriteFile(filepath.Join(target, "Sample.Movie.mkv"), fx.content, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := engine.session.update(hash, func(saved *savedTorrent) {
		saved.MovingTo = target
		saved.Placed = []string{"Sample.Movie.mkv"}
	}); err != nil {
		t.Fatal(err)
	}

	state := moveTorrent(t, server.URL, hash, target)
	if state.State != "done" || state.Kind != "" {
		t.Fatalf("unexpected move state %+v", state)
	}

	if data, err := os.ReadFile(filepath.Join(target, "Sample.Movie.mkv")); err != nil || !bytes.Equal(data, fx.content) {
		t.Fatalf("moved file differs: %v", err)
	}

	if saved := engine.session.get(hash); saved.Dir != target || len(saved.Placed) != 0 {
		t.Fatalf("unexpected session %+v", saved)
	}
}
