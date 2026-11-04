package main

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

type lifecycleFixture struct {
	mu               sync.Mutex
	entered, release chan struct{}
	completed        bool
	closeErr         error
}

func (f *lifecycleFixture) OpenTorrent(context.Context, *metainfo.Info, metainfo.Hash) (storage.TorrentImpl, error) {
	return storage.TorrentImpl{Piece: func(metainfo.Piece) storage.PieceImpl { return f }, Close: func() error { return f.closeErr }}, nil
}
func (f *lifecycleFixture) Close() error                       { return nil }
func (f *lifecycleFixture) ReadAt([]byte, int64) (int, error)  { return 0, nil }
func (f *lifecycleFixture) WriteAt([]byte, int64) (int, error) { return 0, nil }
func (f *lifecycleFixture) MarkComplete() error {
	close(f.entered)
	<-f.release
	f.mu.Lock()
	defer f.mu.Unlock()
	f.completed = true
	return nil
}
func (f *lifecycleFixture) MarkNotComplete() error         { return nil }
func (f *lifecycleFixture) Completion() storage.Completion { return storage.Completion{} }
func TestMaintenanceStorageWaitsForMarkAndRejectsLateCallbacks(t *testing.T) {
	underlying := &lifecycleFixture{entered: make(chan struct{}), release: make(chan struct{})}
	lifecycle := &storageLifecycle{torrents: map[metainfo.Hash]*storageLifetime{}}
	impl, err := (trackedStorage{ClientImplCloser: underlying, lifecycle: lifecycle}).OpenTorrent(context.Background(), &metainfo.Info{}, metainfo.Hash{})
	if err != nil {
		t.Fatal(err)
	}
	piece := impl.Piece(metainfo.Piece{})
	marked := make(chan error, 1)
	go func() { marked <- piece.MarkComplete() }()
	<-underlying.entered
	closed := make(chan error, 1)
	go func() { closed <- impl.Close() }()
	select {
	case <-closed:
		t.Fatal("storage closed with marking in flight")
	case <-time.After(20 * time.Millisecond):
	}
	close(underlying.release)
	if err := <-marked; err != nil {
		t.Fatal(err)
	}
	if err := <-closed; err != nil {
		t.Fatal(err)
	}
	if !lifecycle.settled(metainfo.Hash{}) {
		t.Fatal("quiescence not confirmed")
	}
	underlying.mu.Lock()
	underlying.completed = false
	underlying.mu.Unlock()
	if !errors.Is(piece.MarkComplete(), errStorageClosed) {
		t.Fatal("late MarkComplete allowed")
	}
	if !errors.Is(piece.MarkNotComplete(), errStorageClosed) {
		t.Fatal("late MarkNotComplete allowed")
	}
	if _, err := piece.WriteAt([]byte("late"), 0); !errors.Is(err, errStorageClosed) {
		t.Fatal("late write allowed")
	}
	underlying.mu.Lock()
	defer underlying.mu.Unlock()
	if underlying.completed {
		t.Fatal("completion resurrected")
	}
}
func TestMaintenanceStorageCloseFailureCannotAcknowledge(t *testing.T) {
	underlying := &lifecycleFixture{closeErr: errors.New("close failed")}
	lifecycle := &storageLifecycle{torrents: map[metainfo.Hash]*storageLifetime{}}
	impl, err := (trackedStorage{ClientImplCloser: underlying, lifecycle: lifecycle}).OpenTorrent(context.Background(), &metainfo.Info{}, metainfo.Hash{})
	if err != nil {
		t.Fatal(err)
	}
	if impl.Close() == nil {
		t.Fatal("close failure lost")
	}
	if lifecycle.settled(metainfo.Hash{}) {
		t.Fatal("failed close acknowledged")
	}
}
