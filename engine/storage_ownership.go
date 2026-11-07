package main

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sync"

	"github.com/anacrolix/torrent/metainfo"
)

var errStorageConflict = errors.New("torrent storage paths belong to another torrent")

type storageClaim struct {
	paths     []string
	dir       string
	blocked   bool
	conflicts []string
}

// Порядок: операция одного hash → maintenance lease → ownership. Mutex реестра
// защищает только снимок/публикацию, никогда IO, Drop, ожидание или storage.
// Перенос держит обе группы путей до завершения IO; forget освобождает последним.
type storageOwnership struct {
	mu         sync.Mutex
	version    uint64
	claims     map[metainfo.Hash]storageClaim
	operations sync.Map
}

func newStorageOwnership() *storageOwnership {
	return &storageOwnership{claims: make(map[metainfo.Hash]storageClaim)}
}

func (s *storageOwnership) operation(hash metainfo.Hash) func() {
	value, _ := s.operations.LoadOrStore(hash, &sync.Mutex{})
	mu := value.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

func (s *storageOwnership) tryOperation(hash metainfo.Hash) (func(), bool) {
	value, _ := s.operations.LoadOrStore(hash, &sync.Mutex{})
	mu := value.(*sync.Mutex)
	if !mu.TryLock() {
		return nil, false
	}
	return mu.Unlock, true
}

type storageIdentity struct {
	path     string
	entry    string
	info     os.FileInfo
	ancestor os.FileInfo
	suffix   string
}

func identityOf(path string) storageIdentity {
	path = canonicalMaintenancePath(path)
	id := storageIdentity{path: path, entry: maintenanceEntryKey(path)}
	id.info, _ = os.Stat(path)
	ancestor := path
	for {
		if info, err := os.Stat(ancestor); err == nil {
			id.ancestor = info
			id.suffix, _ = filepath.Rel(ancestor, path)
			break
		}
		parent := filepath.Dir(ancestor)
		if parent == ancestor {
			break
		}
		ancestor = parent
	}
	return id
}

func identities(paths []string) []storageIdentity {
	result := make([]storageIdentity, 0, len(paths))
	for _, path := range paths {
		result = append(result, identityOf(path))
	}
	return result
}

func overlaps(a, b []storageIdentity) bool {
	for _, x := range a {
		for _, y := range b {
			if x.path == y.path || (x.entry != "" && x.entry == y.entry) ||
				(x.info != nil && y.info != nil && os.SameFile(x.info, y.info)) ||
				(x.ancestor != nil && y.ancestor != nil && x.suffix == y.suffix && os.SameFile(x.ancestor, y.ancestor)) {
				return true
			}
		}
	}
	return false
}

func (s *storageOwnership) snapshot() (map[metainfo.Hash]storageClaim, uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	copy := make(map[metainfo.Hash]storageClaim, len(s.claims))
	for hash, claim := range s.claims {
		copy[hash] = claim
	}
	return copy, s.version
}

func (s *storageOwnership) reserve(hash metainfo.Hash, dir string, paths []string) error {
	for {
		claims, version := s.snapshot()
		candidate := identities(paths)
		conflict := false
		for other, claim := range claims {
			if other != hash && overlaps(candidate, identities(claim.paths)) {
				conflict = true
				break
			}
		}
		s.mu.Lock()
		if version != s.version {
			s.mu.Unlock()
			continue
		}
		if conflict {
			s.mu.Unlock()
			return errStorageConflict
		}
		previous := claims[hash]
		previous.paths = append(slices.Clone(previous.paths), paths...)
		if previous.dir == "" {
			previous.dir = dir
		}
		s.claims[hash] = previous
		s.version++
		s.mu.Unlock()
		return nil
	}
}

func (s *storageOwnership) replace(hash metainfo.Hash, claim storageClaim) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(claim.paths) == 0 {
		delete(s.claims, hash)
	} else {
		s.claims[hash] = claim
	}
	s.version++
}

func (s *storageOwnership) blocked(hash metainfo.Hash) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.claims[hash].blocked
}

// Полный preflight до открытия storage и finishMove: обе стороны старой
// коллизии блокируются независимо от порядка чтения каталога сессий.
func (a *api) preflightStorage(items []restoredTorrent) {
	claims := make(map[metainfo.Hash]storageClaim)
	keys := make(map[metainfo.Hash][]storageIdentity)
	for _, item := range items {
		hash := item.meta.HashInfoBytes()
		dir := a.dirOrDefault(item.saved.Dir)
		paths := metadataPaths(item.meta, dir)
		for _, extra := range []string{item.saved.MovingTo, item.saved.MovedFrom} {
			if extra != "" {
				paths = append(paths, metadataPaths(item.meta, extra)...)
			}
		}
		claims[hash] = storageClaim{paths: paths, dir: dir}
		keys[hash] = identities(paths)
	}
	for hash, claim := range claims {
		for other := range claims {
			if other != hash && overlaps(keys[hash], keys[other]) {
				claim.blocked = true
				claim.conflicts = append(claim.conflicts, other.HexString())
			}
		}
		slices.Sort(claim.conflicts)
		claims[hash] = claim
	}
	for hash, claim := range claims {
		a.ownership.replace(hash, claim)
	}
}

type storageInventoryEntry struct {
	InfoHash          string   `json:"infoHash"`
	Dir               string   `json:"dir"`
	State             string   `json:"state"`
	ConflictingHashes []string `json:"conflictingHashes"`
	Paused            bool     `json:"paused"`
}

func (a *api) storageInventory(w http.ResponseWriter, _ *http.Request) {
	claims, _ := a.ownership.snapshot()
	result := make([]storageInventoryEntry, 0, len(claims))
	for hash, claim := range claims {
		state := "active"
		if claim.blocked {
			state = "conflict"
		} else if _, live := a.client.Torrent(hash); !live {
			continue
		}
		conflicts := slices.Clone(claim.conflicts)
		if conflicts == nil {
			conflicts = []string{}
		}
		result = append(result, storageInventoryEntry{hash.HexString(), claim.dir, state, conflicts, a.session.get(hash).Paused})
	}
	slices.SortFunc(result, func(a, b storageInventoryEntry) int {
		if a.InfoHash < b.InfoHash {
			return -1
		}
		if a.InfoHash > b.InfoHash {
			return 1
		}
		return 0
	})
	writeJSON(w, http.StatusOK, result)
}
