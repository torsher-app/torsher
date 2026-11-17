//go:build linux || darwin

package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/anacrolix/torrent/metainfo"
	"golang.org/x/sys/unix"
)

func allocatedBytes(t *testing.T, path string) int64 {
	t.Helper()
	var stat unix.Stat_t
	if err := unix.Stat(path, &stat); err != nil {
		t.Fatal(err)
	}
	return stat.Blocks * 512
}

func TestDeletePreviewHardlinksAndAllocation(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.mkv")
	library := filepath.Join(root, "library.mkv")
	copy := filepath.Join(root, "copy.mkv")
	payload := bytes.Repeat([]byte{42}, 32769)
	for _, path := range []string{source, copy} {
		if err := os.WriteFile(path, payload, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Link(source, library); err != nil {
		t.Fatal(err)
	}
	sparse := filepath.Join(root, "sparse.mkv")
	f, err := os.Create(sparse)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(16 << 20); err != nil {
		t.Fatal(err)
	}
	f.Close()
	symlink := filepath.Join(root, "symlink.mkv")
	if err := os.Symlink(copy, symlink); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(root, alias); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name  string
		paths []string
		want  int64
	}{
		{"remaining library hardlink", []string{source}, 0},
		{"aliased source is one name", []string{source, filepath.Join(alias, "source.mkv")}, 0},
		{"independent copy", []string{copy}, allocatedBytes(t, copy)},
		{"mixed links and copy", []string{source, copy}, allocatedBytes(t, copy)},
		{"all links removed once", []string{source, library, source}, allocatedBytes(t, source)},
		{"sparse uses allocated blocks", []string{sparse}, allocatedBytes(t, sparse)},
		{"missing and symlink ignored", []string{filepath.Join(root, "missing", "file"), symlink}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := reclaimableFileBytes(tc.paths)
			if err != nil || got != tc.want {
				t.Fatalf("got %d / %v, want %d", got, err, tc.want)
			}
		})
	}
	info := &metainfo.Info{Name: "source.mkv", Length: int64(len(payload))}
	paths, err := torrentDeletionPaths(root, info)
	if err != nil {
		t.Fatal(err)
	}
	got, err := reclaimableFileBytes(paths)
	if err != nil || got != 0 {
		t.Fatalf("preview %d / %v", got, err)
	}
	if _, err := deleteTorrentFiles(root, info); err != nil {
		t.Fatal(err)
	}
	preserved, err := os.ReadFile(library)
	if err != nil || !bytes.Equal(preserved, payload) {
		t.Fatal("library hardlink changed", err)
	}
	if allocatedBytes(t, library) == 0 {
		t.Fatal("library lost allocated payload")
	}
}

func TestDeletePreviewCandidates(t *testing.T) {
	root := t.TempDir()
	info := &metainfo.Info{Name: "pack", Files: []metainfo.FileInfo{
		{Path: []string{"one.mkv"}, Length: 10},
		{Path: []string{"one.mkv.part"}, Length: 10},
	}}
	paths, err := torrentDeletionPaths(root, info)
	if err != nil || len(paths) != 3 {
		t.Fatalf("candidates %v / %v", paths, err)
	}
	if err := os.MkdirAll(filepath.Join(root, "pack"), 0700); err != nil {
		t.Fatal(err)
	}
	part := filepath.Join(root, "pack", "one.mkv.part")
	if err := os.WriteFile(part, []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := reclaimableFileBytes(paths)
	if err != nil || got != allocatedBytes(t, part) {
		t.Fatalf("partial estimate %d / %v", got, err)
	}
	info.Files = append(info.Files, metainfo.FileInfo{Path: []string{"..", "..", "escape"}})
	if _, err := torrentDeletionPaths(root, info); err == nil {
		t.Fatal("escaped downloads")
	}
}

func TestDeletePreviewEndpointDoesNotMutate(t *testing.T) {
	fx := newNamedFixture(t, "Delete.Preview.mkv", 32769)
	dataDir := t.TempDir()
	a, server := newTestEngine(t, dataDir)
	hash := downloadFixture(t, a, server, fx)
	waitFor(t, 30*time.Second, func() bool { return stateOfHash(t, a, hash).BytesCompleted == int64(len(fx.content)) })
	source := filepath.Join(a.downloads, "Delete.Preview.mkv")
	library := filepath.Join(t.TempDir(), "library.mkv")
	if err := os.Link(source, library); err != nil {
		t.Fatal(err)
	}
	response, err := http.Get(server.URL + "/torrents/" + hash.HexString() + "/delete-preview")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var preview deletePreviewResponse
	if err := json.NewDecoder(response.Body).Decode(&preview); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || preview.ReclaimableBytes != 0 {
		t.Fatalf("%d %+v", response.StatusCode, preview)
	}
	if got := stateOfHash(t, a, hash); got.BytesCompleted != int64(len(fx.content)) {
		t.Fatal("preview mutated torrent", got)
	}
	for _, path := range []string{source, library} {
		content, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(content, fx.content) {
			t.Fatal("preview changed payload", err)
		}
	}
}
