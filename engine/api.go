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
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
)

// Тело `.torrent` больших паков — единицы мегабайт
const maxTorrentFileBytes = 16 << 20

type api struct {
	client  *torrent.Client
	session *session
	logger  *slog.Logger

	mu      sync.Mutex
	samples map[metainfo.Hash]speedSample
	// Выбранные файлы, которые ещё не качаются целиком: докачка включается
	// после старта просмотра, чтобы куски файла не конкурировали с началом
	pending map[metainfo.Hash][]int
}

// Скорость считается по разнице счётчиков между запросами статистики
type speedSample struct {
	at         time.Time
	downloaded int64
	uploaded   int64
}

func newAPI(client *torrent.Client, session *session, logger *slog.Logger) *api {
	return &api{
		client:  client,
		session: session,
		logger:  logger,
		samples: map[metainfo.Hash]speedSample{},
		pending: map[metainfo.Hash][]int{},
	}
}

func (a *api) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /torrents/inspect", a.inspect)
	mux.HandleFunc("POST /torrents/resolve", a.resolve)
	mux.HandleFunc("POST /torrents", a.add)
	mux.HandleFunc("PUT /torrents/{hash}/files", a.selectFiles)
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

	if err := a.session.saveSelection(t.InfoHash(), savedTorrent{Selected: selected, Background: true}); err != nil {
		a.logger.Warn("save session", "err", err)
	}
}

// Раздачи прошлого запуска: выбор файлов и фоновая докачка — как были
func (a *api) restore() {
	restored, errs := a.session.load()

	for _, err := range errs {
		a.logger.Warn("restore torrent", "err", err)
	}

	for _, item := range restored {
		t, err := a.client.AddTorrent(item.meta)
		if err != nil {
			a.logger.Warn("restore torrent", "err", err)
			continue
		}

		if item.saved.Background {
			err = setFiles(t, item.saved.Selected)
		} else {
			err = a.selectLater(t, item.saved.Selected)
		}

		if err != nil {
			a.logger.Warn("restore files", "hash", t.InfoHash().HexString(), "err", err)
		}
	}

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

	t, err := a.client.AddTorrent(mi)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_torrent", err)
		return
	}

	<-t.GotInfo()

	if err := a.selectLater(t, selected); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	if err := a.session.save(mi, savedTorrent{Selected: selected}); err != nil {
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
	}

	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	if err := a.selectLater(t, body.Files); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_files", err)
		return
	}

	if err := a.session.saveSelection(t.InfoHash(), savedTorrent{Selected: body.Files}); err != nil {
		writeError(w, http.StatusInternalServerError, "storage", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Убирает раздачу из движка; файлы остаются на диске
func (a *api) forget(w http.ResponseWriter, r *http.Request) {
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}

	t.Drop()

	if err := a.session.remove(t.InfoHash()); err != nil {
		a.logger.Warn("remove session", "err", err)
	}

	a.mu.Lock()
	delete(a.samples, t.InfoHash())
	delete(a.pending, t.InfoHash())
	a.mu.Unlock()

	w.WriteHeader(http.StatusNoContent)
}

type statsResponse struct {
	Peers struct {
		Connected int `json:"connected"`
		Found     int `json:"found"`
		Seeders   int `json:"seeders"`
	} `json:"peers"`
	// Байт в секунду со времени прошлого запроса
	DownloadSpeed int64   `json:"downloadSpeed"`
	UploadSpeed   int64   `json:"uploadSpeed"`
	FileProgress  []int64 `json:"fileProgress"`
	// Скачанные куски: строка из 0 и 1 по порядку кусков
	Pieces string `json:"pieces"`
}

func (a *api) stats(w http.ResponseWriter, r *http.Request) {
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}

	stats := t.Stats()
	now := time.Now()
	downloaded := stats.BytesReadData.Int64()
	uploaded := stats.BytesWrittenData.Int64()

	var response statsResponse
	response.Peers.Connected = stats.ActivePeers
	response.Peers.Found = stats.TotalPeers
	response.Peers.Seeders = stats.ConnectedSeeders

	a.mu.Lock()
	if prev, ok := a.samples[t.InfoHash()]; ok {
		if elapsed := now.Sub(prev.at).Seconds(); elapsed > 0 {
			response.DownloadSpeed = int64(float64(downloaded-prev.downloaded) / elapsed)
			response.UploadSpeed = int64(float64(uploaded-prev.uploaded) / elapsed)
		}
	}
	a.samples[t.InfoHash()] = speedSample{at: now, downloaded: downloaded, uploaded: uploaded}
	a.mu.Unlock()

	for _, file := range t.Files() {
		response.FileProgress = append(response.FileProgress, file.BytesCompleted())
	}

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
