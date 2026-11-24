package main

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestPrivateSessionMutationNeverRecreatesInvalidState(t *testing.T) {
	for _, test := range []struct {
		name string
		json []byte
	}{
		{name: "missing"},
		{name: "malformed", json: []byte("{")},
		{name: "missing required fields", json: []byte("{}")},
	} {
		t.Run(test.name, func(t *testing.T) {
			fx := newFixture(t)
			initialDir := t.TempDir()
			a, server := newTestEngine(t, initialDir)
			hash := fx.meta.HashInfoBytes()
			const trackerURL = "https://tracker.example/announce"
			raw := encodePrivateTestMeta(t, *fx.meta, false, trackerURL)
			privateTestCall(t, 200, post(t, server.URL+"/torrents?private=true", raw))
			statePath := a.session.path(hash, ".json")
			if test.json == nil {
				if err := os.Remove(statePath); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(statePath, test.json, 0600); err != nil {
				t.Fatal(err)
			}

			privateTestCall(t, 500, post(t, server.URL+"/torrents/"+hash.HexString()+"/pause", nil))
			if err := a.session.saveSelection(hash, savedTorrent{}); !errors.Is(err, errTorrentSessionUnavailable) {
				t.Fatalf("selection attempted to replace invalid state: %v", err)
			}
			if err := a.session.save(fx.meta, func(*savedTorrent) {}); !errors.Is(err, errTorrentSessionUnavailable) {
				t.Fatalf("re-add attempted to replace invalid state: %v", err)
			}
			live, _ := a.client.Torrent(hash)
			var manager privateTrackerManager
			manager.flushSeconds(a, live, &privateAnnounceState{seconds: 55})
			state := a.stateOf(live)
			if !state.IsPrivate || !state.FullDownload || !state.AwaitingAdmission || !state.Paused ||
				state.SeededSeconds != 0 || state.LeftZeroAccepted || state.StartAnnounceState != "" || state.TrackerErrorCode != "storage" {
				t.Fatalf("invalid state appeared public or reported tracker evidence: %+v", state)
			}
			res, err := http.Get(server.URL + "/torrents/storage")
			if err != nil {
				t.Fatal(err)
			}
			inventory := decode[[]storageInventoryEntry](t, res)
			if len(inventory) != 1 || !inventory[0].IsPrivate || !inventory[0].AwaitingAdmission {
				t.Fatalf("invalid storage state appeared public: %+v", inventory)
			}

			got, err := os.ReadFile(statePath)
			if test.json == nil {
				if !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("mutations created replacement JSON: %q (%v)", got, err)
				}
			} else if err != nil || !bytes.Equal(got, test.json) {
				t.Fatalf("mutations replaced damaged JSON: %q (%v)", got, err)
			}

			restartDir := t.TempDir()
			copyDir(t, filepath.Join(initialDir, "torrents"), filepath.Join(restartDir, "torrents"))
			restarted, restored := newTestEngine(t, restartDir)
			restarted.restore(context.Background())
			if _, exists := restarted.client.Torrent(hash); exists {
				t.Fatal("private override opened publicly on restart")
			}
			magnet := []byte("magnet:?xt=urn:btih:" + hash.HexString())
			privateTestCall(t, 400, post(t, restored.URL+"/torrents/resolve", magnet))
		})
	}
}

func TestPrivateConditionalForget(t *testing.T) {
	for _, attempt := range []string{announceNotSent, announceAttempted, announceAccepted} {
		t.Run(attempt, func(t *testing.T) {
			fx := newFixture(t)
			a, server := newTestEngine(t, t.TempDir())
			hash := fx.meta.HashInfoBytes()
			raw := encodePrivateTestMeta(t, *fx.meta, false, "https://tracker.example/announce")
			privateTestCall(t, 200, post(t, server.URL+"/torrents?private=true", raw))
			if err := a.session.update(hash, func(s *savedTorrent) { s.StartAnnounceState = attempt }); err != nil {
				t.Fatal(err)
			}
			request, err := http.NewRequest(http.MethodDelete, server.URL+"/torrents/"+hash.HexString()+"?private_unstarted_only=true", nil)
			if err != nil {
				t.Fatal(err)
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			want := http.StatusConflict
			if attempt == announceNotSent {
				want = http.StatusOK
			}
			privateTestCall(t, want, response)
			if _, live := a.client.Torrent(hash); live != (want == http.StatusConflict) {
				t.Fatalf("live torrent after conditional forget = %t, HTTP status %d", live, want)
			}
		})
	}
}

func TestInspectPrivateTrackerIdentity(t *testing.T) {
	fx := newFixture(t)
	_, server := newTestEngine(t, t.TempDir())
	inspect := func(endpoint string) torrentDetails {
		raw := encodePrivateTestMeta(t, *fx.meta, true, endpoint)
		return decode[torrentDetails](t, post(t, server.URL+"/torrents/inspect", raw))
	}
	first := inspect("https://TRACKER.example/user-test/announce?passkey=one#fragment")
	same := inspect("https://tracker.example/user-test/announce?passkey=one")
	changed := inspect("https://tracker.example/user-test/announce?passkey=two")
	if !first.IsPrivate || first.PrimaryTrackerHost != "tracker.example" || len(first.TrackerFingerprint) != 64 ||
		first.TrackerFingerprint != same.TrackerFingerprint || first.TrackerFingerprint == changed.TrackerFingerprint {
		t.Fatalf("tracker identity is not canonical and credential-specific: %+v", first)
	}
}
