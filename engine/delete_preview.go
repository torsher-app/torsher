package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

type maintenanceSourceFiles struct {
	Root       string   `json:"root"`
	Paths      []string `json:"paths"`
	PieceCount int      `json:"pieceCount"`
	Private    bool     `json:"private"`
}

func (a *api) maintenanceStoredTorrentFiles(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Root string `json:"root"`
		Hash string `json:"hash"`
		Meta []byte `json:"meta"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2*maxTorrentFileBytes)).Decode(&request); err != nil || !filepath.IsAbs(request.Root) || filepath.Clean(request.Root) != request.Root {
		writeError(w, 400, "invalid_manifest", fmt.Errorf("invalid torrent source"))
		return
	}
	meta, err := metainfo.Load(bytes.NewReader(request.Meta))
	if err != nil || meta.HashInfoBytes().HexString() != request.Hash {
		writeError(w, 400, "metadata_mismatch", fmt.Errorf("torrent metadata differs"))
		return
	}
	info, err := meta.UnmarshalInfo()
	if err != nil {
		writeError(w, 400, "metadata_mismatch", err)
		return
	}
	paths, err := torrentDeletionPaths(request.Root, &info)
	if err != nil {
		writeError(w, 409, "storage_path_conflict", err)
		return
	}
	writeJSON(w, 200, maintenanceSourceFiles{request.Root, paths, info.NumPieces(), privateInfo(&info)})
}

func (a *api) maintenanceTorrentFiles(w http.ResponseWriter, r *http.Request) {
	var hash metainfo.Hash
	if err := hash.FromHexString(r.PathValue("hash")); err != nil {
		writeError(w, 400, "invalid_hash", err)
		return
	}
	release, err := a.maintenanceLease(hash, nil)
	if err != nil {
		writeError(w, 409, "maintenance_held", err)
		return
	}
	defer release()
	unlock, acquired := a.ownership.tryOperation(hash)
	if !acquired {
		writeMoving(w)
		return
	}
	defer unlock()
	if a.ownership.blocked(hash) || len(a.session.get(hash).GuardedPaths) > 0 {
		writeError(w, 409, "storage_path_conflict", errStorageConflict)
		return
	}
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}
	root := a.dirOf(hash)
	paths, err := torrentDeletionPaths(root, t.Info())
	if err != nil {
		writeError(w, 500, "storage", err)
		return
	}
	writeJSON(w, 200, maintenanceSourceFiles{root, paths, t.NumPieces(), privateInfo(t.Info()) || a.session.get(hash).Private})
}

// A manual preview includes every current source directory entry. After the
// torrent is paused, a newly created file requires a fresh confirmation.
func exactMaintenanceSource(root string, info *metainfo.Info, manifest detachManifest) bool {
	if filepath.Clean(root) != manifest.SourceRoot {
		return false
	}
	paths, err := torrentDeletionPaths(root, info)
	if err != nil {
		return false
	}
	expected := map[string]bool{}
	for _, item := range manifest.Paths {
		if item.Root == root {
			expected[item.Path] = true
		}
	}
	for _, path := range paths {
		stat, err := os.Lstat(path)
		if os.IsNotExist(err) && !expected[path] {
			continue
		}
		if err != nil || !stat.Mode().IsRegular() || !expected[path] {
			return false
		}
		delete(expected, path)
	}
	return len(expected) == 0
}

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
