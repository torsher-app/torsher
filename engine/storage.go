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

// Недокачанный файл хранилище держит рядом с суффиксом `.part` и
// переименовывает, когда все его куски скачаны
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
// раздачи. Возвращает, сколько байт освободилось. Файлы вне каталога
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

		for dir := filepath.Dir(path); isInside(base, dir); dir = filepath.Dir(dir) {
			dirs[dir] = true
		}
	}

	// Глубокие каталоги — первыми; непустой (в нём чужие файлы) остаётся
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

	return freed, errors.Join(errs...)
}

// Каталог с чужими файлами: Linux отвечает ENOTEMPTY, часть систем — EEXIST
func isNotEmpty(err error) bool {
	return errors.Is(err, syscall.ENOTEMPTY) || errors.Is(err, syscall.EEXIST)
}
