package main

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
)

// Как часто планировщик пересчитывает раздачи без событий: докачанный выбор
// освобождает место в очереди, а раздача без потоков перестаёт быть нужной
const scheduleInterval = time.Second

// Отданное за всё время пишется в сессию не чаще раза в минуту
const uploadedFlushEvery = 60

// Меньше двух соединений раздаче не оставляем, даже если общий предел мал
const minConnsShare = 2

// Что планировщик уже применил к раздаче. Ключ — сама раздача, а не hash:
// переоткрытая раздача (перенос) начинает с приоритетов по умолчанию
type applied struct {
	files  string
	upload bool
	conns  int
}

// Отданное раздачей к моменту последней записи в сессию
type uploadMark struct {
	t       *torrent.Torrent
	counter int64
}

type scheduler struct {
	// Пересчёты идут по одному: иначе устаревший набор перезаписал бы свежий
	mu      sync.Mutex
	applied map[*torrent.Torrent]applied

	stateMu sync.Mutex
	queued  map[metainfo.Hash]bool
	marks   map[metainfo.Hash]uploadMark

	kick chan struct{}
}

func newScheduler() *scheduler {
	return &scheduler{
		applied: map[*torrent.Torrent]applied{},
		queued:  map[metainfo.Hash]bool{},
		marks:   map[metainfo.Hash]uploadMark{},
		kick:    make(chan struct{}, 1),
	}
}

// Пересчитать в фоне: колбэки лимитов и окон не должны ждать клиента
func (s *scheduler) poke() {
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

func (s *scheduler) isQueued(hash metainfo.Hash) bool {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()

	return s.queued[hash]
}

// Выбор применён мимо планировщика (пауза): следующий пересчёт применит его заново
func (s *scheduler) forget(t *torrent.Torrent) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.applied, t)
}

func filesKey(files []int) string {
	if len(files) == 0 {
		return ""
	}

	return strings.Trim(fmt.Sprint(files), "[]")
}

// Предел соединений каждой раздачи. Раздачам с открытым потоком — предел на
// раздачу целиком: просмотр важнее. Остаток общего предела делится поровну
// между остальными, но не меньше `minConnsShare`
func connCaps(perTorrent, total int, streamed []bool) []int {
	caps := make([]int, len(streamed))
	streams := 0

	for _, ok := range streamed {
		if ok {
			streams++
		}
	}

	others := len(streamed) - streams
	share := perTorrent

	if total > 0 && others > 0 {
		share = min(max((total-streams*perTorrent)/others, minConnsShare), perTorrent)
	}

	for index, ok := range streamed {
		if ok {
			caps[index] = perTorrent
		} else {
			caps[index] = share
		}
	}

	return caps
}

type planned struct {
	t        *torrent.Torrent
	saved    savedTorrent
	complete bool
}

func selectionComplete(t *torrent.Torrent, selected []int) bool {
	files := t.Files()

	for _, index := range selected {
		if index < len(files) && files[index].BytesCompleted() < files[index].Length() {
			return false
		}
	}

	return true
}

// Что из выбора качается сейчас, кому разрешена отдача и сколько соединений
// у раздачи. Раздачи на паузе не трогаем: их приоритеты расставляет
// `setPaused` (см. обход паники библиотеки там)
func (a *api) reschedule() {
	a.sched.mu.Lock()
	defer a.sched.mu.Unlock()

	settings := a.limits.current()
	held := a.limits.isHeld()
	live := map[*torrent.Torrent]bool{}

	var managed []planned
	var waiting []planned
	var connected []*torrent.Torrent

	for _, t := range a.client.Torrents() {
		if t.Info() == nil {
			continue
		}

		live[t] = true
		hash := t.InfoHash()

		if a.isMoving(hash) {
			continue
		}

		saved, known := a.session.lookup(hash)
		if known && saved.Paused {
			continue
		}

		connected = append(connected, t)

		if !known {
			continue
		}

		item := planned{t: t, saved: saved, complete: selectionComplete(t, saved.Selected)}
		managed = append(managed, item)

		if !item.complete {
			waiting = append(waiting, item)
		}
	}

	slices.SortStableFunc(waiting, func(x, y planned) int {
		if x.saved.QueuedAt != y.saved.QueuedAt {
			return int(x.saved.QueuedAt - y.saved.QueuedAt)
		}

		return strings.Compare(x.t.InfoHash().HexString(), y.t.InfoHash().HexString())
	})

	queued := map[metainfo.Hash]bool{}
	for index, item := range waiting {
		if settings.ActiveDownloads > 0 && index >= settings.ActiveDownloads {
			queued[item.t.InfoHash()] = true
		}
	}

	for _, item := range managed {
		hash := item.t.InfoHash()
		state, seen := a.sched.applied[item.t]

		files := item.saved.Selected
		if !item.complete && (queued[hash] || held) {
			files = nil
		}

		if key := filesKey(files); key != state.files || !seen {
			if err := setFiles(item.t, files); err != nil {
				a.logger.Warn("schedule files", "infoHash", hash.HexString(), "err", err)
			}
			state.files = key
		}

		// Пока раздача качает выбор или её смотрят, отдача нужна всегда: без
		// неё пиры душат закачку. Правило раздачи — про то, что потом
		upload := item.saved.Seed == nil || *item.saved.Seed || !item.complete || a.windows.streaming(hash)
		if upload != state.upload || !seen {
			if upload {
				item.t.AllowDataUpload()
			} else {
				item.t.DisallowDataUpload()
			}
			state.upload = upload
		}

		a.sched.applied[item.t] = state
	}

	streamed := make([]bool, len(connected))
	for index, t := range connected {
		streamed[index] = a.windows.streaming(t.InfoHash())
	}

	for index, limit := range connCaps(settings.ConnsPerTorrent, settings.ConnsTotal, streamed) {
		t := connected[index]
		state := a.sched.applied[t]
		if state.conns != limit {
			t.SetMaxEstablishedConns(limit)
			state.conns = limit
		}
		a.sched.applied[t] = state
	}

	for t := range a.sched.applied {
		if !live[t] {
			delete(a.sched.applied, t)
		}
	}

	a.sched.stateMu.Lock()
	a.sched.queued = queued
	a.sched.stateMu.Unlock()
}

// Отдано за всё время: записанное в сессию и счётчик раздачи с тех пор
func (a *api) uploadedOf(t *torrent.Torrent, saved savedTorrent) int64 {
	stats := t.Stats()
	counter := stats.BytesWrittenData.Int64()

	a.sched.stateMu.Lock()
	mark, ok := a.sched.marks[t.InfoHash()]
	a.sched.stateMu.Unlock()

	if ok && mark.t == t {
		counter -= mark.counter
	}

	return saved.Uploaded + counter
}

// Дописывает в сессию отданное с прошлой записи. Перед `Drop` и при
// остановке: счётчик раздачи живёт, пока она в клиенте
func (a *api) flushUploaded(t *torrent.Torrent) {
	hash := t.InfoHash()
	stats := t.Stats()
	counter := stats.BytesWrittenData.Int64()

	a.sched.stateMu.Lock()
	defer a.sched.stateMu.Unlock()

	mark, ok := a.sched.marks[hash]
	delta := counter
	if ok && mark.t == t {
		delta -= mark.counter
	}

	if delta <= 0 {
		return
	}

	if _, known := a.session.lookup(hash); !known {
		return
	}

	err := a.session.update(hash, func(saved *savedTorrent) { saved.Uploaded += delta })
	if err != nil {
		a.logger.Warn("save uploaded", "infoHash", hash.HexString(), "err", err)
		return
	}

	a.sched.marks[hash] = uploadMark{t: t, counter: counter}
}

func (a *api) flushAllUploaded() {
	for _, t := range a.client.Torrents() {
		if t.Info() != nil && !a.isMoving(t.InfoHash()) {
			a.flushUploaded(t)
		}
	}
}

// Фон планировщика: пересчёт по событиям и раз в секунду, запись отданного
// раз в минуту. До конца `restore` не работает: раздачи ещё добавляются
func (a *api) schedule(ctx context.Context) {
	ticker := time.NewTicker(scheduleInterval)
	defer ticker.Stop()

	ticks := 0

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ticks++
		case <-a.sched.kick:
		}

		if !a.restored.Load() {
			continue
		}

		a.reschedule()

		if ticks >= uploadedFlushEvery {
			ticks = 0
			a.flushAllUploaded()
		}
	}
}
