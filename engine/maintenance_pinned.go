package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// Только отмена обслуживания: все объекты открыты и проверены до AddTorrentSpec.
// Ни одно последующее IO не разрешает путь заново и не создаёт файлы.
type maintenancePinned struct {
	files      []maintenancePinnedFile
	completion storage.PieceCompletion
	hash       metainfo.Hash
}
type maintenancePinnedFile struct {
	file           *os.File
	offset, length int64
}

func openMaintenancePinned(info *metainfo.Info, hash metainfo.Hash, dir string, paths []maintenancePath, completion storage.PieceCompletion) (*maintenancePinned, error) {
	pinned := &maintenancePinned{completion: completion, hash: hash}
	owned := map[string]maintenancePath{}
	for _, item := range paths {
		owned[item.Path] = item
	}
	var offset int64
	for _, file := range info.UpvertedFiles() {
		if file.TorrentOffset < offset {
			pinned.Close()
			return nil, errors.New("restore_file_offsets_invalid")
		}
		if file.TorrentOffset > offset {
			pinned.files = append(pinned.files, maintenancePinnedFile{offset: offset, length: file.TorrentOffset - offset})
		}
		entry := maintenancePinnedFile{offset: file.TorrentOffset, length: file.Length}
		offset = file.TorrentOffset + file.Length
		if file.Length > 0 && !strings.Contains(file.Attr, "p") {
			path := canonicalMaintenancePath(filepath.Join(dir, filePathOf(storage.FilePathMakerOpts{Info: info, File: &file})))
			item, ok := owned[path]
			if !ok || item.Size != file.Length {
				pinned.Close()
				return nil, errors.New("restore_source_unknown")
			}
			var err error
			entry.file, err = openMaintenanceFile(item)
			if err != nil {
				pinned.Close()
				return nil, err
			}
		}
		pinned.files = append(pinned.files, entry)
	}
	return pinned, nil
}
func (s *maintenancePinned) Close() error {
	var failures []error
	for _, file := range s.files {
		if file.file != nil {
			failures = append(failures, file.file.Close())
		}
	}
	return errors.Join(failures...)
}
func (s *maintenancePinned) OpenTorrent(_ context.Context, _ *metainfo.Info, _ metainfo.Hash) (storage.TorrentImpl, error) {
	return storage.TorrentImpl{Piece: func(piece metainfo.Piece) storage.PieceImpl { return maintenancePinnedPiece{s: s, piece: piece} }, Close: s.Close}, nil
}

type maintenancePinnedPiece struct {
	s     *maintenancePinned
	piece metainfo.Piece
}

func (p maintenancePinnedPiece) transfer(buffer []byte, offset int64, write bool) (int, error) {
	if offset < 0 || offset > p.piece.Length() || int64(len(buffer)) > p.piece.Length()-offset {
		return 0, errors.New("piece_range_invalid")
	}
	if len(buffer) == 0 {
		return 0, nil
	}
	position := p.piece.Offset() + offset
	total := 0
	for _, file := range p.s.files {
		if position >= file.offset+file.length {
			continue
		}
		if position < file.offset {
			return total, io.ErrUnexpectedEOF
		}
		count := min(len(buffer), int(file.offset+file.length-position))
		chunk := buffer[:count]
		n := count
		var err error
		if file.file == nil {
			if !write {
				clear(chunk)
			}
		} else if write {
			n, err = file.file.WriteAt(chunk, position-file.offset)
		} else {
			n, err = file.file.ReadAt(chunk, position-file.offset)
		}
		total += n
		position += int64(n)
		buffer = buffer[n:]
		if err != nil {
			return total, err
		}
		if n != count {
			return total, io.ErrUnexpectedEOF
		}
		if len(buffer) == 0 {
			return total, nil
		}
	}
	return total, io.ErrUnexpectedEOF
}
func (p maintenancePinnedPiece) ReadAt(b []byte, off int64) (int, error) {
	return p.transfer(b, off, false)
}
func (p maintenancePinnedPiece) WriteAt(b []byte, off int64) (int, error) {
	return p.transfer(b, off, true)
}
func (p maintenancePinnedPiece) MarkComplete() error {
	for _, file := range p.s.files {
		if file.file != nil && file.offset < p.piece.Offset()+p.piece.Length() && file.offset+file.length > p.piece.Offset() {
			if err := file.file.Sync(); err != nil {
				return err
			}
		}
	}
	return p.s.completion.Set(metainfo.PieceKey{InfoHash: p.s.hash, Index: p.piece.Index()}, true)
}
func (p maintenancePinnedPiece) MarkNotComplete() error {
	return p.s.completion.Set(metainfo.PieceKey{InfoHash: p.s.hash, Index: p.piece.Index()}, false)
}
func (p maintenancePinnedPiece) Completion() storage.Completion {
	result, err := p.s.completion.Get(metainfo.PieceKey{InfoHash: p.s.hash, Index: p.piece.Index()})
	if err != nil {
		result.Err = err
	}
	return result
}
