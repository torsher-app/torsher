package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// IO выбирается upstream до TestMain. Перезапуск, а не Setenv, проверяет
// тот же classic режим, который production supervisor задаёт до spawn.
func TestMain(m *testing.M) {
	if os.Getenv("TORRENT_STORAGE_DEFAULT_FILE_IO") != "classic" {
		command := exec.Command(os.Args[0], os.Args[1:]...)
		for _, value := range os.Environ() {
			if !strings.HasPrefix(value, "TORRENT_STORAGE_DEFAULT_FILE_IO=") {
				command.Env = append(command.Env, value)
			}
		}
		command.Env = append(command.Env, "TORRENT_STORAGE_DEFAULT_FILE_IO=classic")
		command.Stdout, command.Stderr = os.Stdout, os.Stderr
		if err := command.Run(); err != nil {
			if exit, ok := err.(*exec.ExitError); ok {
				os.Exit(exit.ExitCode())
			}
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestShortStorageFileProcessSurvives(t *testing.T) {
	if os.Getenv("TORSHER_SHORT_FILE_CHILD") != "1" {
		command := exec.Command(os.Args[0], "-test.run=^TestShortStorageFileProcessSurvives$")
		command.Env = append(os.Environ(), "TORSHER_SHORT_FILE_CHILD=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("short read killed process: %v\n%s", err, output)
		}
		return
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "fixture.bin"), make([]byte, 4096), 0600); err != nil {
		t.Fatal(err)
	}
	info := metainfo.Info{Name: "fixture.bin", Length: 12288, PieceLength: 4096, Pieces: make([]byte, 60)}
	client := fileStorage(dir, storage.NewMapPieceCompletion())
	defer client.Close()
	tor, err := client.OpenTorrent(context.Background(), &info, metainfo.Hash{})
	if err != nil {
		t.Fatal(err)
	}
	defer tor.Close()
	n, err := tor.Piece(info.Piece(2)).ReadAt(make([]byte, 32), 0)
	if n != 0 || !errors.Is(err, io.EOF) {
		t.Fatalf("read = %d, %v", n, err)
	}
}

func TestOwnershipAliasesAndConcurrentReservations(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source")
	if err := os.WriteFile(path, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	hard := filepath.Join(root, "hard")
	if err := os.Link(path, hard); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(root, alias); err != nil {
		t.Fatal(err)
	}
	first, second := metainfo.Hash{1}, metainfo.Hash{2}
	s := newStorageOwnership()
	if err := s.reserve(first, root, []string{path, filepath.Join(root, "missing", "episode")}); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{hard, filepath.Join(alias, "source"), filepath.Join(alias, "missing", "episode")} {
		if err := s.reserve(second, root, []string{path}); !errors.Is(err, errStorageConflict) {
			t.Fatalf("alias accepted: %s %v", path, err)
		}
	}
	if err := s.reserve(second, root, []string{filepath.Join(root, "other")}); err != nil {
		t.Fatal(err)
	}
	for range 20 {
		s := newStorageOwnership()
		var wait sync.WaitGroup
		results := make(chan error, 2)
		for _, hash := range []metainfo.Hash{first, second} {
			wait.Add(1)
			go func() { defer wait.Done(); results <- s.reserve(hash, root, []string{path}) }()
		}
		wait.Wait()
		close(results)
		success := 0
		for err := range results {
			if err == nil {
				success++
			}
		}
		if success != 1 {
			t.Fatalf("owners = %d", success)
		}
	}
}

func TestOwnershipBindMountAliases(t *testing.T) {
	left, right := os.Getenv("TORSHER_TEST_BIND_LEFT"), os.Getenv("TORSHER_TEST_BIND_RIGHT")
	if left == "" || right == "" {
		t.Skip("requires two bind mounts")
	}
	root, err := os.MkdirTemp(left, "ownership-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	alias := filepath.Join(right, filepath.Base(root))
	if samePath(canonicalMaintenancePath(root), canonicalMaintenancePath(alias)) {
		t.Fatal("requires distinct bind paths")
	}
	for _, relative := range []string{"existing", filepath.Join("future", "episode")} {
		if relative == "existing" {
			if err := os.WriteFile(filepath.Join(root, relative), []byte("synthetic"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		registry := newStorageOwnership()
		if err := registry.reserve(metainfo.Hash{1}, root, []string{filepath.Join(root, relative)}); err != nil {
			t.Fatal(err)
		}
		if err := registry.reserve(metainfo.Hash{2}, alias, []string{filepath.Join(alias, relative)}); !errors.Is(err, errStorageConflict) {
			t.Fatalf("bind alias %s = %v", relative, err)
		}
	}
}

func TestStorageConflictBothOrdersAndEqualLengths(t *testing.T) {
	for _, size := range []int{8192, 12288} {
		for _, reverse := range []bool{false, true} {
			t.Run(fmt.Sprintf("size=%d/reverse=%v", size, reverse), func(t *testing.T) {
				first := newNamedFixture(t, "collision.mkv", 8192)
				second := newNamedFixture(t, "collision.mkv", size)
				if reverse {
					first, second = second, first
				}
				engine, server := newTestEngine(t, t.TempDir())
				post(t, server.URL+"/torrents", first.raw).Body.Close()
				response, err := http.Post(server.URL+"/torrents", "application/x-bittorrent", bytes.NewReader(second.raw))
				if err != nil {
					t.Fatal(err)
				}
				defer response.Body.Close()
				var body struct {
					Kind string `json:"kind"`
				}
				_ = json.NewDecoder(response.Body).Decode(&body)
				if response.StatusCode != 409 || body.Kind != "storage_path_conflict" {
					t.Fatalf("%d: %+v", response.StatusCode, body)
				}
				if _, exists := engine.client.Torrent(second.meta.HashInfoBytes()); exists {
					t.Fatal("conflicting storage opened")
				}
				other := newNamedFixture(t, "independent.mkv", 4096)
				post(t, server.URL+"/torrents", other.raw).Body.Close()
			})
		}
	}
}

func TestRestoreConflictsPreservesSessionsAndAllowsIsolatedRecovery(t *testing.T) {
	root := t.TempDir()
	first := newNamedFixture(t, "collision.mkv", 8192)
	second := newNamedFixture(t, "collision.mkv", 12288)
	other := newNamedFixture(t, "independent.mkv", 4096)
	engine, server := newTestEngine(t, root)
	for _, fx := range []fixture{first, second, other} {
		if err := engine.session.save(fx.meta, func(s *savedTorrent) { s.Selected = []int{0}; s.Paused = true }); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(engine.downloads, "collision.mkv")
	if err := os.MkdirAll(engine.downloads, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, first.content, 0600); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(engine.session.path(first.meta.HashInfoBytes(), ".json"))
	engine.restore(context.Background())
	if !engine.restored.Load() {
		t.Fatal("restore not ready")
	}
	for _, fx := range []fixture{first, second} {
		if _, live := engine.client.Torrent(fx.meta.HashInfoBytes()); live {
			t.Fatal("conflict opened")
		}
	}
	if _, live := engine.client.Torrent(other.meta.HashInfoBytes()); !live {
		t.Fatal("unrelated not restored")
	}
	after, _ := os.ReadFile(engine.session.path(first.meta.HashInfoBytes(), ".json"))
	content, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) || !bytes.Equal(content, first.content) {
		t.Fatal("preflight changed original files")
	}
	request, _ := http.NewRequest("DELETE", server.URL+"/torrents/"+first.meta.HashInfoBytes().HexString()+"?delete_files=true", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 409 {
		t.Fatalf("shared delete = %d", response.StatusCode)
	}
	dir := filepath.Join(root, "isolated")
	// Resolve мог узнать metadata заблокированной сохранённой сессии:
	// последующий add обязан переоткрыть disabled storage даже при session.has.
	spec, err := torrent.TorrentSpecFromMetaInfoErr(first.meta)
	if err != nil {
		t.Fatal(err)
	}
	spec.Storage = metadataOnlyStorage{}
	if _, _, err := engine.client.AddTorrentSpec(spec); err != nil {
		t.Fatal(err)
	}
	engine.metadataOnly.Store(first.meta.HashInfoBytes(), true)
	response = post(t, server.URL+"/torrents?dir="+dir+"&paused=true&files=0", first.raw)
	var details torrentDetails
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if details.Dir != dir {
		t.Fatalf("dir = %q", details.Dir)
	}
	if !details.Paused {
		t.Fatal("add response lost durable pause state")
	}
	torrent, live := engine.client.Torrent(first.meta.HashInfoBytes())
	if !live || !engine.stateOf(torrent).Paused {
		t.Fatal("isolated paused session not restored")
	}
	content, _ = os.ReadFile(path)
	if !bytes.Equal(content, first.content) {
		t.Fatal("isolated add changed original")
	}
}

func TestStorageConflictMoveAndUnrelatedRange(t *testing.T) {
	root := t.TempDir()
	engine, server := newTestEngine(t, root)
	first := newNamedFixture(t, "collision.mkv", 8192)
	second := newNamedFixture(t, "collision.mkv", 12288)
	third := newNamedFixture(t, "independent.mkv", 16384)
	if err := os.MkdirAll(engine.downloads, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(engine.downloads, "independent.mkv"), third.content, 0600); err != nil {
		t.Fatal(err)
	}
	post(t, server.URL+"/torrents", first.raw).Body.Close()
	post(t, server.URL+"/torrents?dir="+filepath.Join(root, "other"), second.raw).Body.Close()
	post(t, server.URL+"/torrents", third.raw).Body.Close()
	code, body := postMove(t, server.URL, second.meta.HashInfoBytes(), engine.downloads)
	if code != 409 || body["kind"] != "storage_path_conflict" {
		t.Fatalf("move = %d %+v", code, body)
	}
	if _, exists := engine.client.Torrent(second.meta.HashInfoBytes()); !exists {
		t.Fatal("conflict dropped source")
	}
	request, _ := http.NewRequest("GET", server.URL+"/torrents/"+third.meta.HashInfoBytes().HexString()+"/files/0/stream", nil)
	request.Header.Set("Range", "bytes=100-299")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 206 || !bytes.Equal(data, third.content[100:300]) {
		t.Fatalf("unrelated range = %d %v (%d bytes)", response.StatusCode, err, len(data))
	}
	request, _ = http.NewRequest("DELETE", server.URL+"/torrents/"+first.meta.HashInfoBytes().HexString(), nil)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("forget = %d", response.StatusCode)
	}
	// Refresh освобождает старую ownership, чтобы новая версия заняла исходный путь.
	code, body = postMove(t, server.URL, second.meta.HashInfoBytes(), engine.downloads)
	if code != 202 && code != 200 {
		t.Fatalf("move after forget = %d %+v", code, body)
	}
	waitFor(t, 5*time.Second, func() bool { return !engine.isMoving(second.meta.HashInfoBytes()) })
}
