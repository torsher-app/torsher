package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
)

func encodePrivateTestMeta(t *testing.T, mi metainfo.MetaInfo, private bool, trackers ...string) []byte {
	t.Helper()
	if private {
		info, err := mi.UnmarshalInfo()
		if err != nil {
			t.Fatal(err)
		}
		info.Private = &private
		mi.InfoBytes, err = bencode.Marshal(info)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, url := range trackers {
		mi.AnnounceList = append(mi.AnnounceList, []string{url})
	}
	var out bytes.Buffer
	if err := mi.Write(&out); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func privateTestCall(t *testing.T, want int, response *http.Response) {
	t.Helper()
	defer response.Body.Close()
	if response.StatusCode != want {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("status %d, want %d: %s", response.StatusCode, want, body)
	}
}

func enablePrivateTestTrackers(t *testing.T, a *api) {
	t.Helper()
	a.trackers = newPrivateTrackerManager(context.Background(), nil, a.client.LocalPort())
	t.Cleanup(func() { a.trackers.close(a) })
}

func TestPrivateTrackerChecksAdmissionAndPersistsVerifiedCompletion(t *testing.T) {
	fx, first, second := newTwoFileFixture(t)
	data := t.TempDir()
	a, engine := newTestEngine(t, data)
	enablePrivateTestTrackers(t, a)
	a.restore(context.Background())

	type received struct {
		event string
		left  int64
		saved string
	}
	events := make(chan received, 32)
	var backupCalls atomic.Int32
	backup := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { backupCalls.Add(1) }))
	defer backup.Close()
	port := fx.seeder.LocalPort()
	response, err := bencode.Marshal(map[string]any{
		"interval": 3600,
		"peers":    string([]byte{127, 0, 0, 1, byte(port >> 8), byte(port)}),
	})
	if err != nil {
		t.Fatal(err)
	}
	hash := fx.meta.HashInfoBytes()
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		params := r.URL.Query()
		left, _ := strconv.ParseInt(params.Get("left"), 10, 64)
		events <- received{params.Get("event"), left, a.session.get(hash).StartAnnounceState}
		_, _ = w.Write(response)
	}))
	defer primary.Close()

	raw := encodePrivateTestMeta(t, *fx.meta, false, primary.URL, backup.URL)
	url := engine.URL + "/torrents/" + hash.HexString()
	privateTestCall(t, 200, post(t, engine.URL+"/torrents?private=true&files=0", raw))
	status := stateOfHash(t, a, hash)
	if !status.IsPrivate || !status.FullDownload || !status.AwaitingAdmission || !status.Paused ||
		status.StartAnnounceState != announceNotSent || status.BytesWanted != int64(len(first)+len(second)) {
		t.Fatalf("unexpected private state before admission: %+v", status)
	}
	privateTestCall(t, 409, post(t, url+"/resume", nil))
	rejectedStream, err := http.Get(url + "/files/0/stream")
	if err != nil {
		t.Fatal(err)
	}
	privateTestCall(t, 409, rejectedStream)
	a.tickPrivateTrackers()
	select {
	case e := <-events:
		t.Fatalf("private tracker contacted before admission: %+v", e)
	default:
	}

	privateTestCall(t, 204, post(t, url+"/resume?admitted=true", nil))
	select {
	case e := <-events:
		if e.event != "started" || e.left <= 0 || e.saved != announceAttempted {
			t.Fatalf("first announce was not durably recorded before contact: %+v", e)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("tracker did not receive started")
	}
	select {
	case e := <-events:
		if e.event != "completed" || e.left != 0 {
			t.Fatalf("expected completion with left=0: %+v", e)
		}
	case <-time.After(25 * time.Second):
		t.Fatal("tracker did not receive verified completion")
	}
	waitFor(t, 7*time.Second, func() bool {
		state := stateOfHash(t, a, hash)
		return state.VerifiedComplete && state.LeftZeroAccepted && state.SeededSeconds > 0
	})
	if backupCalls.Load() != 0 {
		t.Fatal("backup tracker was contacted")
	}
	privateTestCall(t, 204, post(t, url+"/pause", nil))
	select {
	case e := <-events:
		if e.event != "stopped" {
			t.Fatalf("pause did not stop the current tracker session: %+v", e)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("pause did not send stopped")
	}
	if !stateOfHash(t, a, hash).LeftZeroAccepted {
		t.Fatal("pause lost a valid acknowledgement")
	}
	live, _ := a.client.Torrent(hash)
	key := metainfo.PieceKey{InfoHash: hash, Index: 0}
	for _, complete := range []bool{false, true} {
		if err := a.completion.Set(key, complete); err != nil {
			t.Fatal(err)
		}
		live.Piece(0).UpdateCompletion()
	}
	// No tracker tick is allowed to reconcile disk state while paused.
	stateAfterRepair := stateOfHash(t, a, hash)
	if !a.session.get(hash).LeftZeroAccepted || !stateAfterRepair.VerifiedComplete || stateAfterRepair.LeftZeroAccepted {
		t.Fatalf("stale acknowledgement survived a lost-and-repaired piece: %+v", stateAfterRepair)
	}
	a.trackers.close(a)
	engine.Close()
	a.client.Close()

	restartDir := t.TempDir()
	copyDir(t, filepath.Join(data, "torrents"), filepath.Join(restartDir, "torrents"))
	restored, secondEngine := newTestEngine(t, restartDir)
	enablePrivateTestTrackers(t, restored)
	restored.restore(context.Background())
	status = stateOfHash(t, restored, hash)
	if !status.AwaitingAdmission || !status.Paused || !status.FullDownload ||
		status.StartAnnounceState != announceAccepted || status.LeftZeroAccepted || status.SeededSeconds == 0 {
		t.Fatalf("private session was not held with its history after restart: %+v", status)
	}
	restored.tickPrivateTrackers()
	privateTestCall(t, 409, post(t, secondEngine.URL+"/torrents/"+hash.HexString()+"/resume", nil))
	select {
	case e := <-events:
		t.Fatalf("restored private session contacted tracker before admission: %+v", e)
	default:
	}
}

func TestPrivateAnnounceAttemptSurvivesTransportFailure(t *testing.T) {
	fx := newFixture(t)
	path := t.TempDir()
	a, engine := newTestEngine(t, path)
	enablePrivateTestTrackers(t, a)
	a.restore(context.Background())

	brokenTracker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			_ = conn.Close()
		}
	}))
	defer brokenTracker.Close()
	raw := encodePrivateTestMeta(t, *fx.meta, false, brokenTracker.URL)
	privateTestCall(t, 200, post(t, engine.URL+"/torrents?private=true&admitted=true", raw))
	hash := fx.meta.HashInfoBytes()
	waitFor(t, 6*time.Second, func() bool {
		state := stateOfHash(t, a, hash)
		return state.TrackerErrorCode != "" && state.StartAnnounceState == announceAttempted
	})

	a.trackers.close(a)
	engine.Close()
	a.client.Close()
	restartDir := t.TempDir()
	copyDir(t, filepath.Join(path, "torrents"), filepath.Join(restartDir, "torrents"))
	restored, _ := newTestEngine(t, restartDir)
	restored.restore(context.Background())
	state := stateOfHash(t, restored, hash)
	if state.StartAnnounceState != announceAttempted || !state.AwaitingAdmission || state.LeftZeroAccepted {
		t.Fatalf("ambiguous announce was lost on restart: %+v", state)
	}
}

func TestKnownPrivateHashCannotBeResolvedAndLatePrivateMagnetIsDropped(t *testing.T) {
	fx := newFixture(t)
	a, engine := newTestEngine(t, t.TempDir())
	body := encodePrivateTestMeta(t, *fx.meta, true)
	meta, err := metainfo.Load(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	hash := meta.HashInfoBytes()
	magnet := []byte(fmt.Sprintf("magnet:?xt=urn:btih:%s", hash.HexString()))

	privateTestCall(t, 504, post(t, engine.URL+"/torrents/resolve?timeout_ms=10", magnet))
	temp, ok := a.client.Torrent(hash)
	if !ok {
		t.Fatal("fixture did not create temporary torrent")
	}
	if err := temp.SetInfoBytes(meta.InfoBytes); err != nil {
		t.Fatal(err)
	}
	waitFor(t, time.Second, func() bool {
		_, exists := a.client.Torrent(hash)
		return !exists && a.private.contains(hash)
	})
	privateTestCall(t, 400, post(t, engine.URL+"/torrents/resolve", magnet))
	privateTestCall(t, 200, post(t, engine.URL+"/torrents", body))
	managed, _ := a.client.Torrent(hash)
	privateTestCall(t, 400, post(t, engine.URL+"/torrents/resolve", magnet))
	if current, _ := a.client.Torrent(hash); current != managed || current == temp {
		t.Fatal("resolve removed managed session")
	}
}

func TestPrivateFullDownloadUsesQueueAndFilePriorities(t *testing.T) {
	public := newNamedFixture(t, "First.mkv", 3<<20)
	private, first, second := newTwoFileFixture(t)
	a, engine := newTestEngine(t, t.TempDir())
	a.restore(context.Background())
	putSettings(t, engine.URL, liveSettings{ConnsPerTorrent: 50, ActiveDownloads: 1})
	privateTestCall(t, 200, post(t, engine.URL+"/torrents?files=0", public.raw))
	time.Sleep(5 * time.Millisecond)
	privateTestCall(t, 200, post(t, engine.URL+"/torrents?files=0&private=true&admitted=true", private.raw))

	hash := private.meta.HashInfoBytes()
	torrentURL := engine.URL + "/torrents/" + hash.HexString()
	added, _ := a.client.Torrent(hash)
	piece := added.Files()[1].BeginPieceIndex() + 1 // beyond the piece shared with E01
	if !stateOfHash(t, a, hash).Queued || added.Piece(piece).State().Priority != torrent.PiecePriorityNone {
		t.Fatal("private full selection bypassed the queue")
	}

	privateTestCall(t, 204, post(t, engine.URL+"/torrents/"+public.meta.HashInfoBytes().HexString()+"/pause", nil))
	waitFor(t, 5*time.Second, func() bool {
		return !stateOfHash(t, a, hash).Queued
	})
	if added.Piece(piece).State().Priority != torrent.PiecePriorityNone {
		t.Fatal("low file was requested before the preferred file completed")
	}
	privateTestCall(t, 204, post(t, torrentURL+"/pause", nil))
	if !stateOfHash(t, a, hash).Paused {
		t.Fatal("pausing a private full selection did not hold it")
	}
	privateTestCall(t, 204, post(t, torrentURL+"/resume", nil))
	if wanted := stateOfHash(t, a, hash).BytesWanted; wanted != int64(len(first)+len(second)) {
		t.Fatalf("private full selection wanted %d bytes", wanted)
	}
}

func TestPrivateSessionMarkerPrecedesMetainfoPublication(t *testing.T) {
	fx := newFixture(t)
	sess, err := newSession(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	hash := fx.meta.HashInfoBytes()
	state := sess.path(hash, ".json")
	if err := os.Mkdir(state, 0700); err != nil {
		t.Fatal(err)
	}

	err = sess.save(fx.meta, func(saved *savedTorrent) { saved.Private = true })
	if err == nil || sess.has(hash) {
		t.Fatal("private metainfo was published despite failing to save the privacy marker")
	}
}

func TestCorruptSessionCannotOpenAsPublic(t *testing.T) {
	fx := newFixture(t)
	a, engine := newTestEngine(t, t.TempDir())
	hash := fx.meta.HashInfoBytes()
	if err := a.session.save(fx.meta, func(saved *savedTorrent) { saved.Private = true }); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(a.session.path(hash, ".json"), []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	a.restore(context.Background())
	if _, ok := a.client.Torrent(hash); ok {
		t.Fatal("corrupt private override was restored as a public session")
	}
	magnet := []byte("magnet:?xt=urn:btih:" + hash.HexString())
	privateTestCall(t, 400, post(t, engine.URL+"/torrents/resolve", magnet))
}

func TestPrivateSeedingPreservesFractionalTimeAcrossTicks(t *testing.T) {
	state := privateAnnounceState{}
	start := time.Now()
	for _, delay := range []time.Duration{0, 999 * time.Millisecond, 2010 * time.Millisecond, 2990 * time.Millisecond, 3010 * time.Millisecond} {
		state.countSeeding(start.Add(delay))
	}
	if state.seconds != 3 || !state.countedAt.Equal(start.Add(3*time.Second)) {
		t.Fatalf("counted %d seconds through %s", state.seconds, state.countedAt.Sub(start))
	}
	resumed := start.Add(10 * time.Minute)
	state.countSeeding(resumed)
	if state.seconds != 3 {
		t.Fatalf("counted idle time before the scheduler resumed: %d seconds", state.seconds)
	}
	state.countSeeding(resumed.Add(time.Second))
	if state.seconds != 4 {
		t.Fatalf("ordinary ticks did not resume counting: %d seconds", state.seconds)
	}
}

func TestPrivateTrackerShutdownRespectsNetworkAvailability(t *testing.T) {
	for _, graceful := range []bool{true, false} {
		t.Run(strconv.FormatBool(graceful), func(t *testing.T) {
			fx := newFixture(t)
			a, engine := newTestEngine(t, t.TempDir())
			enablePrivateTestTrackers(t, a)
			a.restore(context.Background())

			events := make(chan string, 8)
			peerTracker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				events <- r.URL.Query().Get("event")
				_, _ = io.WriteString(w, "d8:intervali60ee")
			}))
			defer peerTracker.Close()
			raw := encodePrivateTestMeta(t, *fx.meta, false, peerTracker.URL)
			privateTestCall(t, 200, post(t, engine.URL+"/torrents?private=true&admitted=true", raw))
			select {
			case event := <-events:
				if event != "started" {
					t.Fatalf("unexpected initial event %q", event)
				}
			case <-time.After(7 * time.Second):
				t.Fatal("no started event")
			}
			a.trackers.close(a, graceful)
			select {
			case event := <-events:
				if !graceful || event != "stopped" {
					t.Fatalf("unexpected shutdown event %q", event)
				}
			default:
				if graceful {
					t.Fatal("healthy shutdown did not send stopped")
				}
			}
		})
	}
}
