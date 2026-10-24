package main

import (
	"path/filepath"
	"runtime"
	"sync"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/storage"
)

// Диапазон байт файла: [start, end)
type extent struct {
	start, end int64
}

// Куски «скачано» без данных. Файловое хранилище при открытии раздачи ставит
// отметку всем кускам файла, который лежит под итоговым именем и полного
// размера, не проверяя хэши, а запись через mmap сразу растягивает файл до
// полного размера. Разреженный файл с такими отметками поток отдавал бы
// нулями. Поэтому куски, которые попадают на дыры в файлах раздачи и помечены
// скачанными, перепроверяются по хэшу: несовпадение библиотека снимет сама.
// Возвращает, сколько кусков перепроверено.
func (a *api) verifyHoles(t *torrent.Torrent) int {
	info := t.Info()
	if info == nil {
		return 0
	}

	suspects := map[int]bool{}
	var offset int64

	for _, file := range info.UpvertedFiles() {
		path := filepath.Join(a.dirOf(t.InfoHash()), filePathOf(storage.FilePathMakerOpts{Info: info, File: &file}))

		for _, candidate := range []string{path, path + partFileSuffix} {
			holes, err := fileHoles(candidate)
			if err != nil {
				continue
			}

			for _, hole := range holes {
				end := min(hole.end, file.Length)
				if hole.start >= end {
					continue
				}

				first := (offset + hole.start) / info.PieceLength
				last := (offset + end - 1) / info.PieceLength

				for piece := first; piece <= last; piece++ {
					suspects[int(piece)] = true
				}
			}

			break
		}

		offset += file.Length
	}

	var pieces []*torrent.Piece

	for index := range suspects {
		if piece := t.Piece(index); piece.State().Complete {
			pieces = append(pieces, piece)
		}
	}

	if len(pieces) == 0 {
		return 0
	}

	a.verifyPieces(t, pieces)

	a.logger.Warn("pieces marked complete over file holes were rechecked",
		"hash", t.InfoHash().HexString(), "pieces", len(pieces))

	return len(pieces)
}

// Перепроверка кусков по хэшу; проверка кусков независима — параллельно по
// числу ядер
func (a *api) verifyPieces(t *torrent.Torrent, pieces []*torrent.Piece) {
	queue := make(chan *torrent.Piece)
	var wg sync.WaitGroup

	for range runtime.NumCPU() {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for piece := range queue {
				if err := piece.VerifyData(); err != nil {
					a.logger.Warn("verify piece", "hash", t.InfoHash().HexString(), "err", err)
				}
			}
		}()
	}

	for _, piece := range pieces {
		queue <- piece
	}
	close(queue)
	wg.Wait()
}
