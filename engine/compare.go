package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"io"
	"os"
	"path/filepath"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// Что лежит на диске под путём файла раздачи
const (
	diskMatch   = "match"   // куски внутри файла сошлись по хэшу
	diskDiffers = "differs" // другой размер или кусок не сошёлся
	diskMissing = "missing" // файла нет
	diskUnknown = "unknown" // проверить нечем: нет кусков целиком внутри файла или хэшей v1
)

// Сверка файлов раздачи с файлами в каталоге `dir`, куда её добавят, — до
// добавления, только чтением. Нужна при замене раздачи новой версией: свои
// куски anacrolix при добавлении проверит и сам, но не сошедшийся файл он
// перепишет на месте, а файл загрузок бывает хардлинком файла библиотеки.
// Сервер по ответу убирает из каталога загрузок отличающиеся файлы, и новая
// версия ложится в новый inode.
//
// Сверяются только куски, лежащие целиком внутри файла: кусок на стыке зависит
// и от соседа. Файл, в котором таких кусков нет, — `unknown`
func compareOnDisk(ctx context.Context, info *metainfo.Info, dir string) []string {
	files := info.UpvertedFiles()
	states := make([]string, len(files))
	total := info.TotalLength()
	hashesOk := len(info.Pieces) == sha1.Size*info.NumPieces()
	buf := make([]byte, info.PieceLength)
	var offset int64

	for i := range files {
		file := &files[i]
		start := offset
		offset += file.Length

		path := filepath.Join(dir, filePathOf(storage.FilePathMakerOpts{Info: info, File: file}))
		if !isInside(dir, path) {
			states[i] = diskUnknown
			continue
		}

		stat, err := os.Stat(path)
		switch {
		case err != nil:
			states[i] = diskMissing
			continue
		case !stat.Mode().IsRegular() || stat.Size() != file.Length:
			states[i] = diskDiffers
			continue
		case !hashesOk:
			states[i] = diskUnknown
			continue
		}

		states[i] = compareFile(ctx, info, path, start, file.Length, total, buf)
	}

	return states
}

func compareFile(ctx context.Context, info *metainfo.Info, path string, start, length, total int64, buf []byte) string {
	f, err := os.Open(path)
	if err != nil {
		return diskMissing
	}
	defer f.Close()

	first := (start + info.PieceLength - 1) / info.PieceLength
	checked := 0

	for piece := first; ; piece++ {
		pieceStart := piece * info.PieceLength
		pieceEnd := min(pieceStart+info.PieceLength, total)

		if pieceStart >= start+length || pieceEnd > start+length {
			break
		}
		if ctx.Err() != nil {
			return diskUnknown
		}

		chunk := buf[:pieceEnd-pieceStart]
		if _, err := f.ReadAt(chunk, pieceStart-start); err != nil && err != io.EOF {
			return diskUnknown
		}

		sum := sha1.Sum(chunk)
		if !bytes.Equal(sum[:], info.Pieces[piece*sha1.Size:(piece+1)*sha1.Size]) {
			return diskDiffers
		}
		checked++
	}

	if checked == 0 {
		return diskUnknown
	}

	return diskMatch
}
