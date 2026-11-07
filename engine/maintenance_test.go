//go:build linux || darwin

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/anacrolix/torrent"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
	"golang.org/x/sys/unix"
)

func maintenanceIdentity(t *testing.T, root, path string) maintenancePath {
	t.Helper()
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	var base, file unix.Stat_t
	if err = unix.Stat(root, &base); err != nil {
		t.Fatal(err)
	}
	if err = unix.Stat(path, &file); err != nil {
		t.Fatal(err)
	}
	return maintenancePath{Root: root, Path: path, RootDevice: uint64(base.Dev), RootInode: base.Ino, Device: uint64(file.Dev), Inode: file.Ino, Size: file.Size, Mtime: statMtime(file)}
}
func maintenanceFixture(t *testing.T) maintenancePath {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, "Synthetic.mkv")
	if err := os.WriteFile(path, []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	return maintenanceIdentity(t, root, path)
}
func maintenanceRequest(t *testing.T, a *api, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	if a.maintenanceToken == "" {
		a.maintenanceToken = strings.Repeat("t", 64)
	}
	req.Header.Set("X-Torsher-Maintenance-Token", a.maintenanceToken)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	a.routes().ServeHTTP(rec, req)
	return rec
}
func TestMaintenanceOrphanFenceRestartAndCancellation(t *testing.T) {
	a, _ := newTestEngine(t, t.TempDir())
	item := maintenanceFixture(t)
	manifest := detachManifest{InfoHash: strings.Repeat("a", 40), PieceCount: 2, Paths: []maintenancePath{item}}
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	for i := 0; i < 2; i++ {
		if err := a.completion.Set(metainfo.PieceKey{InfoHash: hash, Index: i}, true); err != nil {
			t.Fatal(err)
		}
	}
	response := maintenanceRequest(t, a, "POST", "/maintenance/orphan/prepare", manifest)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	for i := 0; i < 2; i++ {
		state, err := a.completion.Get(metainfo.PieceKey{InfoHash: hash, Index: i})
		if err != nil || state.Complete {
			t.Fatal("completion survived detach", state, err)
		}
	}
	if !a.maintenanceBlocked(hash, nil) {
		t.Fatal("hash is not held")
	}
	// Перезапуск читает fence до восстановления сессий.
	reloaded := loadMaintenance(a.maintenance.dir)
	if reloaded.loadErr != nil || !reloaded.blocked(manifest.InfoHash, nil) {
		t.Fatal("fence lost", reloaded.loadErr)
	}
	if !reloaded.blocked(strings.Repeat("b", 40), []string{item.Path}) {
		t.Fatal("same path allowed for another hash")
	}
	response = maintenanceRequest(t, a, "POST", "/maintenance/orphan/prepare", manifest)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	changed := manifest
	changed.PieceCount++
	if maintenanceRequest(t, a, "POST", "/maintenance/orphan/prepare", changed).Code != 409 {
		t.Fatal("manifest mutation accepted")
	}
	if maintenanceRequest(t, a, "POST", "/maintenance/orphan/finalize", nil).Code != 409 {
		t.Fatal("unfinished operation finalized")
	}
	if maintenanceRequest(t, a, "POST", "/maintenance/orphan/cancel", nil).Code != 200 {
		t.Fatal("safe cancel failed")
	}
	if a.maintenanceBlocked(hash, nil) {
		t.Fatal("cancel did not release hash")
	}
	if _, err := os.Stat(item.Path); err != nil {
		t.Fatal("cancel removed file", err)
	}
}

type failingCompletion struct{ storage.PieceCompletion }

func (f failingCompletion) Set(metainfo.PieceKey, bool) error {
	return errors.New("injected completion failure")
}
func TestMaintenanceNeverAcknowledgesFailedDetach(t *testing.T) {
	a, _ := newTestEngine(t, t.TempDir())
	item := maintenanceFixture(t)
	manifest := detachManifest{InfoHash: strings.Repeat("c", 40), PieceCount: 1, Paths: []maintenancePath{item}}
	original := a.completion
	a.completion = failingCompletion{original}
	if response := maintenanceRequest(t, a, "POST", "/maintenance/failure/prepare", manifest); response.Code != 500 {
		t.Fatal(response.Code, response.Body.String())
	}
	if a.maintenance.fences["failure"].State != "pending" {
		t.Fatal("failure acknowledged")
	}
	if maintenanceRequest(t, a, "POST", "/maintenance/failure/unlink", map[string]int{"index": 0}).Code != 409 {
		t.Fatal("unlinked without detach")
	}
	a.completion = original
	// Ошибка удаления сессии также оставляет fence pending.
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	dir := a.session.path(hash, ".json")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "block"), []byte("block"), 0600); err != nil {
		t.Fatal(err)
	}
	if maintenanceRequest(t, a, "POST", "/maintenance/failure/prepare", manifest).Code != 500 {
		t.Fatal("session removal failure ignored")
	}
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	if maintenanceRequest(t, a, "POST", "/maintenance/failure/prepare", manifest).Code != 200 {
		t.Fatal("retry failed")
	}
	response := maintenanceRequest(t, a, "POST", "/maintenance/failure/unlink", map[string]int{"index": 0})
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if maintenanceRequest(t, a, "POST", "/maintenance/failure/cancel", nil).Code != 409 {
		t.Fatal("partial cancel allowed")
	}
	if maintenanceRequest(t, a, "POST", "/maintenance/failure/finalize", nil).Code != 200 {
		t.Fatal("finalize failed")
	}
}
func TestMaintenanceRestoreSkipsFencedSession(t *testing.T) {
	a, _ := newTestEngine(t, t.TempDir())
	fx := newNamedFixture(t, "Synthetic.mkv", 1024)
	if err := a.session.save(fx.meta, func(*savedTorrent) {}); err != nil {
		t.Fatal(err)
	}
	item := maintenanceFixture(t)
	info, _ := fx.meta.UnmarshalInfo()
	fence := &detachFence{ID: "restart", Manifest: detachManifest{InfoHash: fx.meta.HashInfoBytes().HexString(), PieceCount: info.NumPieces(), Paths: []maintenancePath{item}}, State: "pending", Results: map[string]string{}}
	if err := a.maintenance.save(fence); err != nil {
		t.Fatal(err)
	}
	a.maintenance = loadMaintenance(a.maintenance.dir)
	a.restore(context.Background())
	if _, exists := a.client.Torrent(fx.meta.HashInfoBytes()); exists {
		t.Fatal("fenced session restored")
	}
	if !a.restored.Load() {
		t.Fatal("unrelated engine readiness blocked")
	}
	release, err := a.maintenanceLease(fx.meta.HashInfoBytes(), nil)
	if release != nil || err == nil {
		t.Fatal("fenced stream admitted")
	}
}
func TestMaintenancePathConflictAndActiveLease(t *testing.T) {
	a, _ := newTestEngine(t, t.TempDir())
	item := maintenanceFixture(t)
	manifest := detachManifest{InfoHash: strings.Repeat("d", 40), PieceCount: 1, Paths: []maintenancePath{item}}
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	release, err := a.maintenanceLease(hash, nil)
	if err != nil {
		t.Fatal(err)
	}
	if maintenanceRequest(t, a, "POST", "/maintenance/lease/prepare", manifest).Code != 409 {
		t.Fatal("active stream detached")
	}
	release()
	if maintenanceRequest(t, a, "POST", "/maintenance/lease/prepare", manifest).Code != 200 {
		t.Fatal("prepare failed")
	}
	var other metainfo.Hash
	_ = other.FromHexString(strings.Repeat("e", 40))
	if release, err = a.maintenanceLease(other, []string{item.Path}); err == nil {
		release()
		t.Fatal("same path admitted")
	}
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(item.Root, alias); err != nil {
		t.Fatal(err)
	}
	if release, err = a.maintenanceLease(other, []string{filepath.Join(alias, filepath.Base(item.Path))}); err == nil {
		release()
		t.Fatal("fence did not block a path alias")
	}
	if response := maintenanceRequest(t, a, http.MethodGet, "/torrents/"+manifest.InfoHash+"/files/0/stream", nil); response.Code != 409 {
		t.Fatal("stream not fenced", response.Code)
	}
}

func TestMaintenanceRequiresPrivateCapability(t *testing.T) {
	a, _ := newTestEngine(t, t.TempDir())
	a.maintenanceToken = strings.Repeat("t", 64)
	for _, path := range []string{"/maintenance/id", "/maintenance/id/prepare"} {
		req := httptest.NewRequest("POST", path, strings.NewReader("{}"))
		rec := httptest.NewRecorder()
		a.routes().ServeHTTP(rec, req)
		if rec.Code != 403 {
			t.Fatal("unauthenticated maintenance", rec.Code)
		}
	}
	req := httptest.NewRequest("POST", "/maintenance/id/prepare", strings.NewReader("{}"))
	req.Header.Set("X-Torsher-Maintenance-Token", a.maintenanceToken)
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	a.routes().ServeHTTP(rec, req)
	if rec.Code != 415 {
		t.Fatal("simple request accepted", rec.Code)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://example.invalid")
	rec = httptest.NewRecorder()
	a.routes().ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatal("browser Origin accepted", rec.Code)
	}
}

func TestMaintenanceLiveDetachUnlinkReaddHasNoReadyPieces(t *testing.T) {
	fx := newNamedFixture(t, "Synthetic.Detach.mkv", 4096)
	data := t.TempDir()
	a, server := newTestEngine(t, data)
	hash := downloadFixture(t, a, server, fx)
	waitFor(t, 10*time.Second, func() bool { return stateOfHash(t, a, hash).WantedCompleted == int64(len(fx.content)) })
	item := maintenanceIdentity(t, filepath.Join(data, "downloads"), filepath.Join(data, "downloads", "Synthetic.Detach.mkv"))
	info, _ := fx.meta.UnmarshalInfo()
	manifest := detachManifest{InfoHash: hash.HexString(), PieceCount: info.NumPieces(), Paths: []maintenancePath{item}}
	response := maintenanceRequest(t, a, "POST", "/maintenance/live/prepare", manifest)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if !a.lifecycle.settled(hash) {
		t.Fatal("storage not quiesced")
	}
	response = maintenanceRequest(t, a, "POST", "/maintenance/live/unlink", map[string]int{"index": 0})
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if maintenanceRequest(t, a, "POST", "/maintenance/live/finalize", nil).Code != 200 {
		t.Fatal("finalize failed")
	}
	added := post(t, server.URL+"/torrents?files=", fx.raw)
	defer added.Body.Close()
	if added.StatusCode != 200 {
		t.Fatal(added.StatusCode)
	}
	if state := stateOfHash(t, a, hash); state.BytesCompleted != 0 {
		t.Fatal("deleted pieces remained ready", state.BytesCompleted)
	}
}

func TestMaintenanceResolveStorageReopensOnRealAdd(t *testing.T) {
	fx := newNamedFixture(t, "Synthetic.Resolve.mkv", 4096)
	a, server := newTestEngine(t, t.TempDir())
	hash := fx.meta.HashInfoBytes()
	type resolvedResult struct {
		response *http.Response
		err      error
	}
	resolvedDone := make(chan resolvedResult, 1)
	go func() {
		response, err := http.Post(server.URL+"/torrents/resolve?timeout_ms=5000", "text/plain", strings.NewReader("magnet:?xt=urn:btih:"+hash.HexString()))
		resolvedDone <- resolvedResult{response, err}
	}()
	var resolved *torrent.Torrent
	waitFor(t, 5*time.Second, func() bool { var ok bool; resolved, ok = a.client.Torrent(hash); return ok })
	resolved.AddClientPeer(fx.seeder)
	result := <-resolvedDone
	if result.err != nil {
		t.Fatal(result.err)
	}
	_, err := io.ReadAll(result.response.Body)
	result.response.Body.Close()
	if err != nil || result.response.StatusCode != 200 {
		t.Fatal("metadata resolution failed", result.response.StatusCode, err)
	}
	if _, err := os.Stat(filepath.Join(a.downloads, "Synthetic.Resolve.mkv")); !os.IsNotExist(err) {
		t.Fatal("metadata-only opened source file", err)
	}
	response := post(t, server.URL+"/torrents?files=0", fx.raw)
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("real add rejected", response.StatusCode)
	}
	actual, ok := a.client.Torrent(hash)
	if !ok || actual == resolved {
		t.Fatal("metadata-only storage not replaced")
	}
	actual.AddClientPeer(fx.seeder)
	waitFor(t, 10*time.Second, func() bool { return stateOfHash(t, a, hash).WantedCompleted == 4096 })
	response, err = http.Get(server.URL + "/torrents/" + hash.HexString() + "/files/0/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || !bytes.Equal(body, fx.content) {
		t.Fatal("real add stream differs", err)
	}
}

func TestMaintenanceJournalRetryConfirmsBeforeAck(t *testing.T) {
	a, _ := newTestEngine(t, t.TempDir())
	item := maintenanceFixture(t)
	manifest := detachManifest{InfoHash: strings.Repeat("f", 40), PieceCount: 1, Paths: []maintenancePath{item}}
	original := maintenanceJournalWrite
	t.Cleanup(func() { maintenanceJournalWrite = original })
	// Ошибка fsync после rename: disk fence уже существует, admission всё ещё закрыт.
	maintenanceJournalWrite = func(path string, value any) error {
		if err := durableJSON(path, value); err != nil {
			return err
		}
		return errors.New("injected_sync")
	}
	if got := maintenanceRequest(t, a, "POST", "/maintenance/durable/prepare", manifest); got.Code != 500 {
		t.Fatal(got.Code)
	}
	if !a.maintenance.blocked(manifest.InfoHash, nil) {
		t.Fatal("unconfirmed fence admitted writes")
	}
	maintenanceJournalWrite = original
	if got := maintenanceRequest(t, a, "POST", "/maintenance/durable/prepare", manifest); got.Code != 200 {
		t.Fatal(got.Body.String())
	}
	// Файл удалён, но результат не записался даже до rename.
	maintenanceJournalWrite = func(path string, value any) error {
		fence := value.(*detachFence)
		if fence.Results["0"] == "removed" {
			return errors.New("injected_write")
		}
		return durableJSON(path, value)
	}
	if got := maintenanceRequest(t, a, "POST", "/maintenance/durable/unlink", map[string]int{"index": 0}); got.Code != 500 {
		t.Fatal(got.Code, got.Body.String())
	}
	if got := maintenanceRequest(t, a, "POST", "/maintenance/durable/prepare", manifest); got.Code != 500 {
		t.Fatal("unpersisted result acknowledged", got.Code)
	}
	maintenanceJournalWrite = original
	if got := maintenanceRequest(t, a, "POST", "/maintenance/durable/prepare", manifest); got.Code != 200 {
		t.Fatal(got.Body.String())
	}
	reloaded := loadMaintenance(a.maintenance.dir)
	if reloaded.fences["durable"].Results["0"] != "removed" {
		t.Fatal("retry ack not durable across restart")
	}
}

func TestMaintenanceNestedEvictedSource(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "pack", "season", "episode.mkv")
	if err := os.MkdirAll(filepath.Dir(source), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	item := maintenanceIdentity(t, root, source)
	if err := os.RemoveAll(filepath.Join(root, "pack")); err != nil {
		t.Fatal(err)
	}
	if err := safeMaintenanceUnlink(item, ".torsher-maintenance-evicted"); err != nil {
		t.Fatal(err)
	}
	// После LRU исходные вложенные каталоги исчезли, библиотечная копия осталась.
	libraryRoot := t.TempDir()
	copyPath := filepath.Join(libraryRoot, "episode.mkv")
	neighbor := filepath.Join(libraryRoot, "unowned.txt")
	for _, path := range []string{copyPath, neighbor} {
		if err := os.WriteFile(path, []byte("synthetic"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	copied := maintenanceIdentity(t, libraryRoot, copyPath)
	a, _ := newTestEngine(t, t.TempDir())
	manifest := detachManifest{InfoHash: strings.Repeat("b", 40), PieceCount: 1, Paths: []maintenancePath{item, copied}}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/nested-copy/prepare", manifest); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	for index := range manifest.Paths {
		if r := maintenanceRequest(t, a, "POST", "/maintenance/nested-copy/unlink", map[string]int{"index": index}); r.Code != 200 {
			t.Fatal(index, r.Body.String())
		}
	}
	if _, err := os.Stat(copyPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("copy not cleaned", err)
	}
	if _, err := os.Stat(neighbor); err != nil {
		t.Fatal("neighbor damaged", err)
	}

	if err := os.Mkdir(filepath.Join(root, "elsewhere"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "elsewhere"), filepath.Join(root, "pack")); err != nil {
		t.Fatal(err)
	}
	if err := safeMaintenanceUnlink(item, ".torsher-maintenance-evicted"); err == nil {
		t.Fatal("symlink accepted as absence")
	}
}

func TestMaintenanceCancelReattachesLiveSession(t *testing.T) {
	fx := newNamedFixture(t, "Synthetic.Cancel.mkv", 4096)
	data := t.TempDir()
	a, server := newTestEngine(t, data)
	hash := downloadFixture(t, a, server, fx)
	waitFor(t, 10*time.Second, func() bool { return stateOfHash(t, a, hash).WantedCompleted == int64(len(fx.content)) })
	item := maintenanceIdentity(t, filepath.Join(data, "downloads"), filepath.Join(data, "downloads", "Synthetic.Cancel.mkv"))
	info, _ := fx.meta.UnmarshalInfo()
	manifest := detachManifest{InfoHash: hash.HexString(), PieceCount: info.NumPieces(), Paths: []maintenancePath{item}}
	for _, step := range []string{"prepare", "cancel"} {
		response := maintenanceRequest(t, a, "POST", "/maintenance/cancel-live/"+step, manifest)
		if response.Code != 200 && response.Code != 202 {
			t.Fatal(step, response.Code, response.Body.String())
		}
	}
	waitFor(t, 10*time.Second, func() bool {
		a.maintenance.mu.Lock()
		defer a.maintenance.mu.Unlock()
		return !a.maintenance.fences["cancel-live"].reattaching
	})
	if a.maintenance.fences["cancel-live"].State != "cancelled" {
		t.Fatal(a.maintenance.fences["cancel-live"].Error)
	}
	state := stateOfHash(t, a, hash)
	if state.BytesCompleted != int64(len(fx.content)) || len(state.Selected) != 1 {
		t.Fatal("session not restored", state)
	}
	response := post(t, server.URL+"/torrents/"+hash.HexString()+"/resume", nil)
	response.Body.Close()
	if response.StatusCode != 204 {
		t.Fatal("resume ghost", response.StatusCode)
	}
	original, ok := a.client.Torrent(hash)
	if !ok {
		t.Fatal("missing live torrent")
	}
	reader := original.Files()[0].NewReader()
	defer reader.Close()
	content, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(content, fx.content) {
		t.Fatal("reattached stream differs", err)
	}
	loaded, errs := a.session.load()
	if len(errs) != 0 || len(loaded) != 1 || len(loaded[0].saved.Selected) != 1 {
		t.Fatal("session will not survive restart", errs)
	}
	if loadMaintenance(a.maintenance.dir).blocked(hash.HexString(), nil) {
		t.Fatal("cancelled fence remains blocked")
	}
	reader.Close()
	original.Drop()
	recovered := newAPI(a.client, a.session, clientParts{lifecycle: a.lifecycle, downloads: a.downloads, completion: a.completion, limits: a.limits, windows: a.windows}, a.logger)
	recovered.restore(context.Background())
	waitFor(t, 10*time.Second, func() bool { return !recovered.maintenanceBlocked(hash, nil) })
	restored, ok := recovered.client.Torrent(hash)
	if !ok || len(recovered.session.get(hash).Selected) != 1 {
		t.Fatal("cancel restart lost original session")
	}
	reopened := restored.Files()[0].NewReader()
	defer reopened.Close()
	content, err = io.ReadAll(reopened)
	if err != nil || !bytes.Equal(content, fx.content) {
		t.Fatal("restart stream differs", err)
	}

}

// Linux harness монтирует один собственный каталог дважды; symlink не заменяет этот тест.
func TestMaintenanceBindMountAliases(t *testing.T) {
	left, right := os.Getenv("TORSHER_TEST_BIND_LEFT"), os.Getenv("TORSHER_TEST_BIND_RIGHT")
	if left == "" || right == "" {
		t.Skip("requires two bind mounts")
	}
	path := filepath.Join(left, "Synthetic.Bind.mkv")
	if err := os.WriteFile(path, []byte("synthetic bind"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(path) })
	alias := filepath.Join(right, filepath.Base(path))
	if canonicalMaintenancePath(path) == canonicalMaintenancePath(alias) {
		t.Fatal("test requires distinct canonical bind paths")
	}
	if !sameMaintenanceEntry(path, alias) {
		t.Fatal("bind mount entry not recognized")
	}
	item := maintenanceIdentity(t, left, path)
	a, _ := newTestEngine(t, t.TempDir())
	manifest := detachManifest{InfoHash: strings.Repeat("d", 40), PieceCount: 1, Paths: []maintenancePath{item}}
	var other metainfo.Hash
	_ = other.FromHexString(strings.Repeat("e", 40))
	release, err := a.maintenanceLease(other, []string{alias})
	if err != nil {
		t.Fatal(err)
	}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/bind/prepare", manifest); r.Code != 409 {
		t.Fatal("prepare accepted an active lease through an alias", r.Code)
	}
	release()
	fx := newNamedFixture(t, filepath.Base(path), 4096)
	live, err := a.addIn(fx.meta, right)
	if err != nil {
		t.Fatal(err)
	}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/bind/prepare", manifest); r.Code != 409 {
		t.Fatal("prepare accepted a path alias owned by a live torrent", r.Code, r.Body.String())
	}
	// Drop сам по себе не завершает владение: move/maintenance сохраняют
	// reservation после закрытия storage. Освобождение проходит через forget.
	if r := maintenanceRequest(t, a, "DELETE", "/torrents/"+live.InfoHash().HexString(), nil); r.Code != 200 {
		t.Fatal("forget failed", r.Code, r.Body.String())
	}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/bind/prepare", manifest); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	if !a.maintenanceBlocked(other, []string{alias}) {
		t.Fatal("fence did not block the path alias")
	}
	reloaded := loadMaintenance(a.maintenance.dir)
	if !reloaded.blocked(other.HexString(), []string{alias}) {
		t.Fatal("reloaded fence did not block the path alias")
	}
	external := filepath.Join(right, "external-hardlink.mkv")
	if err := os.Link(path, filepath.Join(left, "external-hardlink.mkv")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(external) })
	if a.maintenanceBlocked(other, []string{external}) {
		t.Fatal("external hardlink wrongly fenced")
	}
}

func TestMaintenanceTerminalSaveFailureRetainsFence(t *testing.T) {
	for _, action := range []string{"finalize", "cancel"} {
		t.Run(action, func(t *testing.T) {
			a, _ := newTestEngine(t, t.TempDir())
			item := maintenanceFixture(t)
			manifest := detachManifest{InfoHash: strings.Repeat("a", 40), PieceCount: 1, Paths: []maintenancePath{item}}
			if r := maintenanceRequest(t, a, "POST", "/maintenance/terminal/prepare", manifest); r.Code != 200 {
				t.Fatal(r.Body.String())
			}
			if action == "finalize" {
				if r := maintenanceRequest(t, a, "POST", "/maintenance/terminal/unlink", map[string]int{"index": 0}); r.Code != 200 {
					t.Fatal(r.Body.String())
				}
			}
			original := maintenanceJournalWrite
			t.Cleanup(func() { maintenanceJournalWrite = original })
			maintenanceJournalWrite = func(path string, value any) error {
				if err := durableJSON(path, value); err != nil {
					return err
				}
				return errors.New("injected_directory_sync")
			}
			if r := maintenanceRequest(t, a, "POST", "/maintenance/terminal/"+action, nil); r.Code != 500 {
				t.Fatal(r.Code)
			}
			if !a.maintenance.blocked(manifest.InfoHash, nil) {
				t.Fatal("uncertain terminal fence released")
			}
			if r := maintenanceRequest(t, a, "GET", "/maintenance/terminal", nil); r.Code != 500 {
				t.Fatal("uncertain state acknowledged", r.Code)
			}
			maintenanceJournalWrite = original
			if r := maintenanceRequest(t, a, "POST", "/maintenance/terminal/"+action, nil); r.Code != 200 {
				t.Fatal(r.Code, r.Body.String())
			}
			if loadMaintenance(a.maintenance.dir).blocked(manifest.InfoHash, nil) {
				t.Fatal("terminal retry not durable")
			}
		})
	}
}

func TestMaintenanceCancelJournalFailureRecoversOriginal(t *testing.T) {
	fx := newNamedFixture(t, "Synthetic.CancelRecovery.mkv", 4096)
	data := t.TempDir()
	a, server := newTestEngine(t, data)
	hash := downloadFixture(t, a, server, fx)
	waitFor(t, 10*time.Second, func() bool { return stateOfHash(t, a, hash).WantedCompleted == int64(len(fx.content)) })
	info, _ := fx.meta.UnmarshalInfo()
	item := maintenanceIdentity(t, filepath.Join(data, "downloads"), filepath.Join(data, "downloads", "Synthetic.CancelRecovery.mkv"))
	manifest := detachManifest{InfoHash: hash.HexString(), PieceCount: info.NumPieces(), Paths: []maintenancePath{item}}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/cancel-recovery/prepare", manifest); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	original := maintenanceJournalWrite
	t.Cleanup(func() { maintenanceJournalWrite = original })
	maintenanceJournalWrite = func(path string, value any) error {
		if value.(*detachFence).State == "cancelled" {
			return errors.New("injected_cancel_commit")
		}
		return durableJSON(path, value)
	}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/cancel-recovery/cancel", nil); r.Code != 202 {
		t.Fatal(r.Code, r.Body.String())
	}
	waitFor(t, 10*time.Second, func() bool {
		a.maintenance.mu.Lock()
		defer a.maintenance.mu.Unlock()
		return !a.maintenance.fences["cancel-recovery"].reattaching
	})
	maintenanceJournalWrite = original
	if loadMaintenance(a.maintenance.dir).fences["cancel-recovery"].State != "reattaching" {
		t.Fatal("reattach intent lost")
	}
	live, _ := a.client.Torrent(hash)
	live.Drop()
	recovered := newAPI(a.client, a.session, clientParts{lifecycle: a.lifecycle, downloads: a.downloads, completion: a.completion, limits: a.limits, windows: a.windows}, a.logger)
	recovered.restore(context.Background())
	waitFor(t, 10*time.Second, func() bool { return !recovered.maintenanceBlocked(hash, nil) })
	if recovered.maintenanceBlocked(hash, nil) {
		t.Fatal("recovered reattach still fenced")
	}
	state := stateOfHash(t, recovered, hash)
	if state.BytesCompleted != int64(len(fx.content)) || len(state.Selected) != 1 {
		t.Fatal("recovery lost session", state)
	}
	if loadMaintenance(a.maintenance.dir).fences["cancel-recovery"].State != "cancelled" {
		t.Fatal("recovery not durable")
	}
}
