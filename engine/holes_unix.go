//go:build unix

package main

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// Дыры разреженного файла — диапазоны, куда ничего не записывали. На
// файловой системе без `SEEK_HOLE` весь файл — данные, дыр нет
func fileHoles(path string) ([]extent, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		return nil, err
	}

	size := stat.Size()
	fd := int(f.Fd())
	var holes []extent

	for offset := int64(0); offset < size; {
		data, err := unix.Seek(fd, offset, unix.SEEK_DATA)
		if errors.Is(err, unix.ENXIO) {
			// Дальше данных нет: хвост файла — дыра
			holes = append(holes, extent{offset, size})
			break
		}
		if err != nil {
			return nil, nil
		}

		if data > offset {
			holes = append(holes, extent{offset, data})
		}

		next, err := unix.Seek(fd, data, unix.SEEK_HOLE)
		if err != nil {
			return nil, nil
		}

		offset = next
	}

	return holes, nil
}
