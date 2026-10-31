package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/anacrolix/torrent/metainfo"
)

// Раздачи переживают перезапуск: рядом с состоянием кусков лежат `.torrent`
// и выбор файлов каждой добавленной раздачи
type session struct {
	dir string
	// Запись идёт из обработчиков и из фона (отданное за всё время): чтение
	// и запись одной раздачи не должны перемежаться
	mu sync.Mutex
}

type savedTorrent struct {
	// Файлы, которые качаются целиком, в порядке закачки
	Selected []int `json:"selected"`
	// Файлы выбора, которые владелец поднял вперёд порядка
	First []int `json:"first,omitempty"`
	// Файлы низкого приоритета: после среднего уровня
	Low []int `json:"low,omitempty"`
	// Пауза владельца или сервера: раздача не качает и не раздаёт
	Paused bool `json:"paused"`
	// Каталог файлов раздачи; пусто — каталог загрузок по умолчанию
	Dir string `json:"dir,omitempty"`
	// Перенос в другой каталог: `MovingTo` — файлы ставятся в новый каталог,
	// раздача ещё живёт в старом; `MovedFrom` — раздача уже в новом, в старом
	// остались исходники. По ним `restore` доводит прерванный перенос
	MovingTo  string `json:"movingTo,omitempty"`
	MovedFrom string `json:"movedFrom,omitempty"`
	// Пути относительно каталога раздачи, которые ставит текущий перенос.
	// Пишутся до появления файла: откат удаляет в новом каталоге только их
	Placed []string `json:"placed,omitempty"`
	// Когда выбор стал непустым (unix мс): порядок очереди закачки. У записей
	// прежних версий нет — они встают в начало очереди
	QueuedAt int64 `json:"queuedAt,omitempty"`
	// Раздавать, когда раздаче уже ничего не нужно; nil — да
	Seed *bool `json:"seed,omitempty"`
	// Отдано пирам за всё время, байт; пишется раз в минуту и при остановке
	Uploaded int64 `json:"uploaded,omitempty"`
	// Только у записей прежних версий: `false` — выбор сделал просмотр и он
	// ещё не докачивался. `restore` переводит запись в новый вид
	Background *bool `json:"background,omitempty"`
}

type restoredTorrent struct {
	meta  *metainfo.MetaInfo
	saved savedTorrent
}

func newSession(dir string) (*session, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}

	return &session{dir: dir}, nil
}

func (s *session) path(hash metainfo.Hash, ext string) string {
	return filepath.Join(s.dir, hash.HexString()+ext)
}

// Запись через временный файл: обрыв посреди записи не оставит битый файл
func writeFileAtomic(path string, data []byte) error {
	tmp := path + ".tmp"

	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}

	return os.Rename(tmp, path)
}

// Пишет `.torrent` и меняет состояние раздачи, не затирая остальные поля
func (s *session) save(meta *metainfo.MetaInfo, change func(*savedTorrent)) error {
	var buf bytes.Buffer

	if err := meta.Write(&buf); err != nil {
		return err
	}

	hash := meta.HashInfoBytes()

	if err := writeFileAtomic(s.path(hash, ".torrent"), buf.Bytes()); err != nil {
		return err
	}

	return s.update(hash, change)
}

func (s *session) saveSelection(hash metainfo.Hash, saved savedTorrent) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.write(hash, saved)
}

// Отданное только растёт: копия состояния, прочитанная до фоновой записи
// отданного, его не уменьшит
func (s *session) write(hash metainfo.Hash, saved savedTorrent) error {
	saved.Uploaded = max(saved.Uploaded, s.get(hash).Uploaded)

	data, err := json.Marshal(saved)
	if err != nil {
		return err
	}

	return writeFileAtomic(s.path(hash, ".json"), data)
}

// Сохранённое состояние раздачи; нет записи — пустое
func (s *session) get(hash metainfo.Hash) savedTorrent {
	saved, _ := s.lookup(hash)

	return saved
}

// Состояние раздачи и есть ли оно: раздача, у которой только искали
// метаданные, в сессии не записана
func (s *session) lookup(hash metainfo.Hash) (savedTorrent, bool) {
	var saved savedTorrent

	data, err := os.ReadFile(s.path(hash, ".json"))
	if err != nil {
		return saved, false
	}

	_ = json.Unmarshal(data, &saved)

	return saved, true
}

// Меняет одно поле состояния, не затирая остальные
func (s *session) update(hash metainfo.Hash, change func(*savedTorrent)) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	saved := s.get(hash)
	change(&saved)

	return s.write(hash, saved)
}

// Раздача сохранена в сессии: её добавляли, а не только искали метаданные
func (s *session) has(hash metainfo.Hash) bool {
	_, err := os.Stat(s.path(hash, ".torrent"))

	return err == nil
}

func (s *session) remove(hash metainfo.Hash) error {
	return errors.Join(
		removeIfExists(s.path(hash, ".torrent")),
		removeIfExists(s.path(hash, ".json")),
	)
}

func removeIfExists(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	return nil
}

// Битые записи пропускаются: одна испорченная раздача не мешает остальным
func (s *session) load() ([]restoredTorrent, []error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, []error{err}
	}

	var restored []restoredTorrent
	var errs []error

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".torrent" {
			continue
		}

		base := strings.TrimSuffix(entry.Name(), ".torrent")
		meta, err := metainfo.LoadFromFile(filepath.Join(s.dir, entry.Name()))
		if err != nil {
			errs = append(errs, err)
			continue
		}

		var saved savedTorrent
		if data, err := os.ReadFile(filepath.Join(s.dir, base+".json")); err == nil {
			if err := json.Unmarshal(data, &saved); err != nil {
				errs = append(errs, err)
			}
		}

		restored = append(restored, restoredTorrent{meta: meta, saved: saved})
	}

	return restored, errs
}
