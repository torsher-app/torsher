package main

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"golang.org/x/time/rate"
)

// Настройки, которые меняются без перезапуска (`PUT /settings`)
type liveSettings struct {
	// Байт в секунду, 0 — без ограничения. Лимит загрузки — только для
	// выбранных файлов: поток просмотра его не учитывает
	DownloadLimit int64 `json:"downloadLimit"`
	UploadLimit   int64 `json:"uploadLimit"`
	// Соединения с пирами на раздачу и всего (0 — без общего предела)
	ConnsPerTorrent int `json:"connsPerTorrent"`
	ConnsTotal      int `json:"connsTotal"`
	// Сколько раздач качают выбор одновременно, 0 — без очереди
	ActiveDownloads int `json:"activeDownloads"`
}

func (s liveSettings) validate() error {
	if s.DownloadLimit < 0 || s.UploadLimit < 0 || s.ConnsTotal < 0 || s.ActiveDownloads < 0 {
		return errors.New("limits must not be negative")
	}

	if s.ConnsPerTorrent < 1 {
		return errors.New("connsPerTorrent must be at least 1")
	}

	return nil
}

// Запас ограничителей: ридер библиотеки режет чтение до запаса, а отдача
// резервирует блок целиком. Мегабайт — запас библиотеки по умолчанию.
// Тесты уменьшают его, чтобы лимит был виден на раздачах в мегабайты
var minLimiterBurst = 1 << 20

// Как часто привратник смотрит корзину, если колбэк его не разбудил
var gateInterval = 200 * time.Millisecond

// Лимиты скорости. Ограничитель загрузки у anacrolix один на клиент и
// режет чтение всех соединений, поэтому блок потока от блока выбранного
// файла на уровне сокета не отличить. Режимов два:
//
//   - потоков нет — лимит держит ограничитель библиотеки, плавно по байтам;
//   - открыт поток — ограничитель снят, а фон держит привратник: блоки вне
//     окон потоков списываются из корзины токенов, корзина в минусе — выбор
//     файлов снимается (`reschedule`), окна и ридеры потоков продолжают
//     качать. Запросы, уже ушедшие пирам, уводят корзину в минус, и пауза
//     длится дольше: в среднем фон качает со скоростью лимита
type limits struct {
	download *rate.Limiter
	upload   *rate.Limiter
	// Окна открытых потоков: по ним колбэк отличает блоки потока от фона
	windows *windows

	mu       sync.Mutex
	settings liveSettings
	streams  int
	// Байт, которые фон ещё может скачать, пока открыт поток
	tokens   float64
	refilled time.Time
	held     bool
	// Время последней смены лимита: см. `applyLocked`
	limitAt time.Time
	// Будит привратника, когда корзина ушла в минус, не дожидаясь шага
	wake chan struct{}
	// Привратник задержал или отпустил фон: выбор нужно пересчитать
	onHold func()
}

func newLimits(settings liveSettings, streams *windows) *limits {
	l := &limits{
		download: rate.NewLimiter(rate.Inf, minLimiterBurst),
		upload:   rate.NewLimiter(rate.Inf, minLimiterBurst),
		windows:  streams,
		settings: settings,
		wake:     make(chan struct{}, 1),
		onHold:   func() {},
	}
	l.applyLocked()

	return l
}

func (l *limits) current() liveSettings {
	l.mu.Lock()
	defer l.mu.Unlock()

	return l.settings
}

func (l *limits) set(settings liveSettings) {
	l.mu.Lock()
	l.settings = settings
	l.fillLocked()
	l.applyLocked()
	changed := l.held
	l.held = false
	l.mu.Unlock()

	if changed {
		l.onHold()
	}
}

func limitOf(bytesPerSecond int64) rate.Limit {
	if bytesPerSecond <= 0 {
		return rate.Inf
	}

	return rate.Limit(bytesPerSecond)
}

// Время смены строго растёт: `rate.Limiter` при смене лимита досчитывает
// токены по старому, и у бесконечного лимита за нулевой промежуток выходит
// NaN — он залипает в ограничителе и отключает лимит насовсем
func (l *limits) applyLocked() {
	at := time.Now()
	if !at.After(l.limitAt) {
		at = l.limitAt.Add(time.Nanosecond)
	}
	l.limitAt = at

	l.upload.SetLimitAt(at, limitOf(l.settings.UploadLimit))

	if l.streams > 0 {
		l.download.SetLimitAt(at, rate.Inf)
	} else {
		l.download.SetLimitAt(at, limitOf(l.settings.DownloadLimit))
	}
}

func (l *limits) capacityLocked() float64 {
	return max(float64(l.settings.DownloadLimit), float64(minLimiterBurst))
}

func (l *limits) fillLocked() {
	l.tokens = l.capacityLocked()
	l.refilled = time.Now()
}

func (l *limits) refillLocked() {
	now := time.Now()
	l.tokens = min(l.tokens+now.Sub(l.refilled).Seconds()*float64(l.settings.DownloadLimit), l.capacityLocked())
	l.refilled = now
}

// Поток открыт или закрыт. Первый поток снимает ограничитель до первого
// чтения: старт просмотра не ждёт лимита
func (l *limits) streamChanged(opened bool) {
	l.mu.Lock()

	if opened {
		l.streams++
	} else {
		l.streams--
	}

	changed := false

	if opened && l.streams == 1 {
		l.fillLocked()
	}
	if l.streams == 0 && l.held {
		l.held = false
		changed = true
	}

	l.applyLocked()
	l.mu.Unlock()

	if changed {
		l.onHold()
	}
}

// Колбэк `ReceivedUsefulData`: вызывается под блокировкой клиента, поэтому
// только считает и клиента не трогает
func (l *limits) received(event torrent.ReceivedUsefulDataEvent) {
	l.mu.Lock()
	counting := l.streams > 0 && l.settings.DownloadLimit > 0
	l.mu.Unlock()

	if !counting || l.windows.streamPiece(event.Peer.Torrent(), int(event.Message.Index)) {
		return
	}

	l.mu.Lock()
	l.refillLocked()
	l.tokens -= float64(len(event.Message.Piece))
	empty := l.tokens < 0 && !l.held
	l.mu.Unlock()

	if empty {
		select {
		case l.wake <- struct{}{}:
		default:
		}
	}
}

func (l *limits) isHeld() bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	return l.held
}

// Привратник: в минусе — задержать фон, накопил половину корзины — отпустить.
// Половина, а не ноль: иначе выбор переключался бы на каждом блоке
func (l *limits) gate(ctx context.Context) {
	ticker := time.NewTicker(gateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-l.wake:
		}

		l.mu.Lock()
		was := l.held

		if l.streams == 0 || l.settings.DownloadLimit == 0 {
			l.held = false
		} else {
			l.refillLocked()
			if l.tokens < 0 {
				l.held = true
			} else if l.tokens >= l.capacityLocked()/2 {
				l.held = false
			}
		}

		changed := was != l.held
		l.mu.Unlock()

		if changed {
			l.onHold()
		}
	}
}
