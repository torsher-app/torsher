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
	// После cancel пути остаются привязаны к исходным объектам и при restart.
	GuardedPaths       []maintenancePath `json:"guardedPaths,omitempty"`
	GuardedOperationID string            `json:"guardedOperationId,omitempty"`
	// Файлы, которые качаются целиком, в порядке закачки
	Selected []int `json:"selected"`
	// Файлы выбора, которые владелец поднял вперёд порядка
	First []int `json:"first,omitempty"`
	// Файлы низкого приоритета: после среднего уровня
	Low []int `json:"low,omitempty"`
	// Пауза владельца или сервера: раздача не качает и не раздаёт
	Paused             bool   `json:"paused"`
	Private            bool   `json:"private,omitempty"`
	AwaitingAdmission  bool   `json:"awaitingAdmission,omitempty"`
	StartAnnounceState string `json:"startAnnounceState,omitempty"`
	LeftZeroAccepted   bool   `json:"leftZeroAccepted,omitempty"`
	SeededSeconds      int64  `json:"seededSeconds,omitempty"`
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

func (s savedTorrent) paused() bool { return s.Paused || s.AwaitingAdmission }

type restoredTorrent struct {
	meta    *metainfo.MetaInfo
	saved   savedTorrent
	blocked bool // missing or unrecognised session state
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
	s.mu.Lock()
	defer s.mu.Unlock()

	current, err := s.forMutation(hash)
	if err != nil {
		return err
	}
	saved := current
	change(&saved)
	saved.Private = saved.Private || current.Private
	if saved.Private {
		// Do not publish metainfo with a private override before the durable
		// privacy marker. Its info dictionary may look like a public torrent.
		if err := s.write(hash, saved, current); err != nil {
			return err
		}
		return durableFile(s.path(hash, ".torrent"), buf.Bytes())
	}
	if err := writeFileAtomic(s.path(hash, ".torrent"), buf.Bytes()); err != nil {
		return err
	}
	return s.write(hash, saved, current)
}

func (s *session) saveSelection(hash metainfo.Hash, saved savedTorrent) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, err := s.forMutation(hash)
	if err != nil {
		return err
	}
	saved.Private = saved.Private || current.Private
	saved.StartAnnounceState = current.StartAnnounceState
	saved.LeftZeroAccepted = current.LeftZeroAccepted
	saved.SeededSeconds = current.SeededSeconds
	return s.write(hash, saved, current)
}

// Отданное только растёт: копия состояния, прочитанная до фоновой записи
// отданного, его не уменьшит
func (s *session) write(hash metainfo.Hash, saved, current savedTorrent) error {
	saved.Uploaded = max(saved.Uploaded, current.Uploaded)
	if saved.Private || current.Private {
		saved.Private = true
		return durableJSON(s.path(hash, ".json"), saved)
	}

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
	var state struct {
		savedTorrent
		Paused *bool `json:"paused"`
	}
	data, err := os.ReadFile(s.path(hash, ".json"))
	if err != nil || json.Unmarshal(data, &state) != nil || state.Paused == nil {
		return savedTorrent{}, false
	}
	state.savedTorrent.Paused = *state.Paused
	return state.savedTorrent, true
}

var errTorrentSessionUnavailable = errors.New("missing or invalid torrent session")

// Вызывается под session.mu. Отсутствие .torrent допускает создание сессии.
// У существующей раздачи пустой снимок мог бы снять признак приватности.
func (s *session) forMutation(hash metainfo.Hash) (savedTorrent, error) {
	saved, valid := s.lookup(hash)
	if valid {
		return saved, nil
	}
	if _, err := os.Stat(s.path(hash, ".torrent")); errors.Is(err, os.ErrNotExist) {
		return savedTorrent{}, nil
	}
	return savedTorrent{}, errTorrentSessionUnavailable
}

// Меняет одно поле состояния, не затирая остальные
func (s *session) update(hash metainfo.Hash, change func(*savedTorrent)) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, err := s.forMutation(hash)
	if err != nil {
		return err
	}
	saved := current
	change(&saved)
	return s.write(hash, saved, current)
}

// Before network I/O the private session and its attempted marker must exist.
func (s *session) updateAnnouncement(hash metainfo.Hash, change func(*savedTorrent)) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, ok := s.lookup(hash)
	if !ok || !current.Private || !s.has(hash) {
		return errTorrentSessionUnavailable
	}
	saved := current
	change(&saved)
	return s.write(hash, saved, current)
}

// Раздача сохранена в сессии: её добавляли, а не только искали метаданные
func (s *session) has(hash metainfo.Hash) bool {
	_, err := os.Stat(s.path(hash, ".torrent"))

	return err == nil
}

func (s *session) remove(hash metainfo.Hash) error {
	s.mu.Lock()
	defer s.mu.Unlock()
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

		hash := meta.HashInfoBytes()
		saved, valid := s.lookup(hash)
		if !valid || base != hash.HexString() {
			errs = append(errs, errTorrentSessionUnavailable)
			restored = append(restored, restoredTorrent{meta: meta, blocked: true})
			continue
		}
		restored = append(restored, restoredTorrent{meta: meta, saved: saved})
	}

	return restored, errs
}
