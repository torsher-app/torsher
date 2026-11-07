package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// Manifest не меняется после prepare. Корень идентифицируется отдельно:
// отсутствие файла на отключённом томе не считается успешным удалением.
type maintenancePath struct {
	Root       string  `json:"root"`
	Path       string  `json:"path"`
	RootDevice uint64  `json:"rootDevice,string"`
	RootInode  uint64  `json:"rootInode"`
	Device     uint64  `json:"device,string"`
	Inode      uint64  `json:"inode"`
	Size       int64   `json:"size"`
	Mtime      float64 `json:"mtime"`
}
type detachManifest struct {
	InfoHash   string            `json:"infoHash"`
	PieceCount int               `json:"pieceCount"`
	Paths      []maintenancePath `json:"paths"`
}
type detachFence struct {
	ID             string            `json:"id"`
	Manifest       detachManifest    `json:"manifest"`
	State          string            `json:"state"`
	Results        map[string]string `json:"results"`
	Error          string            `json:"error,omitempty"`
	dirty          bool
	reattaching    bool
	resumed        bool
	RestoreMeta    []byte        `json:"restoreMeta,omitempty"`
	RestoreSession *savedTorrent `json:"restoreSession,omitempty"`
	EntryKeys      []string      `json:"entryKeys,omitempty"`
}
type maintenanceFences struct {
	mu            sync.Mutex
	dir           string
	fences        map[string]*detachFence
	leases        map[string]int
	loadErr       error
	workers       map[string]string
	unknownGuards map[string][]maintenancePath
}

var operationID = regexp.MustCompile(`^[a-zA-Z0-9-]{1,80}$`)
var errMaintenance = errors.New("resource held by library maintenance")

func loadMaintenance(dir string) *maintenanceFences {
	m := &maintenanceFences{dir: dir, fences: map[string]*detachFence{}, leases: map[string]int{}, workers: map[string]string{}, unknownGuards: map[string][]maintenancePath{}}
	if err := os.MkdirAll(dir, 0700); err != nil {
		m.loadErr = err
		return m
	}
	if err := syncDirectory(filepath.Dir(dir)); err != nil {
		m.loadErr = err
		return m
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		m.loadErr = err
		return m
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		var fence detachFence
		if err != nil || json.Unmarshal(data, &fence) != nil || !operationID.MatchString(fence.ID) || validateManifest(fence.Manifest) != nil || fence.Results == nil {
			m.loadErr = errors.New("invalid maintenance fence")
			return m
		}
		m.fences[fence.ID] = &fence
	}
	return m
}

// Сначала данные файла, затем rename и fsync каталога. До успешного
// завершения fence нельзя подтверждать или менять состояние раздачи.
func durableJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".maintenance-")
	if err != nil {
		return err
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		return err
	}
	if err = os.Rename(tmp, path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}
func syncDirectory(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(file.Sync(), file.Close())
}
func (m *maintenanceFences) save(fence *detachFence) error {
	fence.dirty = true
	if err := maintenanceJournalWrite(filepath.Join(m.dir, fence.ID+".json"), fence); err != nil {
		return err
	}
	fence.dirty = false
	return nil
}

var maintenanceJournalWrite = durableJSON

// После неопределённого fsync сохраняем fence и повторяем запись до любого ack.
func (m *maintenanceFences) confirm(w http.ResponseWriter, fence *detachFence) bool {
	if fence.dirty && m.save(fence) != nil {
		writeError(w, 500, "journal_failed", errors.New("cannot persist maintenance journal"))
		return false
	}
	return true
}

func validateManifest(manifest detachManifest) error {
	var hash metainfo.Hash
	if hash.FromHexString(manifest.InfoHash) != nil || manifest.InfoHash != hash.HexString() || manifest.PieceCount <= 0 || manifest.PieceCount > 10000000 || len(manifest.Paths) == 0 || len(manifest.Paths) > 100000 {
		return errors.New("invalid manifest")
	}
	seen := map[string]bool{}
	for _, item := range manifest.Paths {
		if !filepath.IsAbs(item.Root) || !filepath.IsAbs(item.Path) || filepath.Clean(item.Path) != item.Path || filepath.Clean(item.Root) != item.Root || !isInside(item.Root, item.Path) || item.Inode == 0 || item.RootInode == 0 || item.Size < 0 || seen[item.Path] {
			return errors.New("invalid manifest path")
		}
		seen[item.Path] = true
	}
	return nil
}
func (m *maintenanceFences) blocked(hash string, paths []string) bool {
	if m.loadErr != nil {
		return true
	}
	for heldHash, owned := range m.unknownGuards {
		if heldHash == hash {
			return true
		}
		for _, item := range owned {
			for _, path := range paths {
				if sameMaintenanceEntry(item.Path, path) {
					return true
				}
			}
		}
	}
	for _, fence := range m.fences {
		if !fence.dirty && (fence.State == "finalized" || fence.State == "cancelled") {
			continue
		}
		if fence.Manifest.InfoHash == hash {
			return true
		}
		for _, item := range fence.Manifest.Paths {
			for _, path := range paths {
				if sameMaintenanceEntry(item.Path, path) || containsMaintenanceKey(fence.EntryKeys, maintenanceEntryKey(path)) {
					return true
				}
			}
		}
	}
	return false
}
func (a *api) maintenanceBlocked(hash metainfo.Hash, paths []string) bool {
	a.maintenance.mu.Lock()
	defer a.maintenance.mu.Unlock()
	return a.maintenance.blocked(hash.HexString(), paths)
}

// Канонизируем существующую часть пути: alias каталога не обходит fence.
func canonicalMaintenancePath(path string) string {
	path = filepath.Clean(path)
	if canonical, err := filepath.EvalSymlinks(path); err == nil {
		return canonical
	}
	parent := filepath.Dir(path)
	if parent == path {
		return path
	}
	return filepath.Join(canonicalMaintenancePath(parent), filepath.Base(path))
}

func metadataPaths(meta *metainfo.MetaInfo, dir string) []string {
	info, err := meta.UnmarshalInfo()
	if err != nil {
		return nil
	}
	paths := []string{}
	for _, file := range info.UpvertedFiles() {
		path := canonicalMaintenancePath(filepath.Join(dir, filePathOf(storage.FilePathMakerOpts{Info: &info, File: &file})))
		paths = append(paths, path, path+partFileSuffix)
	}
	return paths
}
func (a *api) maintenanceLease(hash metainfo.Hash, paths []string) (func(), error) {
	m := a.maintenance
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.blocked(hash.HexString(), paths) {
		return nil, errMaintenance
	}
	keys := []string{hash.HexString()}
	for _, path := range paths {
		keys = append(keys, canonicalMaintenancePath(path))
		if key := maintenanceEntryKey(path); key != "" {
			keys = append(keys, key)
		}
	}
	for _, key := range keys {
		m.leases[key]++
	}
	return func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		for _, key := range keys {
			m.leases[key]--
			if m.leases[key] == 0 {
				delete(m.leases, key)
			}
		}
	}, nil
}
func (a *api) maintenanceRoute(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) > 0 && parts[0] == "maintenance" {
			token := r.Header.Get("X-Torsher-Maintenance-Token")
			if len(a.maintenanceToken) < 32 || subtle.ConstantTimeCompare([]byte(token), []byte(a.maintenanceToken)) != 1 || r.Header.Get("Origin") != "" {
				writeError(w, 403, "maintenance_forbidden", errors.New("maintenance capability required"))
				return
			}
			if r.Method != "GET" {
				mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
				if err != nil || mediaType != "application/json" {
					writeError(w, 415, "maintenance_content_type", errors.New("application/json required"))
					return
				}
			}
		}
		if len(parts) >= 2 && parts[0] == "torrents" && len(parts[1]) == 40 {
			var hash metainfo.Hash
			if hash.FromHexString(parts[1]) == nil {
				release, err := a.maintenanceLease(hash, nil)
				if err != nil {
					writeError(w, 409, "maintenance_held", err)
					return
				}
				defer release()
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (a *api) maintenancePrepare(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var manifest detachManifest
	if !operationID.MatchString(id) || json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(&manifest) != nil || validateManifest(manifest) != nil {
		writeError(w, 400, "invalid_manifest", errors.New("invalid maintenance manifest"))
		return
	}
	m := a.maintenance
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.loadErr != nil {
		writeError(w, 503, "maintenance_unavailable", errors.New("maintenance journal unavailable"))
		return
	}
	fence := m.fences[id]
	if fence != nil {
		if !m.confirm(w, fence) {
			return
		}
		old, _ := json.Marshal(fence.Manifest)
		next, _ := json.Marshal(manifest)
		if !bytes.Equal(old, next) {
			writeError(w, 409, "manifest_conflict", errors.New("operation manifest differs"))
			return
		}
		if fence.State != "pending" {
			a.resumeMaintenanceCancelled(fence)
			writeJSON(w, 200, fence)
			return
		}
	} else {
		paths := []string{}
		for _, item := range manifest.Paths {
			paths = append(paths, item.Path)
		}
		if m.blocked(manifest.InfoHash, paths) {
			writeError(w, 409, "maintenance_held", errMaintenance)
			return
		}
		if m.leases[manifest.InfoHash] > 0 {
			writeError(w, 409, "resource_busy", errors.New("resource is active"))
			return
		}
		for _, path := range paths {
			if m.leases[canonicalMaintenancePath(path)] > 0 || m.leases[maintenanceEntryKey(path)] > 0 {
				writeError(w, 409, "resource_busy", errors.New("resource is active"))
				return
			}
		}
		a.movesMu.Lock()
		moving := false
		for _, job := range a.moves {
			if job.snapshot().State == "running" {
				moving = true
				break
			}
		}
		a.movesMu.Unlock()
		if moving {
			writeError(w, 409, "resource_busy", errors.New("torrent move is active"))
			return
		}
		// Не разделяем владение путём с другой живой раздачей или переносом.
		claims, _ := a.ownership.snapshot()
		candidate := identities(paths)
		for hash, claim := range claims {
			if hash.HexString() != manifest.InfoHash && overlaps(candidate, identities(claim.paths)) {
				writeError(w, 409, "path_conflict", errStorageConflict)
				return
			}
		}
		for _, torrent := range a.client.Torrents() {
			hash := torrent.InfoHash()
			if a.isMoving(hash) {
				writeError(w, 409, "resource_busy", errors.New("torrent move is active"))
				return
			}
			if hash.HexString() == manifest.InfoHash {
				continue
			}
			meta := torrent.Metainfo()
			for _, path := range metadataPaths(&meta, a.dirOf(hash)) {
				for _, owned := range paths {
					if sameMaintenanceEntry(path, owned) {
						writeError(w, 409, "path_conflict", errors.New("path has another owner"))
						return
					}
				}
			}
		}
		fence = &detachFence{ID: id, Manifest: manifest, State: "pending", Results: map[string]string{}}
		var originalHash metainfo.Hash
		_ = originalHash.FromHexString(manifest.InfoHash)
		if original, live := a.client.Torrent(originalHash); live && a.session.has(originalHash) {
			var buffer bytes.Buffer
			meta := original.Metainfo()
			if err := meta.Write(&buffer); err != nil {
				writeError(w, 409, "metadata_unavailable", err)
				return
			}
			saved := a.session.get(originalHash)
			saved.Dir = a.dirOf(originalHash)
			fence.RestoreMeta = buffer.Bytes()
			fence.RestoreSession = &saved
		}

		for _, path := range paths {
			fence.EntryKeys = append(fence.EntryKeys, maintenanceEntryKey(path))
		}
		m.fences[id] = fence
		if err := m.save(fence); err != nil {
			writeError(w, 500, "journal_failed", errors.New("cannot persist maintenance fence"))
			return
		}
		m.fences[id] = fence
	}
	var hash metainfo.Hash
	_ = hash.FromHexString(manifest.InfoHash)
	if torrent, ok := a.client.Torrent(hash); ok {
		if a.windows.streaming(hash) || a.isMoving(hash) {
			writeError(w, 409, "resource_busy", errors.New("resource is active"))
			return
		}
		if torrent.Info() == nil || torrent.NumPieces() != manifest.PieceCount {
			writeError(w, 409, "metadata_mismatch", errors.New("torrent metadata differs"))
			return
		}
		torrent.DisallowDataDownload()
		torrent.DisallowDataUpload()
		deadline := time.Now().Add(5 * time.Second)
		for piecesBusy(torrent) && time.Now().Before(deadline) {
			time.Sleep(20 * time.Millisecond)
		}
		if piecesBusy(torrent) {
			writeError(w, 409, "resource_busy", errors.New("piece verification is active"))
			return
		}
		torrent.Drop()
		a.guarded.Delete(hash)
		if !a.lifecycle.settled(hash) {
			writeError(w, 409, "storage_not_closed", errors.New("storage close not confirmed"))
			return
		}
		a.dirs.Delete(hash)
		a.windows.forget(hash)
		a.forgetMove(hash)
	}
	if !a.lifecycle.settled(hash) {
		writeError(w, 409, "storage_not_closed", errors.New("storage close not confirmed"))
		return
	}
	if err := a.session.remove(hash); err != nil {
		writeError(w, 500, "session_remove_failed", errors.New("cannot remove engine session"))
		return
	}
	if err := syncDirectory(a.session.dir); err != nil {
		writeError(w, 500, "session_sync_failed", errors.New("cannot persist session removal"))
		return
	}
	for index := 0; index < manifest.PieceCount; index++ {
		if err := a.completion.Set(metainfo.PieceKey{InfoHash: hash, Index: index}, false); err != nil {
			writeError(w, 500, "completion_reset_failed", errors.New("cannot reset piece completion"))
			return
		}
	}
	fence.State = "detached"
	if err := m.save(fence); err != nil {
		writeError(w, 500, "journal_failed", errors.New("cannot persist detach result"))
		return
	}
	a.resumeMaintenanceCancelled(fence)
	writeJSON(w, 200, fence)
}
func (a *api) maintenanceStatus(w http.ResponseWriter, r *http.Request) {
	m := a.maintenance
	m.mu.Lock()
	defer m.mu.Unlock()
	fence := m.fences[r.PathValue("id")]
	if fence == nil {
		writeError(w, 404, "operation_not_found", errors.New("operation not found"))
		return
	}
	if !m.confirm(w, fence) {
		return
	}
	a.resumeMaintenanceCancelled(fence)
	writeJSON(w, 200, fence)
}
func (a *api) maintenanceFinish(w http.ResponseWriter, r *http.Request) {
	m := a.maintenance
	m.mu.Lock()
	defer m.mu.Unlock()
	fence := m.fences[r.PathValue("id")]
	if fence == nil {
		writeError(w, 404, "operation_not_found", errors.New("operation not found"))
		return
	}
	if !m.confirm(w, fence) {
		return
	}
	next := "finalized"
	if strings.HasSuffix(r.URL.Path, "/cancel") {
		next = "cancelled"
	}
	if fence.State == next {
		a.resumeMaintenanceCancelled(fence)
		writeJSON(w, 200, fence)
		return
	}
	if next == "cancelled" && len(fence.Results) > 0 {
		writeError(w, 409, "operation_partial", errors.New("operation has filesystem effects"))
		return
	}
	if next == "finalized" {
		for index := range fence.Manifest.Paths {
			if fence.Results[fmt.Sprint(index)] != "removed" {
				writeError(w, 409, "operation_incomplete", errors.New("operation is incomplete"))
				return
			}
		}
	}
	if fence.State != "detached" && fence.State != "deleting" && !(next == "cancelled" && fence.State == "reattaching") {
		writeError(w, 409, "operation_not_detached", errors.New("operation is not detached"))
		return
	}
	if next == "cancelled" && fence.RestoreSession != nil {
		if fence.reattaching {
			writeJSON(w, http.StatusAccepted, fence)
			return
		}
		fence.Error = ""
		fence.State = "reattaching"
		if err := m.save(fence); err != nil {
			writeError(w, 500, "journal_failed", err)
			return
		}
		a.startMaintenanceReattach(fence)
		writeJSON(w, http.StatusAccepted, fence)
		return
	}
	fence.State = next
	if err := m.save(fence); err != nil {
		writeError(w, 500, "journal_failed", errors.New("cannot persist operation result"))
		return
	}
	if next == "finalized" || (next == "cancelled" && fence.RestoreSession == nil) {
		var hash metainfo.Hash
		_ = hash.FromHexString(fence.Manifest.InfoHash)
		if _, live := a.client.Torrent(hash); !live && a.lifecycle.settled(hash) {
			a.ownership.replace(hash, storageClaim{})
		}
	}
	a.resumeMaintenanceCancelled(fence)
	writeJSON(w, 200, fence)
}
func (a *api) maintenanceUnlink(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Index int `json:"index"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body) != nil {
		writeError(w, 400, "invalid_index", errors.New("invalid file index"))
		return
	}
	m := a.maintenance
	m.mu.Lock()
	defer m.mu.Unlock()
	fence := m.fences[r.PathValue("id")]
	if fence == nil {
		writeError(w, 404, "operation_not_found", errors.New("operation not found"))
		return
	}
	if !m.confirm(w, fence) {
		return
	}
	if fence.State != "detached" && fence.State != "deleting" {
		writeError(w, 409, "operation_not_detached", errors.New("operation is not detached"))
		return
	}
	if body.Index < 0 || body.Index >= len(fence.Manifest.Paths) {
		writeError(w, 400, "invalid_index", errors.New("invalid file index"))
		return
	}
	key := fmt.Sprint(body.Index)
	if fence.Results[key] == "removed" {
		a.resumeMaintenanceCancelled(fence)
		writeJSON(w, 200, fence)
		return
	}
	fence.State = "deleting"
	fence.Results[key] = "staged"
	if err := m.save(fence); err != nil {
		writeError(w, 500, "journal_failed", errors.New("cannot persist file intent"))
		return
	}
	if err := safeMaintenanceUnlink(fence.Manifest.Paths[body.Index], ".torsher-maintenance-"+fence.ID+"-"+key); err != nil {
		fence.Error = err.Error()
		_ = m.save(fence)
		writeError(w, 409, "unlink_blocked", err)
		return
	}
	fence.Results[key] = "removed"
	fence.Error = ""
	if err := m.save(fence); err != nil {
		writeError(w, 500, "journal_failed", errors.New("cannot persist file result"))
		return
	}
	a.resumeMaintenanceCancelled(fence)
	writeJSON(w, 200, fence)
}

// Восстановленная база может не знать более новый fence: перечень нужен до ack.
func (a *api) maintenanceInventory(w http.ResponseWriter, r *http.Request) {
	m := a.maintenance
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.loadErr != nil {
		writeError(w, 503, "journal_unavailable", errors.New("maintenance journal unavailable"))
		return
	}
	fences := make([]*detachFence, 0, len(m.fences))
	for _, fence := range m.fences {
		if !m.confirm(w, fence) {
			return
		}
		a.resumeMaintenanceCancelled(fence)
		fences = append(fences, fence)
	}
	writeJSON(w, 200, fences)
}

func containsMaintenanceKey(keys []string, key string) bool {
	if key == "" {
		return false
	}
	for _, candidate := range keys {
		if candidate == key {
			return true
		}
	}
	return false
}
func sameMaintenanceEntry(a, b string) bool {
	if canonicalMaintenancePath(a) == canonicalMaintenancePath(b) {
		return true
	}
	key := maintenanceEntryKey(a)
	return key != "" && key == maintenanceEntryKey(b)
}

var maintenanceReattachCheckpoint = func(string) error { return nil }

// Сессия остаётся в durable fence до подтверждённого возврата; orphan не добавляем.
func (a *api) reattachMaintenance(fence *detachFence) error {
	meta, err := metainfo.Load(bytes.NewReader(fence.RestoreMeta))
	if err != nil {
		return err
	}
	if meta.HashInfoBytes().HexString() != fence.Manifest.InfoHash {
		return errors.New("restore_hash_mismatch")
	}
	saved := *fence.RestoreSession
	saved.GuardedPaths = fence.Manifest.Paths
	saved.GuardedOperationID = fence.ID
	info, err := meta.UnmarshalInfo()
	if err != nil {
		return err
	}
	dir := a.dirOrDefault(saved.Dir)
	unlock := a.ownership.operation(meta.HashInfoBytes())
	defer unlock()
	if a.ownership.blocked(meta.HashInfoBytes()) {
		return errStorageConflict
	}
	if err := a.ownership.reserve(meta.HashInfoBytes(), dir, metadataPaths(meta, dir)); err != nil {
		return err
	}
	pinned, err := openMaintenancePinned(&info, meta.HashInfoBytes(), dir, fence.Manifest.Paths, a.completion)
	if err != nil {
		return err
	}
	spec, err := torrent.TorrentSpecFromMetaInfoErr(meta)
	if err != nil {
		pinned.Close()
		return err
	}
	for i := 0; i < info.NumPieces(); i++ {
		if err := a.completion.Set(metainfo.PieceKey{InfoHash: meta.HashInfoBytes(), Index: i}, false); err != nil {
			pinned.Close()
			return err
		}
	}
	spec.Storage = trackedStorage{ClientImplCloser: pinned, lifecycle: a.lifecycle}
	spec.DisallowDataDownload = true
	spec.DisallowDataUpload = true
	spec.DisableInitialPieceCheck = true
	if err := maintenanceReattachCheckpoint("before_add"); err != nil {
		pinned.Close()
		return err
	}
	t, created, err := a.client.AddTorrentSpec(spec)
	if err != nil || !created {
		pinned.Close()
		return errors.New("guarded_add_failed")
	}
	a.guarded.Store(t.InfoHash(), t)
	success := false
	defer func() {
		if !success {
			a.guarded.Delete(t.InfoHash())
			t.Drop()
		}
	}()
	if !samePath(dir, a.downloads) {
		a.dirs.Store(t.InfoHash(), dir)
	}
	if err := maintenanceReattachCheckpoint("before_verify"); err != nil {
		return err
	}
	for i := 0; i < t.NumPieces(); i++ {
		piece := t.Piece(i)
		if err := piece.VerifyData(); err != nil {
			return err
		}
		waitPieceSettled(piece)
		state := piece.State()
		if state.Hashing || state.QueuedForHash || state.Marking || !state.Complete {
			return errors.New("restore_content_mismatch")
		}
	}
	if err := a.session.save(meta, func(target *savedTorrent) { *target = saved }); err != nil {
		return err
	}
	// Старый session writer не fsync: здесь нужна отдельная durable граница.
	for _, ext := range []string{".torrent", ".json"} {
		file, err := os.Open(a.session.path(t.InfoHash(), ext))
		if err != nil {
			return err
		}
		err = errors.Join(file.Sync(), file.Close())
		if err != nil {
			return err
		}
	}
	if err := syncDirectory(a.session.dir); err != nil {
		return err
	}
	success = true
	return nil
}

// Вызывается под mutex только для старта; IO и хэширование держат точечный fence.
func (a *api) startMaintenanceReattach(fence *detachFence) {
	m := a.maintenance
	if owner, exists := m.workers[fence.Manifest.InfoHash]; exists && owner != fence.ID {
		fence.Error = "reattach_conflict"
		_ = m.save(fence)
		return
	}
	if fence.reattaching {
		return
	}
	m.workers[fence.Manifest.InfoHash] = fence.ID
	fence.reattaching = true
	fence.Error = ""
	go func() {
		err := a.reattachMaintenance(fence)
		m := a.maintenance
		m.mu.Lock()
		defer m.mu.Unlock()
		fence.reattaching = false
		delete(m.workers, fence.Manifest.InfoHash)
		if err != nil {
			fence.Error = "reattach_failed"
			if regexp.MustCompile(`^[a-z_]+$`).MatchString(err.Error()) {
				fence.Error = err.Error()
			}
		} else {
			fence.State = "cancelled"
			fence.Error = ""
		}
		if m.save(fence) == nil {
			if fence.State == "cancelled" {
				delete(m.unknownGuards, fence.Manifest.InfoHash)
			}
			a.resumeMaintenanceCancelled(fence)
		}
	}()
}
func (a *api) recoverMaintenanceReattachments() {
	m := a.maintenance
	m.mu.Lock()
	defer m.mu.Unlock()
	// Session указывает единственную актуальную отмену. Исторические fences не владеют reopen.
	sessions, _ := a.session.load()
	for _, item := range sessions {
		if len(item.saved.GuardedPaths) == 0 {
			continue
		}
		hash := item.meta.HashInfoBytes().HexString()
		fence := m.fences[item.saved.GuardedOperationID]
		if fence == nil || fence.Manifest.InfoHash != hash || fence.RestoreSession == nil {
			m.unknownGuards[hash] = item.saved.GuardedPaths
		}
	}
	active := map[string][]string{}
	for _, fence := range m.fences {
		if fence.State != "cancelled" && fence.State != "finalized" {
			active[fence.Manifest.InfoHash] = append(active[fence.Manifest.InfoHash], fence.ID)
		}
	}
	for _, fence := range m.fences {
		if fence.State == "cancelled" && fence.RestoreSession != nil && len(active[fence.Manifest.InfoHash]) == 0 {
			var hash metainfo.Hash
			_ = hash.FromHexString(fence.Manifest.InfoHash)
			saved := a.session.get(hash)
			if len(saved.GuardedPaths) > 0 && saved.GuardedOperationID == fence.ID {
				if _, live := a.client.Torrent(hash); !live {
					fence.State = "reattaching"
					fence.RestoreSession = &saved
					fence.resumed = false
				}
			}
		}
		if fence.State != "reattaching" || fence.RestoreSession == nil {
			continue
		}
		if owners := active[fence.Manifest.InfoHash]; len(owners) > 1 || (len(owners) == 1 && owners[0] != fence.ID) {
			fence.Error = "reattach_conflict"
			_ = m.save(fence)
			continue
		}
		if m.save(fence) == nil {
			a.startMaintenanceReattach(fence)
		}
	}
}

// Вызывается под maintenance mutex только после подтверждённого terminal fsync.
func (a *api) resumeMaintenanceCancelled(fence *detachFence) {
	if fence.State != "cancelled" || fence.dirty || fence.resumed || fence.RestoreSession == nil {
		return
	}
	var hash metainfo.Hash
	_ = hash.FromHexString(fence.Manifest.InfoHash)
	if a.maintenance.blocked(hash.HexString(), nil) {
		return
	}
	if t, ok := a.client.Torrent(hash); ok {
		saved := a.session.get(hash)
		if len(saved.GuardedPaths) > 0 && saved.GuardedOperationID == fence.ID {
			a.setPaused(t, saved.Paused, saved.Selected)
			fence.resumed = true
		}
	}
}
