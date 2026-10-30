package main

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
)

// Скорость считается по счётчикам раздачи раз в секунду за последние
// несколько секунд: панель и плеер читают одни цифры и не сбивают друг другу
// окно, как было бы при разнице между их запросами
const (
	speedInterval = time.Second
	speedWindow   = 5
)

type counterSample struct {
	at         time.Time
	downloaded int64
	uploaded   int64
}

type speed struct {
	download int64
	upload   int64
}

type speedTracker struct {
	mu      sync.Mutex
	samples map[metainfo.Hash][]counterSample
	speeds  map[metainfo.Hash]speed
	// Куски, не прошедшие проверку хэша, на прошлом замере
	badPieces map[metainfo.Hash]int64
}

// Прирост кусков с неверным хэшем у раздачи с прошлого замера
type badPiecesGrowth struct {
	hash  metainfo.Hash
	added int64
	total int64
}

func newSpeedTracker() *speedTracker {
	return &speedTracker{
		samples:   map[metainfo.Hash][]counterSample{},
		speeds:    map[metainfo.Hash]speed{},
		badPieces: map[metainfo.Hash]int64{},
	}
}

// Тем же обходом раздач замечает битые куски: библиотека пишет о них только
// на Info, а её журнал у движка — с WARN
func (s *speedTracker) run(ctx context.Context, client *torrent.Client, logger *slog.Logger) {
	ticker := time.NewTicker(speedInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			for _, growth := range s.sample(now, client.Torrents()) {
				logger.Warn("pieces failed hash check", "hash", growth.hash.HexString(), "added", growth.added, "total", growth.total)
			}
		}
	}
}

func (s *speedTracker) sample(now time.Time, torrents []*torrent.Torrent) []badPiecesGrowth {
	seen := map[metainfo.Hash]bool{}
	var grown []badPiecesGrowth

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, t := range torrents {
		hash := t.InfoHash()
		stats := t.Stats()
		seen[hash] = true

		history := append(s.samples[hash], counterSample{
			at:         now,
			downloaded: stats.BytesReadData.Int64(),
			uploaded:   stats.BytesWrittenData.Int64(),
		})
		if len(history) > speedWindow+1 {
			history = history[len(history)-speedWindow-1:]
		}
		s.samples[hash] = history

		first, last := history[0], history[len(history)-1]
		elapsed := last.at.Sub(first.at).Seconds()

		if elapsed > 0 {
			s.speeds[hash] = speed{
				download: int64(float64(last.downloaded-first.downloaded) / elapsed),
				upload:   int64(float64(last.uploaded-first.uploaded) / elapsed),
			}
		}

		if bad := badPiecesOf(stats); bad > s.badPieces[hash] {
			grown = append(grown, badPiecesGrowth{hash, bad - s.badPieces[hash], bad})
			s.badPieces[hash] = bad
		}
	}

	for hash := range s.samples {
		if !seen[hash] {
			delete(s.samples, hash)
			delete(s.speeds, hash)
			delete(s.badPieces, hash)
		}
	}

	return grown
}

// Куски, которые пиры прислали целиком, а хэш не сошёлся. Библиотека снимает
// с них отметку и качает заново, но отзывчивый ридер успевает отдать их байты
// плееру
func badPiecesOf(stats torrent.TorrentStats) int64 {
	return stats.PiecesDirtiedBad.Int64()
}

// Байт в секунду; раздачи, которую ещё не замеряли, — ноль
func (s *speedTracker) of(hash metainfo.Hash) speed {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.speeds[hash]
}
