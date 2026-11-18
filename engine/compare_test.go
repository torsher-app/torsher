package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
)

func comparisonFixture(t *testing.T) (*metainfo.Info, string, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "episode.mkv")
	data := bytes.Repeat([]byte("synthetic"), 8)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	info := &metainfo.Info{PieceLength: 8}
	if err := info.BuildFromFilePath(path); err != nil {
		t.Fatal(err)
	}
	return info, dir, path
}

func TestComparePermissionErrorsBlockInspect(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("file permission checks do not apply to root")
	}
	for _, kind := range []string{"open", "stat"} {
		t.Run(kind, func(t *testing.T) {
			info, dir, path := comparisonFixture(t)
			if kind == "open" {
				if err := os.Chmod(path, 0); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = os.Chmod(path, 0o600) })
			} else {
				if err := os.Chmod(dir, 0); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
			}
			states, err := compareOnDisk(context.Background(), info, dir)
			if !errors.Is(err, os.ErrPermission) || states != nil {
				t.Fatalf("states=%v err=%v", states, err)
			}
			infoBytes, err := bencode.Marshal(info)
			if err != nil {
				t.Fatal(err)
			}
			var body bytes.Buffer
			if err := (&metainfo.MetaInfo{InfoBytes: infoBytes}).Write(&body); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/torrents/inspect?dir="+url.QueryEscape(dir), &body)
			response := httptest.NewRecorder()
			(&api{}).inspect(response, request)
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if bytes.Contains(response.Body.Bytes(), []byte(dir)) {
				t.Fatal("inspect leaked local path")
			}
		})
	}
}

func TestCompareReadFailureAndCancellationBlock(t *testing.T) {
	info, dir, path := comparisonFixture(t)
	if err := os.Truncate(path, 1); err != nil {
		t.Fatal(err)
	}
	state, err := compareFile(context.Background(), info, path, 0, info.Length, info.Length, make([]byte, info.PieceLength))
	if !errors.Is(err, io.EOF) || state != "" {
		t.Fatalf("state=%q err=%v", state, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	states, err := compareOnDisk(ctx, info, dir)
	if !errors.Is(err, context.Canceled) || states != nil {
		t.Fatalf("states=%v err=%v", states, err)
	}
}

func TestCompareMissingAndUnknownRemainDistinct(t *testing.T) {
	info, dir, path := comparisonFixture(t)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	states, err := compareOnDisk(context.Background(), info, dir)
	if err != nil || len(states) != 1 || states[0] != diskMissing {
		t.Fatalf("states=%v err=%v", states, err)
	}
	if err := os.WriteFile(path, make([]byte, info.Length), 0o600); err != nil {
		t.Fatal(err)
	}
	info.Pieces = bytes.Repeat([]byte{0}, sha1.Size-1)
	states, err = compareOnDisk(context.Background(), info, dir)
	if err != nil || states[0] != diskUnknown {
		t.Fatalf("states=%v err=%v", states, err)
	}
}
