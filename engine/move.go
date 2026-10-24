package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// Временное имя файла в новом каталоге: под итоговым именем файл появляется
// только целиком
const moveSuffix = ".torsher-move"

// Подмена в тестах: `EXDEV` на любой ФС
var linkFile = os.Link

// Чужой файл под итоговым именем в новом каталоге: перенос его не трогает
var errFileExists = errors.New("file already exists in the new directory")

func samePath(a, b string) bool {
	return filepath.Clean(a) == filepath.Clean(b)
}

// Один каталог под разными путями: симлинк, bind-mount (тот же inode) или
// один сетевой экспорт, смонтированный дважды (inode разные — видно только
// по пробному файлу). Перенос в такой каталог удалил бы исходники вместе с
// «копией»
func sameDir(from, to string) bool {
	if samePath(from, to) {
		return true
	}

	fromStat, err := os.Stat(from)
	if err != nil {
		return false
	}

	toStat, err := os.Stat(to)
	if err != nil {
		return false
	}

	if os.SameFile(fromStat, toStat) {
		return true
	}

	var random [8]byte
	_, _ = rand.Read(random[:])
	name := ".torsher-same-" + hex.EncodeToString(random[:])
	probe := filepath.Join(to, name)

	file, err := os.OpenFile(probe, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return false
	}
	_ = file.Close()
	defer os.Remove(probe)

	_, err = os.Lstat(filepath.Join(from, name))

	return err == nil
}

// Каталог раздачи; раздача без своего — в каталоге по умолчанию
func (a *api) dirOf(hash metainfo.Hash) string {
	if dir, ok := a.dirs.Load(hash); ok {
		return dir.(string)
	}

	return a.downloads
}

func (a *api) dirOrDefault(dir string) string {
	if dir == "" {
		return a.downloads
	}

	return filepath.Clean(dir)
}

// В сессии каталог по умолчанию не пишется: раздача идёт за `--downloads`
func (a *api) sessionDir(dir string) string {
	if samePath(dir, a.downloads) {
		return ""
	}

	return filepath.Clean(dir)
}

// Хранилище каталога; у каталога по умолчанию — хранилище клиента (`nil`).
// Хранилища не закрываются: их закрытие закрыло бы общие отметки кусков
func (a *api) storageFor(dir string) storage.ClientImpl {
	if samePath(dir, a.downloads) {
		return nil
	}

	a.storesMu.Lock()
	defer a.storesMu.Unlock()

	key := filepath.Clean(dir)
	if found, ok := a.stores[key]; ok {
		return found
	}

	created := fileStorage(key, a.completion)
	a.stores[key] = created

	return created
}

// Добавляет раздачу в клиент с хранилищем её каталога
func (a *api) addIn(mi *metainfo.MetaInfo, dir string) (*torrent.Torrent, error) {
	spec, err := torrent.TorrentSpecFromMetaInfoErr(mi)
	if err != nil {
		return nil, err
	}

	spec.Storage = a.storageFor(dir)

	t, _, err := a.client.AddTorrentSpec(spec)
	if err != nil {
		return nil, err
	}

	if samePath(dir, a.downloads) {
		a.dirs.Delete(t.InfoHash())
	} else {
		a.dirs.Store(t.InfoHash(), filepath.Clean(dir))
	}

	return t, nil
}

type moveState struct {
	Dir string `json:"dir"`
	// `running`, `done` или `failed`
	State      string `json:"state"`
	BytesTotal int64  `json:"bytesTotal"`
	BytesDone  int64  `json:"bytesDone"`
	Error      string `json:"error,omitempty"`
	// Вид ошибки для сервера: `exists` — в новом каталоге чужой файл
	Kind string `json:"kind,omitempty"`
}

type moveJob struct {
	mu    sync.Mutex
	state moveState
}

func (j *moveJob) snapshot() moveState {
	j.mu.Lock()
	defer j.mu.Unlock()

	return j.state
}

func (j *moveJob) update(change func(*moveState)) {
	j.mu.Lock()
	defer j.mu.Unlock()

	change(&j.state)
}

func (a *api) isMoving(hash metainfo.Hash) bool {
	a.movesMu.Lock()
	defer a.movesMu.Unlock()

	job, ok := a.moves[hash]

	return ok && job.snapshot().State == "running"
}

func (a *api) forgetMove(hash metainfo.Hash) {
	a.movesMu.Lock()
	defer a.movesMu.Unlock()

	delete(a.moves, hash)
}

func writeMoving(w http.ResponseWriter) {
	writeError(w, http.StatusConflict, "torrent_moving", errors.New("torrent is being moved"))
}

// Переносит раздачу в другой каталог в фоне. Раздача на время переноса уходит
// из клиента: не качает, не раздаёт, поток не открыть. Ход — `GET …/move`
func (a *api) startMove(w http.ResponseWriter, r *http.Request) {
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}

	hash := t.InfoHash()
	job := &moveJob{state: moveState{State: "running"}}

	// Задание занимается до любого ввода-вывода: параллельный запрос получает
	// `torrent_moving`, а не второй перенос тех же файлов
	a.movesMu.Lock()
	if current, ok := a.moves[hash]; ok && current.snapshot().State == "running" {
		a.movesMu.Unlock()
		writeMoving(w)
		return
	}
	a.moves[hash] = job
	a.movesMu.Unlock()

	reject := func(status int, kind string, err error) {
		a.forgetMove(hash)
		writeError(w, status, kind, err)
	}

	var body struct {
		Dir string `json:"dir"`
	}

	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil || !filepath.IsAbs(body.Dir) {
		reject(http.StatusBadRequest, "invalid_dir", errors.New("dir must be an absolute path"))
		return
	}

	// Раздача только из поиска метаданных: `.torrent` для повторного открытия нет
	if !a.session.has(hash) {
		reject(http.StatusNotFound, "torrent_not_found", errors.New("torrent is not in the engine"))
		return
	}

	from := a.dirOf(hash)
	to := filepath.Clean(body.Dir)
	job.update(func(state *moveState) { state.Dir = to })

	if err := os.MkdirAll(to, 0o755); err != nil {
		reject(http.StatusInternalServerError, "storage", err)
		return
	}

	if samePath(from, to) {
		job.update(func(state *moveState) { state.State = "done" })
		writeJSON(w, http.StatusOK, job.snapshot())
		return
	}

	// `.torrent` из сессии, а не `t.Metainfo()`: собранный клиентом заново он
	// не открывается обратно (`no piece root set`)
	mi, err := metainfo.LoadFromFile(a.session.path(hash, ".torrent"))
	if err != nil {
		reject(http.StatusInternalServerError, "storage", err)
		return
	}

	info := t.Info()
	saved := a.session.get(hash)

	// Тот же каталог под другим путём: копировать нечего, а перенос удалил бы
	// исходники. Раздача только переоткрывается по новому пути, чтобы сессия и
	// сервер ссылались на один и тот же путь — иначе старый путь (снятый
	// симлинк, отмонтированный экспорт) остался бы в сессии навсегда
	if sameDir(from, to) {
		saved.Dir = a.sessionDir(to)
		saved.MovingTo = ""
		saved.MovedFrom = ""
		saved.Placed = nil
		if err := a.session.saveSelection(hash, saved); err != nil {
			reject(http.StatusInternalServerError, "storage", err)
			return
		}

		a.flushUploaded(t)
		complete := dropTorrent(t)
		a.windows.forget(hash)
		adoptPartFiles(to, info)

		// Сессия уже переключена: раздача вернётся при перезапуске движка
		if err := a.reopen(mi, to, saved, complete); err != nil {
			a.logger.With("hash", hash.HexString()).Error("reopen torrent", "err", err)
		}

		job.update(func(state *moveState) { state.State = "done" })
		writeJSON(w, http.StatusOK, job.snapshot())
		return
	}

	// Поставленное прошлой попыткой в другой каталог к этому не относится
	if !samePath(saved.MovingTo, to) {
		saved.Placed = nil
	}

	// Отметка до первого файла: перезапуск посреди переноса уберёт
	// недоделанное в новом каталоге (`finishMove`)
	saved.MovingTo = to
	if err := a.session.saveSelection(hash, saved); err != nil {
		reject(http.StatusInternalServerError, "storage", err)
		return
	}

	// Ожидание проверок кусков не держит ответ: задание уже занято
	go func() {
		a.flushUploaded(t)
		complete := dropTorrent(t)
		a.windows.forget(hash)
		a.runMove(job, mi, info, from, to, saved, complete)
	}()

	writeJSON(w, http.StatusAccepted, job.snapshot())
}

// Сколько перенос ждёт, пока куски допроверятся перед тем, как раздачу убрать
const settleTimeout = 30 * time.Second

// Убирает раздачу из клиента и возвращает её скачанные куски. Сразу после
// закачки последние куски ещё проверяются по хэшу и записывают отметку:
// проверка, оборванная закрытием хранилища, снимает отметку, и такие куски
// качались бы снова. Поэтому сначала ждём, пока проверки закончатся, а
// открытая заново раздача перепроверяет то, что всё же потерялось (`reopen`)
func dropTorrent(t *torrent.Torrent) []int {
	deadline := time.Now().Add(settleTimeout)

	for time.Now().Before(deadline) && piecesBusy(t) {
		time.Sleep(20 * time.Millisecond)
	}

	var complete []int

	for index := range t.NumPieces() {
		if t.Piece(index).State().Complete {
			complete = append(complete, index)
		}
	}

	t.Drop()

	return complete
}

func piecesBusy(t *torrent.Torrent) bool {
	for index := range t.NumPieces() {
		state := t.Piece(index).State()
		if state.Hashing || state.QueuedForHash || state.Marking {
			return true
		}
	}

	return false
}

func (a *api) moveStatus(w http.ResponseWriter, r *http.Request) {
	var hash metainfo.Hash

	if err := hash.FromHexString(r.PathValue("hash")); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_hash", err)
		return
	}

	a.movesMu.Lock()
	job, ok := a.moves[hash]
	a.movesMu.Unlock()

	if !ok {
		writeError(w, http.StatusNotFound, "move_not_found", errors.New("torrent is not being moved"))
		return
	}

	writeJSON(w, http.StatusOK, job.snapshot())
}

// Три шага, после каждого состояние рабочее: файлы ставятся в новый каталог
// рядом с исходниками → раздача открывается в новом каталоге → исходники
// удаляются. Сбой первого шага убирает поставленное, раздача остаётся на месте
func (a *api) runMove(job *moveJob, mi *metainfo.MetaInfo, info *metainfo.Info, from, to string, saved savedTorrent, complete []int) {
	hash := mi.HashInfoBytes()
	log := a.logger.With("hash", hash.HexString())
	log.Info("torrent move started")

	fail := func(err error) {
		removePlaced(info, from, to, saved.Placed)

		saved.MovingTo = ""
		saved.Placed = nil
		if err := a.session.saveSelection(hash, saved); err != nil {
			log.Warn("save session", "err", err)
		}

		if err := a.reopen(mi, from, saved, complete); err != nil {
			log.Warn("reopen torrent", "err", err)
		}

		job.update(func(state *moveState) {
			state.State = "failed"
			state.Error = err.Error()
			if errors.Is(err, errFileExists) {
				state.Kind = "exists"
			}
		})
		log.Warn("torrent move failed", "err", err)
	}

	total, err := dataBytes(info, from)
	if err != nil {
		fail(err)
		return
	}

	job.update(func(state *moveState) { state.BytesTotal = total })

	progress := func(n int64) {
		job.update(func(state *moveState) { state.BytesDone += n })
	}

	// Намерение пишется в сессию до того, как файл появится в новом каталоге:
	// откат и `finishMove` удаляют только записанное, чужой файл цел
	placed := placedFiles{
		owned: func(rel string) bool { return slices.Contains(saved.Placed, rel) },
		claim: func(rel string) error {
			saved.Placed = append(saved.Placed, rel)
			return a.session.saveSelection(hash, saved)
		},
	}

	if err := placeFiles(info, from, to, placed, progress); err != nil {
		fail(err)
		return
	}

	switched := saved
	switched.Dir = a.sessionDir(to)
	switched.MovingTo = ""
	switched.MovedFrom = from
	switched.Placed = nil

	if err := a.session.saveSelection(hash, switched); err != nil {
		fail(err)
		return
	}

	saved = switched

	// Файлы уже в новом каталоге и сессия переключена: задание удалось,
	// а раздача без клиента до перезапуска движка — повод для ошибки в журнале
	if err := a.reopen(mi, to, saved, complete); err != nil {
		log.Error("reopen torrent", "err", err)
	}

	if err := removeSources(info, from, to); err != nil {
		log.Warn("remove moved files", "err", err)
	}

	saved.MovedFrom = ""
	if err := a.session.saveSelection(hash, saved); err != nil {
		log.Warn("save session", "err", err)
	}

	job.update(func(state *moveState) { state.State = "done" })
	log.Info("torrent move finished", "bytes", total)
}

// Раздача снова в клиенте в своём каталоге, с выбором и паузой, как была.
// `complete` — куски, скачанные до того, как раздачу убрали из клиента
func (a *api) reopen(mi *metainfo.MetaInfo, dir string, saved savedTorrent, complete []int) error {
	t, err := a.addIn(mi, dir)
	if err != nil {
		return err
	}

	<-t.GotInfo()
	a.verifyHoles(t)

	var lost []*torrent.Piece
	for _, index := range complete {
		if piece := t.Piece(index); !piece.State().Complete {
			lost = append(lost, piece)
		}
	}
	if len(lost) > 0 {
		a.verifyPieces(t, lost)
	}

	if saved.Paused {
		a.setPaused(t, true, saved.Selected)
		return nil
	}

	return setFiles(t, saved.Selected)
}

type movePair struct {
	// Путь файла относительно каталога раздачи
	rel      string
	src, dst string
}

// Пары «исходник → цель» файлов раздачи; пути из чужого `.torrent` не выходят
// за каталоги
func movePairs(info *metainfo.Info, from, to string) ([]movePair, error) {
	var pairs []movePair

	for _, file := range info.UpvertedFiles() {
		rel := filePathOf(storage.FilePathMakerOpts{Info: info, File: &file})
		src := filepath.Join(from, rel)
		dst := filepath.Join(to, rel)

		if !isInside(from, src) || !isInside(to, dst) {
			return nil, fmt.Errorf("file %q is outside the downloads directory", rel)
		}

		pairs = append(pairs, movePair{rel: rel, src: src, dst: dst})
	}

	return pairs, nil
}

func isRegular(path string) bool {
	stat, err := os.Lstat(path)

	return err == nil && stat.Mode().IsRegular()
}

// Сколько данных лежит в файлах раздачи без дыр разреженных файлов
func dataBytes(info *metainfo.Info, from string) (int64, error) {
	pairs, err := movePairs(info, from, from)
	if err != nil {
		return 0, err
	}

	var total int64

	for _, pair := range pairs {
		total += dataSize(pair.src)
	}

	return total, nil
}

func dataSize(path string) int64 {
	stat, err := os.Lstat(path)
	if err != nil || !stat.Mode().IsRegular() {
		return 0
	}

	size := stat.Size()
	holes, _ := fileHoles(path)

	for _, hole := range holes {
		size -= hole.end - hole.start
	}

	return size
}

// Файлы, которые ставит текущий перенос (`Placed` в сессии)
type placedFiles struct {
	owned func(rel string) bool
	claim func(rel string) error
}

// Ставит каждый скачанный файл в новый каталог, не трогая исходник: в том же
// томе — хардлинком, иначе копией одних данных. Своя цель от прошлой попытки
// заменяется: исходник с тех пор мог докачаться
func placeFiles(info *metainfo.Info, from, to string, placed placedFiles, progress func(int64)) error {
	pairs, err := movePairs(info, from, to)
	if err != nil {
		return err
	}

	for _, pair := range pairs {
		if !isRegular(pair.src) {
			continue
		}

		if err := placeFile(pair, placed, progress); err != nil {
			return err
		}
	}

	return nil
}

func placeFile(pair movePair, placed placedFiles, progress func(int64)) error {
	src, dst := pair.src, pair.dst

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}

	existing, err := os.Lstat(dst)

	switch {
	case err == nil:
		// Уже хардлинк исходника: ставить нечего
		if source, err := os.Stat(src); err == nil && os.SameFile(source, existing) {
			progress(dataSize(src))
			return nil
		}

		if !placed.owned(pair.rel) {
			return errFileExists
		}
	case !errors.Is(err, fs.ErrNotExist):
		return err
	case !placed.owned(pair.rel):
		if err := placed.claim(pair.rel); err != nil {
			return err
		}
	}

	temp := dst + moveSuffix
	_ = os.Remove(temp)

	if err := linkFile(src, temp); err == nil {
		progress(dataSize(src))
	} else if err := copySparse(src, temp, progress); err != nil {
		_ = os.Remove(temp)
		return err
	}

	if err := os.Rename(temp, dst); err != nil {
		_ = os.Remove(temp)
		return err
	}

	return nil
}

// Копия одних областей с данными: окно просмотра в файле кэша занимает
// мегабайты, а размер файла — гигабайты. Без `SEEK_DATA` копируется всё
func copySparse(src, dst string, progress func(int64)) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	stat, err := in.Stat()
	if err != nil {
		return err
	}

	size := stat.Size()
	holes, _ := fileHoles(src)

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, stat.Mode().Perm())
	if err != nil {
		return err
	}

	if err := copyExtents(in, out, size, holes, progress); err != nil {
		_ = out.Close()
		return err
	}

	if err := out.Sync(); err != nil {
		_ = out.Close()
		return err
	}

	if err := out.Close(); err != nil {
		return err
	}

	copied, err := os.Stat(dst)
	if err != nil {
		return err
	}

	if copied.Size() != size {
		return fmt.Errorf("copy size mismatch: %d of %d bytes", copied.Size(), size)
	}

	return nil
}

func copyExtents(in, out *os.File, size int64, holes []extent, progress func(int64)) error {
	// Полный размер сразу: дыры остаются дырами, хвост без данных — тоже
	if err := out.Truncate(size); err != nil {
		return err
	}

	buf := make([]byte, 1<<20)
	offset := int64(0)

	copyRange := func(start, end int64) error {
		if end <= start {
			return nil
		}

		writer := &progressWriter{w: io.NewOffsetWriter(out, start), progress: progress}
		_, err := io.CopyBuffer(writer, io.NewSectionReader(in, start, end-start), buf)

		return err
	}

	for _, hole := range holes {
		if err := copyRange(offset, hole.start); err != nil {
			return err
		}
		offset = hole.end
	}

	return copyRange(offset, size)
}

type progressWriter struct {
	w        io.Writer
	progress func(int64)
}

func (p *progressWriter) Write(b []byte) (int, error) {
	n, err := p.w.Write(b)
	p.progress(int64(n))

	return n, err
}

// Убирает из нового каталога то, что поставила прерванная попытка: временные
// файлы и файлы из `placed`. Остальное под теми же именами — чужое
func removePlaced(info *metainfo.Info, from, to string, placed []string) {
	pairs, err := movePairs(info, from, to)
	if err != nil {
		return
	}

	dirs := map[string]bool{}

	for _, pair := range pairs {
		_ = os.Remove(pair.dst + moveSuffix)

		if slices.Contains(placed, pair.rel) && isRegular(pair.dst) {
			_ = os.Remove(pair.dst)
		}

		addParentDirs(dirs, to, pair.dst)
	}

	_ = removeEmptyDirs(dirs)
}

// Удаляет исходники, у которых есть файл в новом каталоге, и опустевшие
// каталоги раздачи в старом
func removeSources(info *metainfo.Info, from, to string) error {
	pairs, err := movePairs(info, from, to)
	if err != nil {
		return err
	}

	var errs []error
	dirs := map[string]bool{}

	for _, pair := range pairs {
		src, dst := pair.src, pair.dst

		if isRegular(src) && isRegular(dst) {
			if err := os.Remove(src); err != nil && !errors.Is(err, fs.ErrNotExist) {
				errs = append(errs, err)
			}
		}

		addParentDirs(dirs, from, src)
	}

	errs = append(errs, removeEmptyDirs(dirs))

	return errors.Join(errs...)
}

// Доводит перенос, прерванный перезапуском: до переключения каталога
// поставленное в новом убирается, после — удаляются исходники в старом
func (a *api) finishMove(hash metainfo.Hash, info *metainfo.Info, dir string, saved *savedTorrent) {
	if saved.MovingTo == "" && saved.MovedFrom == "" {
		return
	}

	if saved.MovingTo != "" && !samePath(saved.MovingTo, dir) {
		removePlaced(info, dir, saved.MovingTo, saved.Placed)
	}

	if saved.MovedFrom != "" && !samePath(saved.MovedFrom, dir) {
		if err := removeSources(info, saved.MovedFrom, dir); err != nil {
			a.logger.Warn("remove moved files", "hash", hash.HexString(), "err", err)
		}
	}

	saved.MovingTo = ""
	saved.MovedFrom = ""
	saved.Placed = nil

	if err := a.session.saveSelection(hash, *saved); err != nil {
		a.logger.Warn("save session", "hash", hash.HexString(), "err", err)
	}
}
