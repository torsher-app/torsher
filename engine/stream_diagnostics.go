package main

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
)

const streamWaitFirst = 10 * time.Second
const streamWaitRepeat = 30 * time.Second

type streamDiagnostics struct {
	torrent.Reader
	ctx                      context.Context
	logger                   *slog.Logger
	speeds                   *speedTracker
	hash                     metainfo.Hash
	fileIndex                int
	offset, pieceLength, pos int64
	first, every             time.Duration
	mu                       sync.Mutex
	generation               uint64
	active, stalled, closed  bool
	started                  time.Time
	timer                    *time.Timer
	stopCancel               func() bool
}

func (r *streamDiagnostics) stopLocked() {
	r.active = false
	if r.timer != nil {
		r.timer.Stop()
		r.timer = nil
	}
	if r.stopCancel != nil {
		r.stopCancel()
		r.stopCancel = nil
	}
}
func (r *streamDiagnostics) waiting(generation uint64, piece int64) {
	r.mu.Lock()
	if !r.active || r.closed || r.generation != generation || r.ctx.Err() != nil {
		r.mu.Unlock()
		return
	}
	r.stalled = true
	elapsed := time.Since(r.started).Milliseconds()
	r.mu.Unlock()
	attrs := []any{"event", "engine.stream_wait", "infoHash", r.hash.HexString(), "fileIndex", r.fileIndex, "piece", piece, "elapsedMs", elapsed}
	attrs = append(attrs, r.speeds.diagnosticFacts(r.hash)...)
	r.logger.Warn("stream read stalled", attrs...)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.active && !r.closed && r.generation == generation && r.ctx.Err() == nil {
		r.timer = time.AfterFunc(r.every, func() { r.waiting(generation, piece) })
	}
}
func (r *streamDiagnostics) Read(p []byte) (int, error) {
	r.mu.Lock()
	r.generation++
	generation := r.generation
	r.started = time.Now()
	r.active, r.stalled = !r.closed && r.ctx.Err() == nil, false
	piece := (r.offset + r.pos) / r.pieceLength
	if r.active {
		r.timer = time.AfterFunc(r.first, func() { r.waiting(generation, piece) })
		r.stopCancel = context.AfterFunc(r.ctx, func() {
			r.mu.Lock()
			defer r.mu.Unlock()
			if r.generation == generation {
				r.stopLocked()
			}
		})
	}
	r.mu.Unlock()
	n, err := r.Reader.Read(p)
	r.mu.Lock()
	resumed := r.generation == generation && r.active && r.stalled && !r.closed && r.ctx.Err() == nil && n > 0
	elapsed := time.Since(r.started).Milliseconds()
	if r.generation == generation {
		r.stopLocked()
	}
	r.pos += int64(n)
	r.mu.Unlock()
	if resumed {
		r.logger.Info("stream read resumed", "event", "engine.stream_resumed", "infoHash", r.hash.HexString(), "fileIndex", r.fileIndex, "piece", piece, "elapsedMs", elapsed)
	}

	return n, err
}
func (r *streamDiagnostics) Seek(offset int64, whence int) (int64, error) {
	pos, err := r.Reader.Seek(offset, whence)
	if err == nil {
		r.mu.Lock()
		r.pos = pos
		r.mu.Unlock()
	}
	return pos, err
}
func (r *streamDiagnostics) Close() error {
	r.mu.Lock()
	r.closed = true
	r.generation++
	r.stopLocked()
	r.mu.Unlock()
	return r.Reader.Close()
}
