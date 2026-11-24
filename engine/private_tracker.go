package main

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"net"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/tracker"
)

const (
	announceNotSent     = "not_sent"
	announceAttempted   = "attempted"
	announceAccepted    = "accepted"
	privateTrackerRetry = time.Minute
	privateSeedFlush    = time.Minute
)

type privateTrackerManager struct {
	ctx      context.Context
	cancel   context.CancelFunc
	dial     func(context.Context, string, string) (net.Conn, error)
	port     uint16
	key      int32
	mu       sync.Mutex
	active   map[*torrent.Torrent]*privateAnnounceState
	acks     map[*torrent.Torrent]<-chan struct{}
	stopping map[metainfo.Hash]struct{}
	workers  sync.WaitGroup
}

type privateAnnounceState struct {
	client     *privateAnnouncer
	code       trackerErrorCode
	next       time.Time
	success    time.Time
	interval   time.Duration
	seconds    int64
	countedAt  time.Time
	observedAt time.Time
	flushed    time.Time
	started    bool
	attempted  bool
	incomplete bool
	completed  bool
	cancel     context.CancelFunc
	pending    <-chan privateAnnounceResult
}

type privateAnnounceResult struct {
	response    tracker.AnnounceResponse
	code        trackerErrorCode
	event       tracker.AnnounceEvent
	leftZeroOff <-chan struct{}
}

func newPrivateTrackerManager(ctx context.Context, dial func(context.Context, string, string) (net.Conn, error), port int) *privateTrackerManager {
	ctx, cancel := context.WithCancel(ctx)
	var key [4]byte
	_, _ = rand.Read(key[:])
	return &privateTrackerManager{
		ctx: ctx, cancel: cancel, dial: dial, port: uint16(port), key: int32(binary.BigEndian.Uint32(key[:])),
		active: make(map[*torrent.Torrent]*privateAnnounceState), stopping: make(map[metainfo.Hash]struct{}),
		acks: make(map[*torrent.Torrent]<-chan struct{}),
	}
}

func (m *privateTrackerManager) status(t *torrent.Torrent, seconds int64) (int64, trackerErrorCode, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ack := m.acks[t]
	accepted := ack != nil && !flagClosed(ack)
	if state := m.active[t]; state != nil {
		return max(seconds, state.seconds), state.code, accepted
	}
	return seconds, "", accepted
}

func (m *privateTrackerManager) request(a *api, t *torrent.Torrent, event tracker.AnnounceEvent, complete bool) tracker.AnnounceRequest {
	stats := t.Stats()
	var left int64
	if !complete {
		// BytesMissing includes unverified data near the end of a piece.
		left = max(1, t.BytesMissing())
	}
	want := int32(200)
	if event == tracker.Stopped {
		want = 0
	}
	return tracker.AnnounceRequest{
		InfoHash: t.InfoHash(), PeerId: a.client.PeerID(), Port: m.port, Key: m.key, Event: event, NumWant: want,
		Left: left, Uploaded: stats.BytesWrittenData.Int64(), Downloaded: stats.BytesReadUsefulData.Int64(),
	}
}

func (a *api) tickPrivateTrackers() {
	if a.trackers == nil || a.networkOffline {
		return
	}
	now := time.Now()
	for _, t := range a.client.Torrents() {
		endpoint, ok := a.privateEndpoints.Load(t)
		if !ok || t.Info() == nil {
			continue
		}
		hash := t.InfoHash()
		unlock, locked := a.ownership.tryOperation(hash)
		if !locked {
			continue
		}
		current, _ := a.client.Torrent(hash)
		saved, known := a.session.lookup(hash)
		if current == t && known && saved.Private && !saved.paused() &&
			!a.isMoving(hash) && !a.maintenanceBlocked(hash, nil) {
			if t.Complete().Bool() && !t.Seeding() {
				a.stopPrivateTracker(t)
			} else {
				a.trackers.advance(a, t, endpoint.(string), saved, now)
			}
		}
		unlock()
	}
}

// Caller owns the hash operation. A network worker only returns a result.
// Changes to a session and imported peers are applied by this method.
func (m *privateTrackerManager) advance(a *api, t *torrent.Torrent, endpoint string, saved savedTorrent, now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ctx.Err() != nil {
		return
	}
	hash := t.InfoHash()
	if _, stopping := m.stopping[hash]; stopping {
		return
	}
	state := m.active[t]
	if state == nil {
		if (a.sched.isQueued(hash) || a.limits.isHeld()) && !a.windows.streaming(hash) {
			return
		}
		state = &privateAnnounceState{seconds: saved.SeededSeconds, flushed: now}
		m.active[t] = state
	}
	complete := t.Complete().Bool()
	if !complete {
		state.incomplete = true
		state.completed = false
	}
	if ack := m.acks[t]; saved.LeftZeroAccepted && (!complete || ack == nil || flagClosed(ack)) {
		if err := a.session.updateAnnouncement(hash, func(s *savedTorrent) { s.LeftZeroAccepted = false }); err != nil {
			state.code = "storage"
			return
		}
		saved.LeftZeroAccepted = false
		delete(m.acks, t)
		state.completed = false
	}

	if state.pending != nil {
		select {
		case result := <-state.pending:
			state.pending = nil
			state.cancel()
			state.cancel = nil
			if result.code != "" {
				state.code = result.code
				state.next = now.Add(privateTrackerRetry)
				state.countedAt = time.Time{}
			} else {
				leftZero := result.leftZeroOff != nil && complete && !flagClosed(result.leftZeroOff)
				if result.event == tracker.Started || leftZero {
					if err := a.session.updateAnnouncement(hash, func(s *savedTorrent) {
						if result.event == tracker.Started {
							s.StartAnnounceState = announceAccepted
						}
						if leftZero {
							s.LeftZeroAccepted = true
						}
					}); err != nil {
						state.code = "storage"
						state.next = now.Add(privateTrackerRetry)
						return
					}
				}
				state.code = ""
				state.started = true
				state.success = now
				state.interval = max(time.Second, time.Duration(result.response.Interval)*time.Second)
				state.next = now.Add(state.interval)
				if leftZero {
					saved.LeftZeroAccepted = true
					m.acks[t] = result.leftZeroOff
					state.completed = state.completed || result.event == tracker.Completed
				}
				m.addPeers(t, result.response.Peers)
			}
		default:
		}
	}

	if complete && saved.LeftZeroAccepted && !flagClosed(m.acks[t]) && t.Seeding() &&
		state.started && state.code == "" && now.Sub(state.success) <= max(2*state.interval, 15*time.Minute) {
		state.countSeeding(now)
	} else {
		state.countedAt = time.Time{}
	}
	if state.seconds > saved.SeededSeconds && now.Sub(state.flushed) >= privateSeedFlush {
		state.flushed = now
		m.flushSeconds(a, t, state)
	}
	if state.pending != nil {
		return
	}

	event := tracker.None
	if !state.started {
		event = tracker.Started
	} else if complete && state.incomplete && !state.completed {
		event = tracker.Completed
	}
	// The completion event does not have to wait for the next regular interval,
	// but an actual tracker failure is always subject to retry delay.
	if now.Before(state.next) && (event != tracker.Completed || state.code != "") {
		return
	}
	if state.client == nil {
		var code trackerErrorCode
		state.client, code = newPrivateAnnouncer(endpoint, m.dial)
		if code != "" {
			state.code = code
			state.next = now.Add(privateTrackerRetry)
			return
		}
	}
	if event == tracker.Started {
		if err := a.session.updateAnnouncement(hash, func(s *savedTorrent) {
			if s.StartAnnounceState != announceAccepted {
				s.StartAnnounceState = announceAttempted
			}
		}); err != nil {
			state.code = "storage"
			state.next = now.Add(privateTrackerRetry)
			return
		}
		state.attempted = true
	}
	var off <-chan struct{}
	if complete {
		off = t.Complete().Off()
		complete = !flagClosed(off)
		if !complete {
			off = nil
			if event == tracker.Completed {
				return
			}
		}
	}
	req := m.request(a, t, event, complete)
	ctx, cancel := context.WithTimeout(m.ctx, tracker.DefaultTrackerAnnounceTimeout)
	pending := make(chan privateAnnounceResult, 1)
	state.pending, state.cancel = pending, cancel
	client := state.client
	m.workers.Add(1)
	go func() {
		defer m.workers.Done()
		defer cancel()
		resp, code := client.announce(ctx, req)
		pending <- privateAnnounceResult{response: resp, code: code, event: event, leftZeroOff: off}
	}()
}

func (s *privateAnnounceState) countSeeding(now time.Time) {
	// Small scheduler jitter keeps its fractional progress. A missed run can
	// mean the process was suspended, so do not count the unobserved gap.
	if s.countedAt.IsZero() || now.Sub(s.observedAt) > 2*scheduleInterval {
		s.countedAt = now
	}
	s.observedAt = now
	whole := now.Sub(s.countedAt) / time.Second
	s.seconds += int64(whole)
	s.countedAt = s.countedAt.Add(whole * time.Second)
}

func flagClosed(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

func (m *privateTrackerManager) addPeers(t *torrent.Torrent, peers []tracker.Peer) {
	valid := make([]torrent.PeerInfo, 0, len(peers))
	for _, peer := range peers {
		if peer.Port < 1 || peer.Port > 65535 || peer.IP.To16() == nil || peer.IP.IsUnspecified() || peer.IP.IsMulticast() {
			continue
		}
		var id [20]byte
		copy(id[:], peer.ID)
		valid = append(valid, torrent.PeerInfo{
			Addr: &net.TCPAddr{IP: peer.IP, Port: peer.Port}, Id: id, Source: torrent.PeerSourceTracker,
		})
	}
	if len(valid) != 0 {
		t.AddPeers(valid)
	}
}

func (m *privateTrackerManager) flushSeconds(a *api, t *torrent.Torrent, state *privateAnnounceState) {
	if state.seconds <= 0 {
		return
	}
	hash := t.InfoHash()
	if err := a.session.update(hash, func(s *savedTorrent) {
		s.SeededSeconds = max(s.SeededSeconds, state.seconds)
	}); err != nil {
		a.logger.Warn("save private seed time", "infoHash", hash.HexString(), "err", err)
	}
}

func (a *api) stopPrivateTracker(t *torrent.Torrent) {
	if a.trackers != nil {
		a.trackers.stop(a, t)
	}
}

func (a *api) dropPrivateTracker(t *torrent.Torrent) {
	a.stopPrivateTracker(t)
	if a.trackers != nil {
		a.trackers.mu.Lock()
		delete(a.trackers.acks, t)
		a.trackers.mu.Unlock()
	}
	a.privateEndpoints.Delete(t)
}

// Cancel the current request, then stop that tracker session before a new
// incarnation with the same hash can announce. No network I/O under locks.
func (m *privateTrackerManager) stop(a *api, t *torrent.Torrent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state := m.active[t]
	if state == nil || m.ctx.Err() != nil {
		return
	}
	delete(m.active, t)
	m.flushSeconds(a, t, state)
	if state.cancel != nil {
		state.cancel()
	}
	if state.client == nil {
		return
	}
	hash := t.InfoHash()
	m.stopping[hash] = struct{}{}
	req := m.request(a, t, tracker.Stopped, t.Complete().Bool())
	m.workers.Add(1)
	go func() {
		defer m.workers.Done()
		defer func() {
			state.client.close()
			m.mu.Lock()
			delete(m.stopping, hash)
			m.mu.Unlock()
		}()
		if state.pending != nil {
			<-state.pending
		}
		if state.attempted && m.ctx.Err() == nil {
			ctx, cancel := context.WithTimeout(m.ctx, 2*time.Second)
			defer cancel()
			_, _ = state.client.announce(ctx, req)
		}
	}()
}

func (m *privateTrackerManager) close(a *api, graceful ...bool) {
	m.mu.Lock()
	m.cancel()
	active := m.active
	m.active = nil
	clear(m.acks)
	m.mu.Unlock()
	m.workers.Wait()

	type stopRequest struct {
		client  *privateAnnouncer
		request tracker.AnnounceRequest
	}
	var stops []stopRequest
	for t, state := range active {
		m.flushSeconds(a, t, state)
		if state.client == nil {
			continue
		}
		if len(graceful) != 0 && graceful[0] && state.attempted && !flagClosed(t.Closed()) {
			stops = append(stops, stopRequest{state.client, m.request(a, t, tracker.Stopped, t.Complete().Bool())})
		} else {
			state.client.close()
		}
	}
	if len(stops) == 0 {
		return
	}

	// The normal request context is already cancelled. Use the same transport
	// for a bounded best-effort stopped while the chosen interface is alive.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var stopping sync.WaitGroup
	const workers = 8
	for index := range min(workers, len(stops)) {
		stopping.Add(1)
		go func() {
			defer stopping.Done()
			for i := index; i < len(stops); i += workers {
				stop := stops[i]
				if ctx.Err() == nil {
					_, _ = stop.client.announce(ctx, stop.request)
				}
				stop.client.close()
			}
		}()
	}
	stopping.Wait()
}
