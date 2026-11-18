package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// Так прежние версии движка называли недокачанный файл: такие файлы
// подхватываются (`adoptPartFiles`) и удаляются вместе с раздачей
const partFileSuffix = ".part"

// Путь файла раздачи от каталога загрузок: `<имя раздачи>/<путь>`, у раздачи
// из одного файла — её имя. Им же пользуется файловое хранилище, поэтому
// удаление находит ровно те файлы, что записала библиотека
func filePathOf(opts storage.FilePathMakerOpts) string {
	var parts []string

	if name := opts.Info.BestName(); name != metainfo.NoName {
		parts = append(parts, name)
	}

	return filepath.Join(append(parts, opts.File.BestPath()...)...)
}

func isInside(base, path string) bool {
	rel, err := filepath.Rel(base, path)

	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// Удаляет файлы раздачи (и недокачанные `.part`) и опустевшие каталоги
// раздачи. Возвращает логический размер удалённых файлов, не свободные блоки. Файлы вне каталога
// загрузок не трогает: путь из чужого `.torrent` не должен выйти наружу
func deleteTorrentFiles(downloads string, info *metainfo.Info) (int64, error) {
	base, err := filepath.Abs(downloads)
	if err != nil {
		return 0, err
	}

	var freed int64
	var errs []error
	dirs := map[string]bool{}

	for _, file := range info.UpvertedFiles() {
		path := filepath.Join(base, filePathOf(storage.FilePathMakerOpts{Info: info, File: &file}))

		if !isInside(base, path) {
			errs = append(errs, fmt.Errorf("file %q is outside the downloads directory", path))
			continue
		}

		for _, candidate := range []string{path, path + partFileSuffix} {
			stat, err := os.Lstat(candidate)
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			if err != nil {
				errs = append(errs, err)
				continue
			}
			if !stat.Mode().IsRegular() {
				continue
			}

			if err := os.Remove(candidate); err != nil {
				errs = append(errs, err)
				continue
			}

			freed += stat.Size()
		}

		addParentDirs(dirs, base, path)
	}

	errs = append(errs, removeEmptyDirs(dirs))

	return freed, errors.Join(errs...)
}

// Каталоги раздачи между файлом и каталогом загрузок
func addParentDirs(dirs map[string]bool, base, path string) {
	for dir := filepath.Dir(path); isInside(base, dir); dir = filepath.Dir(dir) {
		dirs[dir] = true
	}
}

// Глубокие каталоги — первыми; непустой (в нём чужие файлы) остаётся
func removeEmptyDirs(dirs map[string]bool) error {
	var errs []error

	for len(dirs) > 0 {
		deepest := ""
		for dir := range dirs {
			if len(dir) > len(deepest) {
				deepest = dir
			}
		}
		delete(dirs, deepest)

		if err := os.Remove(deepest); err != nil && !errors.Is(err, fs.ErrNotExist) && !isNotEmpty(err) {
			errs = append(errs, err)
		}
	}

	return errors.Join(errs...)
}

// Каталог с чужими файлами: Linux отвечает ENOTEMPTY, часть систем — EEXIST
func isNotEmpty(err error) bool {
	return errors.Is(err, syscall.ENOTEMPTY) || errors.Is(err, syscall.EEXIST)
}

// sameStorageEntry distinguishes aliases from independently removable hardlinks.
func sameStorageEntry(first, second string) bool {
	a, aErr := filepath.EvalSymlinks(first)
	b, bErr := filepath.EvalSymlinks(second)
	if aErr != nil || bErr != nil || a == b {
		return true
	}

	dir := filepath.Dir(a)
	left, leftErr := os.Stat(dir)
	right, rightErr := os.Stat(filepath.Dir(b))
	if leftErr != nil || rightErr != nil {
		return true
	}
	if !os.SameFile(left, right) {
		return false
	}
	aName, bName := filepath.Base(a), filepath.Base(b)
	if aName == bName {
		return true
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return true
	}
	var foundA, foundB bool
	for _, entry := range entries {
		foundA = foundA || entry.Name() == aName
		foundB = foundB || entry.Name() == bName
	}
	return !foundA || !foundB
}

// Недокачанные `.part` от прежних версий движка становятся файлами под
// итоговым именем, если такого ещё нет: скачанное не пропадает, а хранилище
// без `.part` их бы не увидело
func adoptPartFiles(downloads string, info *metainfo.Info) {
	base, err := filepath.Abs(downloads)
	if err != nil {
		return
	}

	files := info.UpvertedFiles()
	paths := make([]string, 0, len(files))
	own := make(map[string]bool, len(files))

	for _, file := range files {
		path := filepath.Join(base, filePathOf(storage.FilePathMakerOpts{Info: info, File: &file}))
		if !isInside(base, path) {
			continue
		}
		paths = append(paths, path)
		own[strings.ToLower(path)] = true
	}

	type metadataEntry struct {
		path string
		info os.FileInfo
	}
	var entries []metadataEntry
	for _, path := range paths {
		part := path + partFileSuffix
		// `X.part` сам файл раздачи: это не недокачанный `X`
		if own[strings.ToLower(part)] {
			continue
		}

		if _, err := os.Stat(path); !errors.Is(err, fs.ErrNotExist) {
			continue
		}

		partial, err := os.Lstat(part)
		if err != nil || !partial.Mode().IsRegular() {
			continue
		}
		if entries == nil {
			entries = make([]metadataEntry, 0, len(paths))
			for _, name := range paths {
				if info, err := os.Stat(name); err == nil {
					entries = append(entries, metadataEntry{name, info})
				} else if !errors.Is(err, fs.ErrNotExist) {
					// An unknown owner cannot authorize adopting this candidate.
					return
				}
			}
		}
		owned := false
		for _, entry := range entries {
			if os.SameFile(partial, entry.info) && sameStorageEntry(part, entry.path) {
				owned = true
				break
			}
		}
		if !owned && os.Rename(part, path) == nil {
			entries = append(entries, metadataEntry{path, partial})
		}
	}
}
