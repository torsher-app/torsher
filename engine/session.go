package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/anacrolix/torrent/metainfo"
)

// Раздачи переживают перезапуск: рядом с состоянием кусков лежат `.torrent`
// и выбор файлов каждой добавленной раздачи
type session struct {
	dir string
}

type savedTorrent struct {
	Selected []int `json:"selected"`
	// Выбранные файлы уже докачиваются целиком (просмотр начинался или
	// скачивание попросили сразу)
	Background bool `json:"background"`
	// Пауза владельца или сервера: раздача не качает и не раздаёт
	Paused bool `json:"paused"`
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

func (s *session) save(meta *metainfo.MetaInfo, saved savedTorrent) error {
	var buf bytes.Buffer

	if err := meta.Write(&buf); err != nil {
		return err
	}

	hash := meta.HashInfoBytes()

	if err := writeFileAtomic(s.path(hash, ".torrent"), buf.Bytes()); err != nil {
		return err
	}

	return s.saveSelection(hash, saved)
}

func (s *session) saveSelection(hash metainfo.Hash, saved savedTorrent) error {
	data, err := json.Marshal(saved)
	if err != nil {
		return err
	}

	return writeFileAtomic(s.path(hash, ".json"), data)
}

// Сохранённое состояние раздачи; нет записи — пустое
func (s *session) get(hash metainfo.Hash) savedTorrent {
	var saved savedTorrent

	if data, err := os.ReadFile(s.path(hash, ".json")); err == nil {
		_ = json.Unmarshal(data, &saved)
	}

	return saved
}

// Меняет одно поле состояния, не затирая остальные
func (s *session) update(hash metainfo.Hash, change func(*savedTorrent)) error {
	saved := s.get(hash)
	change(&saved)

	return s.saveSelection(hash, saved)
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
