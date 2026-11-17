package main

import (
	"fmt"
	"net/http"
	"path/filepath"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

type deletePreviewResponse struct {
	ReclaimableBytes int64 `json:"reclaimableBytes"`
}

// Те же имена, что удаляет deleteTorrentFiles, включая старые .part.
func torrentDeletionPaths(downloads string, info *metainfo.Info) ([]string, error) {
	base, err := filepath.Abs(downloads)
	if err != nil {
		return nil, err
	}
	paths := []string{}
	seen := map[string]bool{}
	for _, file := range info.UpvertedFiles() {
		path := filepath.Join(base, filePathOf(storage.FilePathMakerOpts{Info: info, File: &file}))
		if !isInside(base, path) {
			return nil, fmt.Errorf("file is outside the downloads directory")
		}
		for _, candidate := range []string{path, path + partFileSuffix} {
			if !seen[candidate] {
				paths = append(paths, candidate)
				seen[candidate] = true
			}
		}
	}
	return paths, nil
}

func (a *api) deletePreview(w http.ResponseWriter, r *http.Request) {
	var hash metainfo.Hash
	if err := hash.FromHexString(r.PathValue("hash")); err != nil {
		writeError(w, 400, "invalid_hash", err)
		return
	}
	unlock, acquired := a.ownership.tryOperation(hash)
	if !acquired {
		writeMoving(w)
		return
	}
	defer unlock()
	if a.ownership.blocked(hash) {
		writeError(w, 409, "storage_path_conflict", errStorageConflict)
		return
	}
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}
	paths, err := torrentDeletionPaths(a.dirOf(hash), t.Info())
	if err != nil {
		writeError(w, 500, "storage", err)
		return
	}
	bytes, err := reclaimableFileBytes(paths)
	if err != nil {
		writeError(w, 500, "storage", err)
		return
	}
	writeJSON(w, 200, deletePreviewResponse{ReclaimableBytes: bytes})
}
