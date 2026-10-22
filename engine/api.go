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

type api struct {
	client  *torrent.Client
	session *session
	logger  *slog.Logger
	// Каталог загрузок и отметки скачанных кусков: удаление с файлами
	// убирает и то и другое
	downloads  string
	completion storage.PieceCompletion
	speeds     *speedTracker
	// Раздачи прошлого запуска добавлены заново: до этого сервер к движку не
	// ходит, `/health` отвечает `restoring`
	restored atomic.Bool

	mu sync.Mutex
	// Выбранные файлы, которые ещё не качаются целиком: докачка включается
	// после старта просмотра, чтобы куски файла не конкурировали с началом
	pending map[metainfo.Hash][]int
}

func newAPI(client *torrent.Client, session *session, store clientStorage, logger *slog.Logger) *api {
	return &api{
		client:     client,
		session:    session,
		logger:     logger,
		downloads:  store.downloads,
		completion: store.completion,
		speeds:     newSpeedTracker(),
		pending:    map[metainfo.Hash][]int{},
	}
}

func (a *api) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
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
	mux.HandleFunc("GET /torrents/{hash}/stats", a.stats)
	mux.HandleFunc("GET /torrents/{hash}/files/{index}/stream", a.stream)

	return mux
}

type fileDetails struct {
	Path    string `json:"path"`
	Length  int64  `json:"length"`
	Padding bool   `json:"padding"`
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

// Качаются только выбранные файлы; куски у позиции ридера срочные в любом случае
func setFiles(t *torrent.Torrent, selected []int) error {
	files := t.Files()
	wanted := map[int]bool{}

	for _, index := range selected {
		if index >= len(files) {
			return fmt.Errorf("file index %d out of range", index)
		}
		wanted[index] = true
	}

	for index, file := range files {
		if wanted[index] {
			file.SetPriority(torrent.PiecePriorityNormal)
		} else {
			file.SetPriority(torrent.PiecePriorityNone)
		}
	}

	return nil
}

// Запоминает выбор файлов, но пока ничего не качает целиком: до старта
// просмотра куски запрашивают только ридеры потока
func (a *api) selectLater(t *torrent.Torrent, selected []int) error {
	if err := setFiles(t, nil); err != nil {
		return err
	}

	for _, index := range selected {
		if index >= len(t.Files()) {
			return fmt.Errorf("file index %d out of range", index)
		}
	}

	a.mu.Lock()
	a.pending[t.InfoHash()] = selected
	a.mu.Unlock()

	return nil
}

// Включает докачку выбранных файлов целиком, если выбор не сменился
func (a *api) startBackground(t *torrent.Torrent) {
	a.mu.Lock()
	selected, ok := a.pending[t.InfoHash()]
	delete(a.pending, t.InfoHash())
	a.mu.Unlock()

	if !ok {
		return
	}

	if err := setFiles(t, selected); err != nil {
		a.logger.Warn("background download", "err", err)
		return
	}

	err := a.session.update(t.InfoHash(), func(saved *savedTorrent) {
		saved.Selected = selected
		saved.Background = true
	})
	if err != nil {
		a.logger.Warn("save session", "err", err)
	}
}

// Выбранные файлы качаются целиком сразу, без ожидания просмотра
func (a *api) downloadNow(t *torrent.Torrent, selected []int) error {
	a.mu.Lock()
	delete(a.pending, t.InfoHash())
	a.mu.Unlock()

	return setFiles(t, selected)
}

func setPaused(t *torrent.Torrent, paused bool) {
	if paused {
		t.DisallowDataDownload()
		t.DisallowDataUpload()
	} else {
		t.AllowDataDownload()
		t.AllowDataUpload()
	}
}

// Раздачи прошлого запуска: выбор файлов и фоновая докачка — как были
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

		if info, err := item.meta.UnmarshalInfo(); err == nil {
			adoptPartFiles(a.downloads, &info)
		}

		t, err := a.client.AddTorrent(item.meta)
		if err != nil {
			a.logger.Warn("restore torrent", "err", err)
			continue
		}

		// До `ok` в `/health`: сервер не откроет поток, который отдал бы нули вместо данных
		a.verifyHoles(t)

		if item.saved.Background {
			err = setFiles(t, item.saved.Selected)
		} else {
			err = a.selectLater(t, item.saved.Selected)
		}

		if err != nil {
			a.logger.Warn("restore files", "hash", t.InfoHash().HexString(), "err", err)
		}

		setPaused(t, item.saved.Paused)
	}

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

	_, known := a.client.Torrent(mi.HashInfoBytes())

	if info, err := mi.UnmarshalInfo(); err == nil && !known {
		adoptPartFiles(a.downloads, &info)
	}

	t, err := a.client.AddTorrent(mi)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_torrent", err)
		return
	}

	<-t.GotInfo()

	// Раздача только что открыта хранилищем: на диске могли остаться её файлы
	if !known {
		a.verifyHoles(t)
	}

	// Раздача уже докачивается целиком (её смотрели или скачивают): новый
	// выбор тоже качается сразу, иначе скачивание встало бы до нового просмотра
	saved := a.session.get(t.InfoHash())
	saved.Selected = selected

	if saved.Background {
		err = a.downloadNow(t, selected)
	} else {
		err = a.selectLater(t, selected)
	}

	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	if err := a.session.save(mi, saved); err != nil {
		writeError(w, http.StatusInternalServerError, "storage", err)
		return
	}

	writeJSON(w, http.StatusOK, details)
}

func (a *api) torrentOf(w http.ResponseWriter, r *http.Request) (*torrent.Torrent, bool) {
	var hash metainfo.Hash

	if err := hash.FromHexString(r.PathValue("hash")); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_hash", err)
		return nil, false
	}

	t, ok := a.client.Torrent(hash)
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
		// Качать выбранные целиком сразу, а не после начала просмотра
		Now bool `json:"now"`
	}

	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	saved := a.session.get(t.InfoHash())
	now := body.Now || saved.Background

	var err error
	if now {
		err = a.downloadNow(t, body.Files)
	} else {
		err = a.selectLater(t, body.Files)
	}

	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	err = a.session.update(t.InfoHash(), func(saved *savedTorrent) {
		saved.Selected = body.Files
		saved.Background = now
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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

	setPaused(t, paused)

	if err := a.session.update(t.InfoHash(), func(saved *savedTorrent) { saved.Paused = paused }); err != nil {
		writeError(w, http.StatusInternalServerError, "storage", err)
		return
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

	t.Drop()

	if err := a.session.remove(hash); err != nil {
		a.logger.Warn("remove session", "err", err)
	}

	a.mu.Lock()
	delete(a.pending, hash)
	a.mu.Unlock()

	var response forgetResponse

	if deleteFiles {
		for index := range info.NumPieces() {
			if err := a.completion.Set(metainfo.PieceKey{InfoHash: hash, Index: index}, false); err != nil {
				a.logger.Warn("reset piece completion", "hash", hash.HexString(), "err", err)
				break
			}
		}

		deleted, err := deleteTorrentFiles(a.downloads, info)
		response.DeletedBytes = deleted
		// Удаление файлов — единственное место, где движок сам стирает данные
		a.logger.Warn("torrent files deleted", "hash", hash.HexString(), "bytes", deleted)

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
	// Выбранные файлы качаются целиком (иначе — только то, что читает поток)
	Background bool  `json:"background"`
	Selected   []int `json:"selected"`
	// Скачано всего: куски, прочитанные потоком вне выбора, тоже на диске
	BytesCompleted int64 `json:"bytesCompleted"`
	// Размер выбранных файлов и сколько из них скачано
	BytesWanted     int64 `json:"bytesWanted"`
	WantedCompleted int64 `json:"wantedCompleted"`
	// Раздача отдаёт скачанное пирам
	Seeding bool          `json:"seeding"`
	Peers   peersResponse `json:"peers"`
	// Байт в секунду за последние секунды
	DownloadSpeed int64   `json:"downloadSpeed"`
	UploadSpeed   int64   `json:"uploadSpeed"`
	FileProgress  []int64 `json:"fileProgress"`
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
		Background:     saved.Background,
		Selected:       saved.Selected,
		BytesCompleted: t.BytesCompleted(),
		Seeding:        t.Seeding() && !saved.Paused,
		Peers: peersResponse{
			Connected: stats.ActivePeers,
			Found:     stats.TotalPeers,
			Seeders:   stats.ConnectedSeeders,
		},
		DownloadSpeed: current.download,
		UploadSpeed:   current.upload,
		FileProgress:  []int64{},
	}

	if state.Selected == nil {
		state.Selected = []int{}
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
