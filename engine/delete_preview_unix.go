//go:build linux || darwin

package main

import (
	"errors"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// Оценка allocated blocks, а не размера файла или проверенных кусков.
// Открытые дескрипторы, reflink и snapshots могут задержать освобождение.
func reclaimableFileBytes(paths []string) (int64, error) {
	type identity struct{ dev, ino uint64 }
	type allocation struct{ names, links, bytes int64 }
	files := map[identity]allocation{}
	seen := map[string]bool{}
	for _, path := range paths {
		path = filepath.Clean(path)
		parent, err := filepath.EvalSymlinks(filepath.Dir(path))
		if errors.Is(err, unix.ENOENT) {
			continue
		}
		if err != nil {
			return 0, err
		}
		path = filepath.Join(parent, filepath.Base(path))
		if seen[path] {
			continue
		}
		seen[path] = true
		var stat unix.Stat_t
		err = unix.Lstat(path, &stat)
		if errors.Is(err, unix.ENOENT) {
			continue
		}
		if err != nil {
			return 0, err
		}
		if stat.Mode&unix.S_IFMT != unix.S_IFREG {
			continue
		}
		key := identity{uint64(stat.Dev), stat.Ino}
		item := files[key]
		item.names++
		item.links = int64(stat.Nlink)
		item.bytes = max(0, stat.Blocks*512)
		files[key] = item
	}
	var total int64
	for _, item := range files {
		if item.names == item.links {
			total += item.bytes
		}
	}
	return total, nil
}
