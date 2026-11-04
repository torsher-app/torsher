//go:build linux || darwin

package main

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/anacrolix/torrent/metainfo"
)

func waitGuardOwner(t *testing.T, a *api, id string) {
	t.Helper()
	waitFor(t, 10*time.Second, func() bool {
		a.maintenance.mu.Lock()
		defer a.maintenance.mu.Unlock()
		return !a.maintenance.fences[id].reattaching
	})
	a.maintenance.mu.Lock()
	defer a.maintenance.mu.Unlock()
	if f := a.maintenance.fences[id]; f.State != "cancelled" {
		t.Fatal(id, f.State, f.Error)
	}
}
func restartMaintenanceEngine(t *testing.T, a *api) *api {
	t.Helper()
	for _, torrent := range a.client.Torrents() {
		torrent.Drop()
	}
	root := t.TempDir()
	copyDir(t, a.session.dir, filepath.Join(root, "torrents"))
	copyDir(t, a.maintenance.dir, filepath.Join(root, "maintenance"))
	restarted, _ := newTestEngine(t, root)
	return restarted
}
func TestMaintenanceLatestGuardOwnsRestart(t *testing.T) {
	a, manifest, _ := cancellationFixture(t)
	if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	waitGuardOwner(t, a, "pinned")
	if r := maintenanceRequest(t, a, "POST", "/maintenance/latest/prepare", manifest); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/latest/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	waitGuardOwner(t, a, "latest")
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	if a.session.get(hash).GuardedOperationID != "latest" {
		t.Fatal("session owner not durable")
	}
	restarted := restartMaintenanceEngine(t, a)
	entered, release := make(chan struct{}), make(chan struct{})
	var count atomic.Int32
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	original := maintenanceReattachCheckpoint
	t.Cleanup(func() { unblock(); maintenanceReattachCheckpoint = original })
	maintenanceReattachCheckpoint = func(stage string) error {
		if stage == "before_add" {
			if count.Add(1) == 1 {
				close(entered)
			}
			<-release
		}
		return nil
	}
	restarted.restore(context.Background())
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("restart worker not started")
	}
	restarted.recoverMaintenanceReattachments()
	restarted.maintenance.mu.Lock()
	historical := restarted.maintenance.fences["pinned"].State
	owner := restarted.maintenance.workers[manifest.InfoHash]
	restarted.maintenance.mu.Unlock()
	if historical != "cancelled" || owner != "latest" || count.Load() != 1 {
		t.Fatal("historical operation restarted", historical, owner, count.Load())
	}
	unblock()
	waitGuardOwner(t, restarted, "latest")
	if restarted.maintenanceBlocked(hash, nil) {
		t.Fatal("historical fence blocked restored torrent")
	}
	if _, live := restarted.client.Torrent(hash); !live {
		t.Fatal("current session not restored")
	}
	if restarted.session.get(hash).GuardedOperationID != "latest" {
		t.Fatal("wrong durable owner after restart")
	}
}
func TestMaintenanceNewPendingOperationSupersedesCancelledHistory(t *testing.T) {
	a, manifest, _ := cancellationFixture(t)
	if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	waitGuardOwner(t, a, "pinned")
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	// Crash после durable prepare intent, но до Drop: старая guarded session ещё существует.
	a.maintenance.mu.Lock()
	previous := a.maintenance.fences["pinned"]
	next := &detachFence{ID: "pending-new", Manifest: manifest, State: "pending", Results: map[string]string{}, RestoreMeta: previous.RestoreMeta, RestoreSession: previous.RestoreSession}
	if err := a.maintenance.save(next); err != nil {
		a.maintenance.mu.Unlock()
		t.Fatal(err)
	}
	a.maintenance.fences[next.ID] = next
	a.maintenance.mu.Unlock()
	restarted := restartMaintenanceEngine(t, a)
	restarted.restore(context.Background())
	restarted.maintenance.mu.Lock()
	historical := restarted.maintenance.fences["pinned"].State
	workers := len(restarted.maintenance.workers)
	restarted.maintenance.mu.Unlock()
	if historical != "cancelled" || workers != 0 {
		t.Fatal("old cancellation reopened across newer intent", historical, workers)
	}
	if _, live := restarted.client.Torrent(hash); live {
		t.Fatal("new pending fence did not block the torrent")
	}
	if !restarted.maintenanceBlocked(hash, nil) {
		t.Fatal("new intent not held")
	}
}
func TestMaintenanceUnknownGuardOwnerFailsClosed(t *testing.T) {
	a, manifest, _ := cancellationFixture(t)
	if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	waitGuardOwner(t, a, "pinned")
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	if err := a.session.update(hash, func(saved *savedTorrent) { saved.GuardedOperationID = "" }); err != nil {
		t.Fatal(err)
	}
	restarted := restartMaintenanceEngine(t, a)
	restarted.restore(context.Background())
	if _, live := restarted.client.Torrent(hash); live {
		t.Fatal("unknown old guard guessed a historical owner")
	}
	if !restarted.maintenanceBlocked(hash, nil) {
		t.Fatal("unknown guard hash not held")
	}
	var other metainfo.Hash
	_ = other.FromHexString(strings.Repeat("a", 40))
	if restarted.maintenanceBlocked(other, nil) {
		t.Fatal("unknown guard blocks unrelated hash")
	}
	if !restarted.maintenanceBlocked(other, []string{manifest.Paths[0].Path}) {
		t.Fatal("unknown guard path not held")
	}
	if restarted.maintenance.fences["pinned"].State != "cancelled" {
		t.Fatal("historical fence was reactivated")
	}
}
func TestMaintenanceWorkerDeduplicatesByHash(t *testing.T) {
	a, manifest, _ := cancellationFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	original := maintenanceReattachCheckpoint
	t.Cleanup(func() { unblock(); maintenanceReattachCheckpoint = original })
	maintenanceReattachCheckpoint = func(stage string) error {
		if stage == "before_add" {
			close(entered)
			<-release
		}
		return nil
	}
	if r := maintenanceRequest(t, a, "POST", "/maintenance/pinned/cancel", nil); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	<-entered
	a.maintenance.mu.Lock()
	previous := a.maintenance.fences["pinned"]
	duplicate := &detachFence{ID: "duplicate", Manifest: manifest, State: "reattaching", Results: map[string]string{}, RestoreMeta: previous.RestoreMeta, RestoreSession: previous.RestoreSession}
	a.maintenance.fences[duplicate.ID] = duplicate
	a.startMaintenanceReattach(duplicate)
	conflict := duplicate.Error
	started := duplicate.reattaching
	a.maintenance.mu.Unlock()
	if conflict != "reattach_conflict" || started {
		t.Fatal("second worker allowed", conflict, started)
	}
	unblock()
	waitGuardOwner(t, a, "pinned")
	if a.maintenance.fences["pinned"].resumed {
		t.Fatal("conflicting operation allowed automatic resume")
	}
}
