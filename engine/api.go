package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"runtime/pprof"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// Тело `.torrent` больших паков — единицы мегабайт
const maxTorrentFileBytes = 16 << 20

// Честно дольше всех блокировку клиента держит `AddTorrent` огромной раздачи
// на холодном диске — это секунды; дедлок же вечен, и запас порога не важен
const (
	watchdogInterval = 5 * time.Second
	watchdogTimeout  = 60 * time.Second
)

type api struct {
	client  *torrent.Client
	session *session
	logger  *slog.Logger
	// Каталог загрузок по умолчанию и отметки скачанных кусков: удаление с
	// файлами убирает и то и другое
	downloads  string
	completion storage.PieceCompletion
	// Каталог каждой раздачи (`metainfo.Hash` → путь); нет записи — по
	// умолчанию. Хранилища других каталогов создаются по первой раздаче в них
	dirs     sync.Map
	storesMu sync.Mutex
	stores   map[string]storage.ClientImpl
	// Переносы раздач между каталогами
	movesMu sync.Mutex
	moves   map[metainfo.Hash]*moveJob
	speeds  *speedTracker
	// Раздачи прошлого запуска добавлены заново: до этого сервер к движку не
	// ходит, `/health` отвечает `restoring`
	restored atomic.Bool
	windows  *windows
	limits   *limits
	sched    *scheduler
	// Завершение процесса после паники в обработчике; в тестах подменяется
	exit func(code int)
	// Время последней пробы блокировки клиента (unix nano, 0 — сторож не
	// запущен) и пороги сторожа; в тестах пороги подменяются
	lockAlive     atomic.Int64
	watchEvery    time.Duration
	lockStuckFrom time.Duration
}

func newAPI(client *torrent.Client, session *session, parts clientParts, logger *slog.Logger) *api {
	a := &api{
		client:     client,
		session:    session,
		logger:     logger,
		downloads:  parts.downloads,
		completion: parts.completion,
		stores:     map[string]storage.ClientImpl{},
		moves:      map[metainfo.Hash]*moveJob{},
		speeds:     newSpeedTracker(),
		windows:    parts.windows,
		limits:     parts.limits,
		sched:      newScheduler(),
		exit:       os.Exit,

		watchEvery:    watchdogInterval,
		lockStuckFrom: watchdogTimeout,
	}

	// Привратник и потоки меняют, что качается и сколько соединений у раздач
	a.limits.onHold = a.sched.poke
	a.windows.streamChanged = func(opened bool) {
		a.limits.streamChanged(opened)
		a.sched.poke()
	}

	return a
}

func (a *api) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		if a.lockStuck() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "stuck"})
			return
		}

		if !a.restored.Load() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "restoring"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /torrents/inspect", a.inspect)
	mux.HandleFunc("POST /torrents/resolve", a.resolve)
	mux.HandleFunc("GET /torrents", a.list)
	mux.HandleFunc("POST /torrents", a.add)
	mux.HandleFunc("PUT /torrents/{hash}/files", a.selectFiles)
	mux.HandleFunc("POST /torrents/{hash}/pause", a.pause)
	mux.HandleFunc("POST /torrents/{hash}/resume", a.resume)
	mux.HandleFunc("DELETE /torrents/{hash}", a.forget)
	mux.HandleFunc("POST /torrents/{hash}/move", a.startMove)
	mux.HandleFunc("GET /torrents/{hash}/move", a.moveStatus)
	mux.HandleFunc("GET /torrents/{hash}/stats", a.stats)
	mux.HandleFunc("GET /torrents/{hash}/files/{index}/stream", a.stream)
	mux.HandleFunc("PUT /torrents/{hash}/seed", a.setSeed)
	mux.HandleFunc("GET /settings", a.getSettings)
	mux.HandleFunc("PUT /settings", a.putSettings)

	return a.crashOnPanic(mux)
}

// Паника в обработчике завершает движок, супервизор сервера запустит его
// заново. `net/http` перехватил бы её и оставил процесс жить, а библиотека
// могла упасть, держа блокировку клиента (`File.SetPriority` снимает её без
// defer): `/health` отвечал бы, а все запросы к раздачам висели бы
func (a *api) crashOnPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			v := recover()
			if v == nil {
				return
			}

			// Так `net/http` сам обрывает ответ — это не сбой
			if v == http.ErrAbortHandler {
				panic(v)
			}

			a.logger.Error("handler panic", "path", r.URL.Path, "panic", fmt.Sprint(v), "stack", string(debug.Stack()))
			a.exit(2)
		}()

		next.ServeHTTP(w, r)
	})
}

// Сторож блокировки клиента. Паника библиотеки под блокировкой вне
// обработчика или дедлок оставляют её захваченной навсегда: процесс жив,
// `/health` отвечал бы, а всё остальное висело бы. `probe` берёт блокировку;
// не вернулась за порог — дамп горутин и выход, супервизор запустит движок
// заново. `client.Close()` перед выходом не зовём: он ждал бы ту же блокировку
func (a *api) watchdog(ctx context.Context, probe func()) {
	a.lockAlive.Store(time.Now().UnixNano())

	ticker := time.NewTicker(a.watchEvery)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		done := make(chan struct{})
		go func() {
			defer close(done)
			probe()
		}()

		deadline := time.NewTimer(a.lockStuckFrom)

		select {
		case <-ctx.Done():
			deadline.Stop()
			return
		case <-done:
			deadline.Stop()
			a.lockAlive.Store(time.Now().UnixNano())
		case <-deadline.C:
			var goroutines bytes.Buffer
			_ = pprof.Lookup("goroutine").WriteTo(&goroutines, 2)
			a.logger.Error("client lock stuck", "after", a.lockStuckFrom.String(), "goroutines", goroutines.String())
			a.exit(2)
			return
		}
	}
}

// Последняя проба блокировки старше порога: супервизор видит застрявший
// движок и в промежутке до выхода
func (a *api) lockStuck() bool {
	alive := a.lockAlive.Load()

	return alive != 0 && time.Since(time.Unix(0, alive)) > a.lockStuckFrom
}

type fileDetails struct {
	Path    string `json:"path"`
	Length  int64  `json:"length"`
	Padding bool   `json:"padding"`
	// Только у `inspect` с `dir`: сверка с файлом на диске (`compareOnDisk`)
	OnDisk string `json:"onDisk,omitempty"`
}

type torrentDetails struct {
	InfoHash    string        `json:"infoHash"`
	Name        string        `json:"name"`
	PieceLength int64         `json:"pieceLength"`
	PieceCount  int           `json:"pieceCount"`
	Files       []fileDetails `json:"files"`
}

func detailsOf(mi *metainfo.MetaInfo) (torrentDetails, error) {
	info, err := mi.UnmarshalInfo()
	if err != nil {
		return torrentDetails{}, err
	}

	// Порядок и состав файлов — как в info: индексы совпадают у всех движков
	files := []fileDetails{}
	for file := range info.UpvertedFilesIter() {
		filePath := strings.Join(file.BestPath(), "/")

		// У раздачи из одного файла пути нет: файл называется именем раздачи
		if filePath == "" {
			filePath = info.BestName()
		}

		files = append(files, fileDetails{
			Path:    filePath,
			Length:  file.Length,
			Padding: strings.Contains(file.Attr, "p"),
		})
	}

	return torrentDetails{
		InfoHash:    mi.HashInfoBytes().HexString(),
		Name:        info.BestName(),
		PieceLength: info.PieceLength,
		PieceCount:  info.NumPieces(),
		Files:       files,
	}, nil
}

func readMetainfo(r *http.Request) (*metainfo.MetaInfo, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxTorrentFileBytes))
	if err != nil {
		return nil, err
	}

	return metainfo.Load(bytes.NewReader(body))
}

// Файлы и infohash `.torrent` без добавления раздачи
func (a *api) inspect(w http.ResponseWriter, r *http.Request) {
	mi, err := readMetainfo(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_torrent", err)
		return
	}

	details, err := detailsOf(mi)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_torrent", err)
		return
	}

	if raw := r.URL.Query().Get("dir"); raw != "" {
		if !filepath.IsAbs(raw) {
			writeError(w, http.StatusBadRequest, "invalid_dir", errors.New("dir must be an absolute path"))
			return
		}

		info, err := mi.UnmarshalInfo()
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_torrent", err)
			return
		}

		for i, state := range compareOnDisk(r.Context(), &info, filepath.Clean(raw)) {
			details.Files[i].OnDisk = state
		}
	}

	writeJSON(w, http.StatusOK, details)
}

// Метаданные по magnet от пиров. Раздача остаётся в клиенте без выбранных
// файлов: качать она ничего не будет, а найденные пиры пригодятся при просмотре
func (a *api) resolve(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_magnet", err)
		return
	}

	timeout := 5 * time.Minute
	if ms, err := strconv.Atoi(r.URL.Query().Get("timeout_ms")); err == nil && ms > 0 {
		timeout = time.Duration(ms) * time.Millisecond
	}

	t, err := a.client.AddMagnet(strings.TrimSpace(string(body)))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_magnet", err)
		return
	}

	select {
	case <-t.GotInfo():
	case <-time.After(timeout):
		writeError(w, http.StatusGatewayTimeout, "timeout", errors.New("no peers sent the torrent metadata"))
		return
	case <-r.Context().Done():
		return
	}

	mi := t.Metainfo()
	w.Header().Set("Content-Type", "application/x-bittorrent")
	if err := mi.Write(w); err != nil {
		a.logger.Warn("write metainfo", "err", err)
	}
}

func parseFiles(raw string) ([]int, error) {
	if raw == "" {
		return nil, nil
	}

	var files []int
	for _, part := range strings.Split(raw, ",") {
		index, err := strconv.Atoi(part)
		if err != nil || index < 0 {
			return nil, fmt.Errorf("invalid file index %q", part)
		}
		files = append(files, index)
	}

	return files, nil
}

// Выбранные файлы качаются целиком сразу, `high` из них — раньше остальных,
// невыбранные — только окнами потоков
func setFiles(t *torrent.Torrent, selected, high, low []int) error {
	files := t.Files()
	wanted := map[int]torrent.PiecePriority{}
	// У библиотеки нет Low: низкий уровень ждёт обычные файлы,
	// затем включается с тем же автоматическим порядком серий.
	var regular []int
	for _, index := range selected {
		if !slices.Contains(low, index) {
			regular = append(regular, index)
		}
	}
	deferLow := !selectionComplete(t, regular)

	for _, index := range selected {
		if index < 0 || index >= len(files) {
			return fmt.Errorf("file index %d out of range", index)
		}
		wanted[index] = torrent.PiecePriorityNormal
		if deferLow && slices.Contains(low, index) {
			wanted[index] = torrent.PiecePriorityNone
		}
	}

	for _, index := range high {
		if _, ok := wanted[index]; ok {
			wanted[index] = torrent.PiecePriorityHigh
		}
	}

	for index, file := range files {
		file.SetPriority(wanted[index])
	}

	return nil
}

// Пауза: раздача не качает и не раздаёт. Порядок важен из-за anacrolix
// v1.61: `DisallowDataDownload` убирает куски из порядка запросов, но
// оставляет их ожидающими, и самопроверка библиотеки (`needData`) паникует
// при следующем пересчёте приоритетов — посреди него блокировка клиента
// остаётся захваченной. Поэтому сначала снимаем всё, что раздача хочет
// качать (выбор и окна), запрещаем закачку и только потом возвращаем выбор:
// на паузе он не становится ожидающим, а `AllowDataDownload` при продолжении
// пересчитает его сам. Куски у позиции открытого потока библиотека держит
// сама; пауза во время просмотра — редкость, а паника перезапустит движок
func (a *api) setPaused(t *torrent.Torrent, paused bool, selected []int) {
	// Приоритеты и отдачу на паузе ставит этот код, а после неё — планировщик заново
	a.sched.forget(t)

	if !paused {
		t.AllowDataDownload()
		t.AllowDataUpload()
		return
	}

	_ = setFiles(t, nil, nil, nil)
	a.windows.release(t.InfoHash())

	t.DisallowDataDownload()
	t.DisallowDataUpload()

	if err := setFiles(t, selected, nil, a.session.get(t.InfoHash()).Low); err != nil {
		a.logger.Warn("pause files", "infoHash", t.InfoHash().HexString(), "err", err)
	}
}

// Раздачи прошлого запуска: выбор файлов и пауза — как были
func (a *api) restore(ctx context.Context) {
	restored, errs := a.session.load()

	for _, err := range errs {
		a.logger.Warn("restore torrent", "err", err)
	}

	for _, item := range restored {
		// Остановка во время восстановления: остальные раздачи — в следующий запуск
		if ctx.Err() != nil {
			return
		}

		dir := a.dirOrDefault(item.saved.Dir)

		if info, err := item.meta.UnmarshalInfo(); err == nil {
			a.finishMove(item.meta.HashInfoBytes(), &info, dir, &item.saved)
			adoptPartFiles(dir, &info)
		}

		t, err := a.addIn(item.meta, dir)
		if err != nil {
			a.logger.Warn("restore torrent", "err", err)
			continue
		}

		// До `ok` в `/health`: сервер не откроет поток, который отдал бы нули вместо данных
		a.verifyHoles(t)

		saved := item.saved

		// Запись прежней версии: выбор без докачки — файлы, которые выбрал
		// просмотр, а не скачивание; целиком их не качаем
		if saved.Background != nil {
			if !*saved.Background {
				saved.Selected = nil
			}
			saved.Background = nil

			if err := a.session.saveSelection(t.InfoHash(), saved); err != nil {
				a.logger.Warn("save session", "err", err)
			}
		}

		// Выбор остальных расставит планировщик: с очередью качать всё сразу нельзя
		if saved.Paused {
			a.setPaused(t, true, saved.Selected)
		}
	}

	a.reschedule()
	a.restored.Store(true)
	a.logger.Info("torrents restored", "count", len(restored))
}

// Добавляет `.torrent` (уже добавленный возвращает как есть) и выбирает файлы
func (a *api) add(w http.ResponseWriter, r *http.Request) {
	selected, err := parseFiles(r.URL.Query().Get("files"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	first, err := parseFiles(r.URL.Query().Get("first"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	low, err := parseFiles(r.URL.Query().Get("low"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	dir := a.downloads
	if raw := r.URL.Query().Get("dir"); raw != "" {
		if !filepath.IsAbs(raw) {
			writeError(w, http.StatusBadRequest, "invalid_dir", errors.New("dir must be an absolute path"))
			return
		}
		dir = filepath.Clean(raw)
	}

	mi, err := readMetainfo(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_torrent", err)
		return
	}

	details, err := detailsOf(mi)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_torrent", err)
		return
	}

	hash := mi.HashInfoBytes()

	if a.isMoving(hash) {
		writeMoving(w)
		return
	}

	existing, known := a.client.Torrent(hash)

	// Раздачу, у которой только искали метаданные, клиент держит в каталоге по
	// умолчанию: она ничего не записала и открывается заново в своём.
	// Добавленная раньше остаётся в своём каталоге — сменить его может только
	// перенос
	if known && !a.session.has(hash) && !samePath(a.dirOf(hash), dir) {
		existing.Drop()
		a.dirs.Delete(hash)
		known = false
	}

	if known {
		dir = a.dirOf(hash)
	}

	if info, err := mi.UnmarshalInfo(); err == nil && !known {
		adoptPartFiles(dir, &info)
	}

	t, err := a.addIn(mi, dir)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_torrent", err)
		return
	}

	<-t.GotInfo()

	// Раздача только что открыта хранилищем: на диске могли остаться её файлы
	if !known {
		a.verifyHoles(t)
	}

	if err := checkFiles(t, slices.Concat(selected, first, low)); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	sessionDir := a.sessionDir(dir)
	err = a.session.save(mi, func(saved *savedTorrent) {
		queue(saved, selected, first, low)
		saved.Background = nil
		saved.Dir = sessionDir
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage", err)
		return
	}

	a.applySelection(t)

	writeJSON(w, http.StatusOK, details)
}

// Новый выбор: раздача, у которой его не было, встаёт в конец очереди
func queue(saved *savedTorrent, selected, first, low []int) {
	if len(selected) > 0 && (len(saved.Selected) == 0 || saved.QueuedAt == 0) {
		saved.QueuedAt = time.Now().UnixMilli()
	}
	saved.Selected = selected
	saved.First = nil
	saved.Low = nil
	for _, index := range selected {
		if slices.Contains(first, index) {
			saved.First = append(saved.First, index)
		} else if slices.Contains(low, index) {
			saved.Low = append(saved.Low, index)
		}
	}
}

// Выбор сохранён: на паузе он ставится, как раньше (см. `setPaused`), иначе
// его применяет планировщик — с очередью и привратником
func (a *api) applySelection(t *torrent.Torrent) {
	if saved := a.session.get(t.InfoHash()); saved.Paused {
		a.sched.forget(t)
		if err := setFiles(t, saved.Selected, nil, saved.Low); err != nil {
			a.logger.Warn("pause files", "infoHash", t.InfoHash().HexString(), "err", err)
		}
		return
	}

	a.reschedule()
}

func checkFiles(t *torrent.Torrent, selected []int) error {
	count := len(t.Files())

	for _, index := range selected {
		if index < 0 || index >= count {
			return fmt.Errorf("file index %d out of range", index)
		}
	}

	return nil
}

func (a *api) torrentOf(w http.ResponseWriter, r *http.Request) (*torrent.Torrent, bool) {
	var hash metainfo.Hash

	if err := hash.FromHexString(r.PathValue("hash")); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_hash", err)
		return nil, false
	}

	t, ok := a.client.Torrent(hash)

	// После поиска: перенос убирает раздачу из клиента уже после отметки,
	// и пропавшая раздача должна дать `torrent_moving`, а не 404
	if a.isMoving(hash) {
		writeMoving(w)
		return nil, false
	}

	if !ok || t.Info() == nil {
		writeError(w, http.StatusNotFound, "torrent_not_found", errors.New("torrent is not in the engine"))
		return nil, false
	}

	return t, true
}

func (a *api) selectFiles(w http.ResponseWriter, r *http.Request) {
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}

	var body struct {
		Files []int `json:"files"`
		First []int `json:"first"`
		Low   []int `json:"low"`
	}

	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	if err := checkFiles(t, slices.Concat(body.Files, body.First, body.Low)); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	err := a.session.update(t.InfoHash(), func(saved *savedTorrent) {
		queue(saved, body.Files, body.First, body.Low)
		saved.Background = nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage", err)
		return
	}

	a.applySelection(t)

	w.WriteHeader(http.StatusNoContent)
}

// Раздавать ли раздачу, когда ей уже ничего не нужно. Пока она качает выбор
// или её смотрят, отдача разрешена всегда
func (a *api) setSeed(w http.ResponseWriter, r *http.Request) {
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}

	var body struct {
		Seed *bool `json:"seed"`
	}

	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil || body.Seed == nil {
		writeError(w, http.StatusBadRequest, "invalid_seed", errors.New("seed must be true or false"))
		return
	}

	err := a.session.update(t.InfoHash(), func(saved *savedTorrent) {
		saved.Seed = nil
		if !*body.Seed {
			saved.Seed = body.Seed
		}
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage", err)
		return
	}

	a.reschedule()
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) getSettings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.limits.current())
}

// Живые настройки: лимиты, соединения и очередь действуют сразу
func (a *api) putSettings(w http.ResponseWriter, r *http.Request) {
	var settings liveSettings

	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&settings); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_settings", err)
		return
	}

	if err := settings.validate(); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_settings", err)
		return
	}

	a.limits.set(settings)

	if a.restored.Load() {
		a.reschedule()
	}

	writeJSON(w, http.StatusOK, settings)
}

func (a *api) pause(w http.ResponseWriter, r *http.Request) {
	a.setPausedHandler(w, r, true)
}

func (a *api) resume(w http.ResponseWriter, r *http.Request) {
	a.setPausedHandler(w, r, false)
}

func (a *api) setPausedHandler(w http.ResponseWriter, r *http.Request, paused bool) {
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}

	a.setPaused(t, paused, a.session.get(t.InfoHash()).Selected)

	if err := a.session.update(t.InfoHash(), func(saved *savedTorrent) { saved.Paused = paused }); err != nil {
		writeError(w, http.StatusInternalServerError, "storage", err)
		return
	}

	if !paused {
		a.reschedule()
	}

	w.WriteHeader(http.StatusNoContent)
}

type forgetResponse struct {
	// Сколько байт освободило удаление файлов
	DeletedBytes int64 `json:"deletedBytes"`
}

// Убирает раздачу из движка. С `delete_files=true` удаляет и её файлы вместе
// с отметками скачанных кусков: иначе повторное добавление сочло бы куски
// скачанными. Без параметра файлы остаются на диске
func (a *api) forget(w http.ResponseWriter, r *http.Request) {
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}

	deleteFiles := r.URL.Query().Get("delete_files") == "true"
	info := t.Info()
	hash := t.InfoHash()
	dir := a.dirOf(hash)

	t.Drop()
	a.dirs.Delete(hash)
	a.forgetMove(hash)

	if err := a.session.remove(hash); err != nil {
		a.logger.Warn("remove session", "err", err)
	}

	a.windows.forget(hash)

	var response forgetResponse

	if deleteFiles {
		for index := range info.NumPieces() {
			if err := a.completion.Set(metainfo.PieceKey{InfoHash: hash, Index: index}, false); err != nil {
				a.logger.Warn("reset piece completion", "infoHash", hash.HexString(), "err", err)
				break
			}
		}

		deleted, err := deleteTorrentFiles(dir, info)
		response.DeletedBytes = deleted
		// Удаление файлов — единственное место, где движок сам стирает данные
		a.logger.Info("torrent files deleted", "infoHash", hash.HexString(), "bytes", deleted)

		if err != nil {
			writeError(w, http.StatusInternalServerError, "storage", err)
			return
		}
	}

	writeJSON(w, http.StatusOK, response)
}

type peersResponse struct {
	Connected int `json:"connected"`
	Found     int `json:"found"`
	Seeders   int `json:"seeders"`
}

// Общая часть списка и статистики раздачи
type torrentState struct {
	InfoHash string `json:"infoHash"`
	Paused   bool   `json:"paused"`
	// Файлы, которые качаются целиком; остальное качают только окна потоков
	Selected []int `json:"selected"`
	// Файлы выбора, которые качаются раньше остальных
	High []int `json:"high"`
	// Скачано всего: куски, прочитанные потоком вне выбора, тоже на диске
	BytesCompleted int64 `json:"bytesCompleted"`
	// Размер выбранных файлов и сколько из них скачано
	BytesWanted     int64 `json:"bytesWanted"`
	WantedCompleted int64 `json:"wantedCompleted"`
	// Выбор ждёт очереди: качаются другие раздачи
	Queued bool `json:"queued"`
	// Раздача отдаёт скачанное пирам
	Seeding bool `json:"seeding"`
	// Отдано пирам за всё время, байт
	Uploaded int64         `json:"uploaded"`
	Peers    peersResponse `json:"peers"`
	// Байт в секунду за последние секунды
	DownloadSpeed int64   `json:"downloadSpeed"`
	UploadSpeed   int64   `json:"uploadSpeed"`
	FileProgress  []int64 `json:"fileProgress"`
	// Куски с неверным хэшем за время работы движка: их байты могли уйти в поток
	BadPieces int64 `json:"badPieces"`
}

func (a *api) stateOf(t *torrent.Torrent) torrentState {
	hash := t.InfoHash()
	saved := a.session.get(hash)
	stats := t.Stats()
	current := a.speeds.of(hash)
	files := t.Files()

	state := torrentState{
		InfoHash:       hash.HexString(),
		Paused:         saved.Paused,
		Selected:       saved.Selected,
		High:           a.sched.highOf(hash),
		BytesCompleted: t.BytesCompleted(),
		Queued:         a.sched.isQueued(hash),
		Seeding:        t.Seeding() && !saved.Paused,
		Uploaded:       a.uploadedOf(t, saved),
		Peers: peersResponse{
			Connected: stats.ActivePeers,
			Found:     stats.TotalPeers,
			Seeders:   stats.ConnectedSeeders,
		},
		DownloadSpeed: current.download,
		UploadSpeed:   current.upload,
		FileProgress:  []int64{},
		BadPieces:     badPiecesOf(stats),
	}

	if state.Selected == nil {
		state.Selected = []int{}
	}
	if state.High == nil {
		state.High = []int{}
	}

	for _, file := range files {
		state.FileProgress = append(state.FileProgress, file.BytesCompleted())
	}

	for _, index := range state.Selected {
		if index < len(files) {
			state.BytesWanted += files[index].Length()
			state.WantedCompleted += state.FileProgress[index]
		}
	}

	return state
}

// Все раздачи движка с метаданными — для списка загрузок и учёта места
func (a *api) list(w http.ResponseWriter, _ *http.Request) {
	states := []torrentState{}

	for _, t := range a.client.Torrents() {
		if t.Info() == nil {
			continue
		}
		states = append(states, a.stateOf(t))
	}

	writeJSON(w, http.StatusOK, states)
}

type statsResponse struct {
	torrentState
	// Скачанные куски: строка из 0 и 1 по порядку кусков
	Pieces string `json:"pieces"`
}

func (a *api) stats(w http.ResponseWriter, r *http.Request) {
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}

	response := statsResponse{torrentState: a.stateOf(t)}

	var pieces strings.Builder
	for _, run := range t.PieceStateRuns() {
		digit := "0"
		if run.Complete {
			digit = "1"
		}
		pieces.WriteString(strings.Repeat(digit, run.Length))
	}
	response.Pieces = pieces.String()

	writeJSON(w, http.StatusOK, response)
}

func fileOf(w http.ResponseWriter, r *http.Request, t *torrent.Torrent) (*torrent.File, bool) {
	index, err := strconv.Atoi(r.PathValue("index"))
	files := t.Files()

	if err != nil || index < 0 || index >= len(files) {
		writeError(w, http.StatusNotFound, "file_not_found", errors.New("file is not in the torrent"))
		return nil, false
	}

	return files[index], true
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, kind string, err error) {
	writeJSON(w, status, map[string]string{"kind": kind, "message": err.Error()})
}

// Отменённый запрос — не ошибка: плеер закрыл соединение при перемотке
func isCanceled(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}
