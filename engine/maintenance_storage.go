package main

import (
	"context"
	"sync"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
	"github.com/anacrolix/torrent/storage/disabled"
)

// Drop upstream не возвращает ошибку Close и MarkComplete может продолжиться
// вне блокировки клиента. Собственный барьер storage ждёт все текущие IO и
// запрещает поздним callback старого incarnation менять файлы/completion.
type storageLifecycle struct {
	mu          sync.Mutex
	torrents    map[metainfo.Hash]*storageLifetime
	diagnostics *storageDiagnostics
}
type storageLifetime struct {
	mu       sync.RWMutex
	closed   bool
	closeErr error
}
type trackedStorage struct {
	storage.ClientImplCloser
	lifecycle *storageLifecycle
}

func (s trackedStorage) OpenTorrent(ctx context.Context, info *metainfo.Info, hash metainfo.Hash) (storage.TorrentImpl, error) {
	impl, err := s.ClientImplCloser.OpenTorrent(ctx, info, hash)
	if err != nil {
		return impl, err
	}
	life := &storageLifetime{}
	s.lifecycle.mu.Lock()
	s.lifecycle.torrents[hash] = life
	s.lifecycle.mu.Unlock()
	return storage.TorrentImpl{
		Piece: func(piece metainfo.Piece) storage.PieceImpl {
			return trackedPiece{PieceImpl: impl.Piece(piece), life: life, diagnostics: s.lifecycle.diagnostics, hash: hash, index: piece.Index()}
		},
		Close: func() error {
			life.mu.Lock()
			defer life.mu.Unlock()
			life.closed = true
			if impl.Close != nil {
				life.closeErr = impl.Close()
			}
			return life.closeErr
		},
		Capacity: impl.Capacity,
	}, nil
}
func (s *storageLifecycle) settled(hash metainfo.Hash) bool {
	s.mu.Lock()
	life := s.torrents[hash]
	s.mu.Unlock()
	if life == nil {
		return true
	}
	life.mu.RLock()
	defer life.mu.RUnlock()
	return life.closed && life.closeErr == nil
}

type trackedPiece struct {
	storage.PieceImpl
	life        *storageLifetime
	diagnostics *storageDiagnostics
	hash        metainfo.Hash
	index       int
}

var errStorageClosed = context.Canceled

func (p trackedPiece) ReadAt(b []byte, off int64) (int, error) {
	p.life.mu.RLock()
	defer p.life.mu.RUnlock()
	if p.life.closed {
		return 0, errStorageClosed
	}
	return p.PieceImpl.ReadAt(b, off)
}
func (p trackedPiece) WriteAt(b []byte, off int64) (int, error) {
	p.life.mu.RLock()
	if p.life.closed {
		p.life.mu.RUnlock()
		return 0, errStorageClosed
	}
	n, err := p.PieceImpl.WriteAt(b, off)
	p.life.mu.RUnlock()
	p.diagnostics.writeFailed(p.hash, p.index, n, len(b), err)
	return n, err
}
func (p trackedPiece) MarkComplete() error {
	p.life.mu.RLock()
	defer p.life.mu.RUnlock()
	if p.life.closed {
		return errStorageClosed
	}
	return p.PieceImpl.MarkComplete()
}
func (p trackedPiece) MarkNotComplete() error {
	p.life.mu.RLock()
	defer p.life.mu.RUnlock()
	if p.life.closed {
		return errStorageClosed
	}
	return p.PieceImpl.MarkNotComplete()
}
func (p trackedPiece) Completion() storage.Completion {
	p.life.mu.RLock()
	defer p.life.mu.RUnlock()
	if p.life.closed {
		return storage.Completion{Err: errStorageClosed}
	}
	return p.PieceImpl.Completion()
}

// Магнит узнаёт метаданные без открытия неизвестных ещё путей в загрузках.
// Реальный add всегда переоткрывает такую раздачу с файловым storage.
type metadataOnlyStorage struct{}

func (metadataOnlyStorage) OpenTorrent(_ context.Context, info *metainfo.Info, hash metainfo.Hash) (storage.TorrentImpl, error) {
	return (disabled.Client{}).OpenTorrent(info, hash)
}
