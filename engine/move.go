package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// Временное имя файла в новом каталоге: под итоговым именем файл появляется
// только целиком
const moveSuffix = ".torsher-move"

// Подмена в тестах: `EXDEV` на любой ФС
var linkFile = os.Link

func samePath(a, b string) bool {
	return filepath.Clean(a) == filepath.Clean(b)
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

	var body struct {
		Dir string `json:"dir"`
	}

	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil || !filepath.IsAbs(body.Dir) {
		writeError(w, http.StatusBadRequest, "invalid_dir", errors.New("dir must be an absolute path"))
		return
	}

	hash := t.InfoHash()
	from := a.dirOf(hash)
	to := filepath.Clean(body.Dir)
	job := &moveJob{state: moveState{Dir: to, State: "running"}}

	if samePath(from, to) {
		job.state.State = "done"
		a.movesMu.Lock()
		a.moves[hash] = job
		a.movesMu.Unlock()
		writeJSON(w, http.StatusOK, job.snapshot())
		return
	}

	// `.torrent` из сессии, а не `t.Metainfo()`: собранный клиентом заново он
	// не открывается обратно (`no piece root set`)
	mi, err := metainfo.LoadFromFile(a.session.path(hash, ".torrent"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage", err)
		return
	}

	info := t.Info()
	saved := a.session.get(hash)

	// Отметка до первого файла: перезапуск посреди переноса уберёт
	// недоделанное в новом каталоге (`finishMove`)
	saved.MovingTo = to
	if err := a.session.saveSelection(hash, saved); err != nil {
		writeError(w, http.StatusInternalServerError, "storage", err)
		return
	}

	a.movesMu.Lock()
	a.moves[hash] = job
	a.movesMu.Unlock()

	t.Drop()
	a.windows.forget(hash)

	go a.runMove(job, mi, info, from, to, saved)

	writeJSON(w, http.StatusAccepted, job.snapshot())
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
func (a *api) runMove(job *moveJob, mi *metainfo.MetaInfo, info *metainfo.Info, from, to string, saved savedTorrent) {
	hash := mi.HashInfoBytes()
	log := a.logger.With("hash", hash.HexString())
	log.Info("torrent move started")

	fail := func(err error) {
		saved.MovingTo = ""
		if err := a.session.saveSelection(hash, saved); err != nil {
			log.Warn("save session", "err", err)
		}

		if err := a.reopen(mi, from, saved); err != nil {
			log.Warn("reopen torrent", "err", err)
		}

		job.update(func(state *moveState) {
			state.State = "failed"
			state.Error = err.Error()
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

	if err := placeFiles(info, from, to, progress); err != nil {
		removePlaced(info, from, to)
		fail(err)
		return
	}

	saved.Dir = a.sessionDir(to)
	saved.MovingTo = ""
	saved.MovedFrom = from

	if err := a.session.saveSelection(hash, saved); err != nil {
		removePlaced(info, from, to)
		fail(err)
		return
	}

	if err := a.reopen(mi, to, saved); err != nil {
		log.Warn("reopen torrent", "err", err)
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

// Раздача снова в клиенте в своём каталоге, с выбором и паузой, как была
func (a *api) reopen(mi *metainfo.MetaInfo, dir string, saved savedTorrent) error {
	t, err := a.addIn(mi, dir)
	if err != nil {
		return err
	}

	<-t.GotInfo()
	a.verifyHoles(t)

	if saved.Paused {
		a.setPaused(t, true, saved.Selected)
		return nil
	}

	return setFiles(t, saved.Selected)
}

// Пары «исходник → цель» файлов раздачи; пути из чужого `.torrent` не выходят
// за каталоги
func movePairs(info *metainfo.Info, from, to string) ([][2]string, error) {
	var pairs [][2]string

	for _, file := range info.UpvertedFiles() {
		rel := filePathOf(storage.FilePathMakerOpts{Info: info, File: &file})
		src := filepath.Join(from, rel)
		dst := filepath.Join(to, rel)

		if !isInside(from, src) || !isInside(to, dst) {
			return nil, fmt.Errorf("file %q is outside the downloads directory", rel)
		}

		pairs = append(pairs, [2]string{src, dst})
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
		total += dataSize(pair[0])
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

// Ставит каждый скачанный файл в новый каталог, не трогая исходник: в том же
// томе — хардлинком, иначе копией одних данных. Цель от прошлой попытки
// заменяется: исходник с тех пор мог докачаться
func placeFiles(info *metainfo.Info, from, to string, progress func(int64)) error {
	pairs, err := movePairs(info, from, to)
	if err != nil {
		return err
	}

	for _, pair := range pairs {
		src, dst := pair[0], pair[1]

		if !isRegular(src) {
			continue
		}

		if err := placeFile(src, dst, progress); err != nil {
			return err
		}
	}

	return nil
}

func placeFile(src, dst string, progress func(int64)) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
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

	// Цель уже была хардлинком исходника: `rename` между ссылками на один
	// файл ничего не делает, и временное имя остаётся
	_ = os.Remove(temp)

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

// Убирает из нового каталога то, что поставила прерванная попытка
func removePlaced(info *metainfo.Info, from, to string) {
	pairs, err := movePairs(info, from, to)
	if err != nil {
		return
	}

	dirs := map[string]bool{}

	for _, pair := range pairs {
		_ = os.Remove(pair[1] + moveSuffix)

		if isRegular(pair[1]) {
			_ = os.Remove(pair[1])
		}

		addParentDirs(dirs, to, pair[1])
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
		src, dst := pair[0], pair[1]

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
		removePlaced(info, dir, saved.MovingTo)
	}

	if saved.MovedFrom != "" && !samePath(saved.MovedFrom, dir) {
		if err := removeSources(info, saved.MovedFrom, dir); err != nil {
			a.logger.Warn("remove moved files", "hash", hash.HexString(), "err", err)
		}
	}

	saved.MovingTo = ""
	saved.MovedFrom = ""

	if err := a.session.saveSelection(hash, *saved); err != nil {
		a.logger.Warn("save session", "hash", hash.HexString(), "err", err)
	}
}
