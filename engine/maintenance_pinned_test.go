//go:build linux || darwin

package main

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

func cancellationFixture(t *testing.T) (*api, detachManifest, []byte) {
	t.Helper()
	fx := newNamedFixture(t, "Synthetic.Pinned.mkv", 4096)
	data := t.TempDir()
	a, server := newTestEngine(t, data)
	hash := downloadFixture(t, a, server, fx)
	waitFor(t, 10*time.Second, func() bool { return stateOfHash(t, a, hash).WantedCompleted == int64(len(fx.content)) })
	item := maintenanceIdentity(t, filepath.Join(data, "downloads"), filepath.Join(data, "downloads", "Synthetic.Pinned.mkv"))
	info, _ := fx.meta.UnmarshalInfo()
	manifest := detachManifest{InfoHash: hash.HexString(), PieceCount: info.NumPieces(), Paths: []maintenancePath{item}}
	if response := maintenanceRequest(t, a, "POST", "/maintenance/pinned/prepare", manifest); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	return a, manifest, fx.content
}
func waitCancellation(t *testing.T, a *api) *detachFence {
	t.Helper()
	waitFor(t, 10*time.Second, func() bool {
		a.maintenance.mu.Lock()
		defer a.maintenance.mu.Unlock()
		return !a.maintenance.fences["pinned"].reattaching
	})
	a.maintenance.mu.Lock()
	defer a.maintenance.mu.Unlock()
	copy := *a.maintenance.fences["pinned"]
	return &copy
}
func TestMaintenancePinnedRejectsReplacement(t *testing.T) {
	for _, kind := range []string{"replacement", "symlink", "parent_symlink"} {
		t.Run(kind, func(t *testing.T) {
			a, manifest, content := cancellationFixture(t)
			item := manifest.Paths[0]
			foreign := filepath.Join(t.TempDir(), "foreign.mkv")
			if err := os.WriteFile(foreign, content, 0600); err != nil {
				t.Fatal(err)
			}
			if kind == "parent_symlink" {
				if err := os.Rename(item.Root, item.Root+"-original"); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { os.Remove(item.Root); os.Rename(item.Root+"-original", item.Root) })
				if err := os.Symlink(filepath.Dir(foreign), item.Root); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Rename(item.Path, item.Path+".original"); err != nil {
					t.Fatal(err)
				}
				if kind == "symlink" {
					if err := os.Symlink(foreign, item.Path); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := os.WriteFile(item.Path, content, 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
				t.Fatal(r.Code, r.Body.String())
			}
			fence := waitCancellation(t, a)
			if fence.State != "reattaching" || fence.Error == "" {
				t.Fatal("unsafe cancel accepted", fence.State, fence.Error)
			}
			var hash metainfo.Hash
			_ = hash.FromHexString(manifest.InfoHash)
			if !a.maintenanceBlocked(hash, nil) {
				t.Fatal("identity failure released fence")
			}
			if _, live := a.client.Torrent(hash); live {
				t.Fatal("invalid source admitted")
			}
			current, err := os.ReadFile(foreign)
			if err != nil || !bytes.Equal(current, content) {
				t.Fatal("foreign file damaged", err)
			}
		})
	}
}
func TestMaintenancePinnedKeepsObjectAfterPathRace(t *testing.T) {
	a, manifest, content := cancellationFixture(t)
	item := manifest.Paths[0]
	foreign := bytes.Repeat([]byte{42}, len(content))
	original := maintenanceReattachCheckpoint
	t.Cleanup(func() { maintenanceReattachCheckpoint = original })
	maintenanceReattachCheckpoint = func(stage string) error {
		if stage == "before_verify" {
			if err := os.Rename(item.Path, item.Path+".original"); err != nil {
				return err
			}
			return os.WriteFile(item.Path, foreign, 0600)
		}
		return nil
	}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	fence := waitCancellation(t, a)
	if fence.State != "cancelled" {
		t.Fatal(fence.Error)
	}
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	live, _ := a.client.Torrent(hash)
	reader := live.Files()[0].NewReader()
	defer reader.Close()
	read, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(read, content) {
		t.Fatal("reader followed replacement", err)
	}
	current, err := os.ReadFile(item.Path)
	if err != nil || !bytes.Equal(current, foreign) {
		t.Fatal("replacement overwritten", err)
	}
}
func TestMaintenanceReattachDoesNotBlockUnrelatedAdmission(t *testing.T) {
	a, _, _ := cancellationFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	original := maintenanceReattachCheckpoint
	t.Cleanup(func() { maintenanceReattachCheckpoint = original })
	maintenanceReattachCheckpoint = func(stage string) error {
		if stage == "before_verify" {
			close(entered)
			<-release
		}
		return nil
	}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	<-entered
	if response := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); response.Code != 202 {
		close(release)
		t.Fatal("repeated cancel not pending", response.Code)
	}
	done := make(chan error, 1)
	go func() {
		var other metainfo.Hash
		_ = other.FromHexString(strings.Repeat("a", 40))
		free, err := a.maintenanceLease(other, nil)
		if free != nil {
			free()
		}
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("global admission blocked by verification")
	}
	// Startup использует тот же worker и возвращается, пока проверка ещё стоит на barrier.
	resumed := make(chan struct{})
	go func() { a.restore(context.Background()); close(resumed) }()
	select {
	case <-resumed:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("startup blocked by verification")
	}
	close(release)
	if fence := waitCancellation(t, a); fence.State != "cancelled" {
		t.Fatal(fence.Error)
	}
}

func TestMaintenanceGuardedMoveRejectsBeforeSideEffects(t *testing.T) {
	a, manifest, content := cancellationFixture(t)
	if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	if fence := waitCancellation(t, a); fence.State != "cancelled" {
		t.Fatal(fence.Error)
	}
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	before := a.session.get(hash)
	target := filepath.Join(t.TempDir(), "not-created")
	response := maintenanceRequest(t, a, "POST", "/torrents/"+hash.HexString()+"/move", map[string]string{"dir": target})
	if response.Code != 409 || !strings.Contains(response.Body.String(), "source_identity_guarded") || !strings.Contains(response.Body.String(), "keeping files") {
		t.Fatal(response.Code, response.Body.String())
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("move created target", err)
	}
	if a.session.get(hash).Dir != before.Dir {
		t.Fatal("move changed session")
	}
	current, err := os.ReadFile(manifest.Paths[0].Path)
	if err != nil || !bytes.Equal(current, content) {
		t.Fatal("move modified source", err)
	}
	live, _ := a.client.Torrent(hash)
	live.Drop()
	meta, err := metainfo.Load(bytes.NewReader(a.maintenance.fences["pinned"].RestoreMeta))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.addIn(meta, a.dirOrDefault(before.Dir)); err == nil {
		t.Fatal("ordinary reopen accepted a guarded session")
	}
}

func TestMaintenancePinnedHashMismatchNeverStartsDownload(t *testing.T) {
	a, manifest, content := cancellationFixture(t)
	item := manifest.Paths[0]
	before, err := os.Stat(item.Path)
	if err != nil {
		t.Fatal(err)
	}
	changed := bytes.Repeat([]byte{13}, len(content))
	if err := os.WriteFile(item.Path, changed, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(item.Path, before.ModTime(), before.ModTime()); err != nil {
		t.Fatal(err)
	}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	fence := waitCancellation(t, a)
	if fence.State != "reattaching" || fence.Error != "restore_content_mismatch" {
		t.Fatal(fence.State, fence.Error)
	}
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	if _, live := a.client.Torrent(hash); live {
		t.Fatal("mismatched pieces resumed download")
	}
	current, err := os.ReadFile(item.Path)
	if err != nil || !bytes.Equal(current, changed) {
		t.Fatal("mismatch overwritten", err)
	}
}
func TestMaintenancePinnedWritesStayOnOpenedObject(t *testing.T) {
	a, manifest, content := cancellationFixture(t)
	meta, err := metainfo.Load(bytes.NewReader(a.maintenance.fences["pinned"].RestoreMeta))
	if err != nil {
		t.Fatal(err)
	}
	info, err := meta.UnmarshalInfo()
	if err != nil {
		t.Fatal(err)
	}
	pinned, err := openMaintenancePinned(&info, meta.HashInfoBytes(), manifest.Paths[0].Root, manifest.Paths, a.completion)
	if err != nil {
		t.Fatal(err)
	}
	defer pinned.Close()
	path := manifest.Paths[0].Path
	if err := os.Rename(path, path+".opened"); err != nil {
		t.Fatal(err)
	}
	foreign := bytes.Repeat([]byte{42}, len(content))
	if err := os.WriteFile(path, foreign, 0600); err != nil {
		t.Fatal(err)
	}
	piece := maintenancePinnedPiece{s: pinned, piece: info.Piece(0)}
	if _, err := piece.WriteAt([]byte{99}, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := piece.WriteAt([]byte{99}, piece.piece.Length()); err == nil {
		t.Fatal("out-of-piece write accepted")
	}
	current, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(current, foreign) {
		t.Fatal("pinned writer followed replacement", err)
	}
	current, err = os.ReadFile(path + ".opened")
	if err != nil || current[0] != 99 {
		t.Fatal("pinned original not used", err)
	}
}

func TestMaintenancePinnedPieceSpansFilesAndPadding(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "Pack"), 0700); err != nil {
		t.Fatal(err)
	}
	var paths []maintenancePath
	for name, contents := range map[string]string{"a": "abc", "b": "def"} {
		path := filepath.Join(root, "Pack", name)
		if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, maintenanceIdentity(t, root, path))
	}
	info := metainfo.Info{Name: "Pack", PieceLength: 8, Pieces: make([]byte, 20), Files: []metainfo.FileInfo{
		{Path: []string{"a"}, Length: 3},
		{Path: []string{"padding"}, Length: 2, ExtendedFileAttrs: metainfo.ExtendedFileAttrs{Attr: "p"}},
		{Path: []string{"b"}, Length: 3},
	}}
	completion := storage.NewMapPieceCompletion()
	defer completion.Close()
	pinned, err := openMaintenancePinned(&info, metainfo.Hash{}, root, paths, completion)
	if err != nil {
		t.Fatal(err)
	}
	defer pinned.Close()
	piece := maintenancePinnedPiece{s: pinned, piece: info.Piece(0)}
	buffer := make([]byte, 8)
	if n, err := piece.ReadAt(buffer, 0); n != 8 || err != nil || !bytes.Equal(buffer, []byte{'a', 'b', 'c', 0, 0, 'd', 'e', 'f'}) {
		t.Fatal(n, err, buffer)
	}
	if n, err := piece.WriteAt([]byte{'X', 0, 0, 'Y'}, 2); n != 4 || err != nil {
		t.Fatal(n, err)
	}
	if value, _ := os.ReadFile(filepath.Join(root, "Pack", "a")); string(value) != "abX" {
		t.Fatal(string(value))
	}
	if value, _ := os.ReadFile(filepath.Join(root, "Pack", "b")); string(value) != "Yef" {
		t.Fatal(string(value))
	}
	if _, err := os.Stat(filepath.Join(root, "Pack", "padding")); !os.IsNotExist(err) {
		t.Fatal("padding created on disk")
	}
}

func TestMaintenanceGuardedForgetAndNextCleanup(t *testing.T) {
	a, manifest, content := cancellationFixture(t)
	if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	if fence := waitCancellation(t, a); fence.State != "cancelled" {
		t.Fatal(fence.Error)
	}
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	original, _ := a.client.Torrent(hash)
	response := maintenanceRequest(t, a, "DELETE", "/torrents/"+manifest.InfoHash+"?delete_files=true", nil)
	if response.Code != 409 || !strings.Contains(response.Body.String(), "source_identity_guarded") {
		t.Fatal(response.Code, response.Body.String())
	}
	current, live := a.client.Torrent(hash)
	if !live || current != original || !a.session.has(hash) {
		t.Fatal("destructive forget dropped guarded session")
	}
	if bytes, err := os.ReadFile(manifest.Paths[0].Path); err != nil || string(bytes) != string(content) {
		t.Fatal("destructive forget touched source", err)
	}
	// Следующее обслуживание имеет собственный immutable manifest и безопасный unlink.
	if r := maintenanceRequest(t, a, "POST", "/maintenance/next-cycle/prepare", manifest); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/next-cycle/unlink", map[string]int{"index": 0}); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	if _, err := os.Stat(manifest.Paths[0].Path); !os.IsNotExist(err) {
		t.Fatal("next cycle blocked by old guard", err)
	}
}
func TestMaintenanceGuardedForgetKeepFilesRemainsAvailable(t *testing.T) {
	a, manifest, content := cancellationFixture(t)
	if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	if fence := waitCancellation(t, a); fence.State != "cancelled" {
		t.Fatal(fence.Error)
	}
	response := maintenanceRequest(t, a, "DELETE", "/torrents/"+manifest.InfoHash, nil)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if bytes, err := os.ReadFile(manifest.Paths[0].Path); err != nil || string(bytes) != string(content) {
		t.Fatal("keep files lost source", err)
	}
}
