package main

import (
	"bytes"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/anacrolix/dht/v2"
	"github.com/anacrolix/dht/v2/krpc"
	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	pp "github.com/anacrolix/torrent/peer_protocol"
	"github.com/anacrolix/torrent/types/infohash-v2"
)

var (
	errPrivateMagnet          = errors.New("private torrents require a metainfo file")
	errTorrentSessionConflict = errors.New("torrent hash belongs to another tracker session")
	errTorrentV2Unsupported   = errors.New("v2-only torrents are unsupported")
)

type privateRegistry struct {
	hashes sync.Map
	// The v1 and v2 aliases can be addressed by different requests.
	addMu sync.Mutex
}

func (r *privateRegistry) contains(hash metainfo.Hash) bool {
	_, ok := r.hashes.Load(hash)
	return ok
}

func (r *privateRegistry) registerMeta(mi *metainfo.MetaInfo) {
	r.hashes.Store(mi.HashInfoBytes(), struct{}{})
	if info, err := mi.UnmarshalInfo(); err == nil && info.HasV2() {
		hash := infohash_v2.HashBytes(mi.InfoBytes)
		r.hashes.Store(*hash.ToShort(), struct{}{})
	}
}

func privateInfo(info *metainfo.Info) bool {
	return info != nil && info.Private != nil && *info.Private
}

func primaryTrackerOf(mi *metainfo.MetaInfo) string {
	for _, tier := range mi.UpvertedAnnounceList() {
		for _, endpoint := range tier {
			if endpoint != "" {
				// Keep the escaped path and query unchanged, including the user's passkey.
				u, err := url.Parse(endpoint)
				if err == nil && u.Host != "" {
					u.Host = strings.ToLower(u.Host)
					u.Fragment = ""
					return u.String()
				}
				return endpoint
			}
		}
	}
	return ""
}

func (r *privateRegistry) configure(cfg *torrent.ClientConfig) {
	// Install our own wrapper on each DHT socket, including bound sockets.
	cfg.NoDHT = true
	onQuery := cfg.DHTOnQuery
	cfg.DHTOnQuery = func(query *krpc.Msg, source net.Addr) bool {
		if query.A != nil && (query.Q == "get_peers" || query.Q == "announce_peer") &&
			r.contains(metainfo.Hash(query.A.InfoHash)) {
			return false
		}
		return onQuery == nil || onQuery(query, source)
	}

	callbacks := &cfg.Callbacks
	extensions := &torrent.LocalLtepProtocolMap{
		Index:      []pp.ExtensionName{pp.ExtensionNameMetadata},
		NumBuiltin: 1,
	}
	isPrivate := func(peer *torrent.PeerConn) bool {
		t := peer.Torrent()
		return t != nil && r.contains(t.InfoHash())
	}

	callbacks.PeerConnAdded = append(callbacks.PeerConnAdded, func(peer *torrent.PeerConn) {
		if isPrivate(peer) {
			peer.LocalLtepProtocolMap = extensions
		}
	})
	callbacks.ReadExtendedHandshake = func(peer *torrent.PeerConn, hello *pp.ExtendedHandshakeMessage) {
		if isPrivate(peer) {
			delete(hello.M, pp.ExtensionNamePex)
			delete(hello.M, "ut_holepunch")
			delete(peer.PeerExtensionIDs, pp.ExtensionNamePex)
			delete(peer.PeerExtensionIDs, "ut_holepunch")
		}
	}
	callbacks.CompletedHandshake = func(peer *torrent.PeerConn, hash metainfo.Hash) {
		if r.contains(hash) {
			peer.PeerExtensionBytes.SetBit(pp.ExtensionBitDht, false)
		}
	}
	callbacks.ReadMessage = func(peer *torrent.PeerConn, msg *pp.Message) {
		if msg.Type == pp.Port && isPrivate(peer) {
			*msg = pp.Message{Keepalive: true}
		}
	}
}

type privateDHTServer struct {
	torrent.AnacrolixDhtServerWrapper
	registry *privateRegistry
}

type noDHTAnnounce struct{}

func (noDHTAnnounce) Close() {}

var noDHTPeers = func() <-chan dht.PeersValues {
	ch := make(chan dht.PeersValues)
	close(ch)
	return ch
}()

func (noDHTAnnounce) Peers() <-chan dht.PeersValues { return noDHTPeers }

func (s privateDHTServer) Announce(hash [20]byte, port int, impliedPort bool) (torrent.DhtAnnounce, error) {
	if s.registry.contains(hash) {
		return noDHTAnnounce{}, nil
	}
	return s.AnacrolixDhtServerWrapper.Announce(hash, port, impliedPort)
}

func (r *privateRegistry) attachDHT(client *torrent.Client, conn net.PacketConn) error {
	server, err := client.NewAnacrolixDhtServer(conn)
	if err != nil {
		return err
	}
	client.AddDhtServer(privateDHTServer{torrent.AnacrolixDhtServerWrapper{Server: server}, r})
	go func() {
		<-client.Closed()
		server.Close()
	}()
	return nil
}

func (r *privateRegistry) loadSessions(restored []restoredTorrent, maintenance *maintenanceFences) {
	for _, item := range restored {
		if info, err := item.meta.UnmarshalInfo(); item.blocked || err == nil && (item.saved.Private || privateInfo(&info)) {
			r.registerMeta(item.meta)
		}
	}
	maintenance.mu.Lock()
	defer maintenance.mu.Unlock()
	for _, fence := range maintenance.fences {
		if fence.RestoreSession == nil {
			continue
		}
		mi, err := metainfo.Load(bytes.NewReader(fence.RestoreMeta))
		if err != nil {
			continue
		}
		if info, err := mi.UnmarshalInfo(); err == nil && (fence.RestoreSession.Private || privateInfo(&info)) {
			r.registerMeta(mi)
		}
	}
}

// Do not let AddTorrentSpec merge a new peer source into a private incarnation.
// Callers own the storage operation lock for the canonical hash.
func (a *api) addChecked(spec *torrent.TorrentSpec, meta *metainfo.MetaInfo, private bool) (*torrent.Torrent, bool, error) {
	if spec.InfoHash == (metainfo.Hash{}) {
		return nil, false, errTorrentV2Unsupported
	}
	a.private.addMu.Lock()
	defer a.private.addMu.Unlock()

	hashes := []metainfo.Hash{spec.InfoHash}
	if spec.InfoHashV2.Ok {
		hashes = append(hashes, *spec.InfoHashV2.Value.ToShort())
	}
	for _, hash := range hashes {
		if a.private.contains(hash) || a.session.get(hash).Private {
			if meta == nil {
				return nil, false, errPrivateMagnet
			}
			if !private {
				return nil, false, errTorrentSessionConflict
			}
		}
	}
	endpoint := ""
	if private {
		endpoint = primaryTrackerOf(meta)
	}
	if private && a.session.has(spec.InfoHash) {
		old, err := metainfo.LoadFromFile(a.session.path(spec.InfoHash, ".torrent"))
		if err != nil || primaryTrackerOf(old) != endpoint {
			return nil, false, errTorrentSessionConflict
		}
	}
	for _, hash := range hashes {
		existing, ok := a.client.Torrent(hash)
		if !ok {
			continue
		}
		if meta == nil {
			if privateInfo(existing.Info()) {
				return nil, false, errPrivateMagnet
			}
			return existing, false, nil
		}
		actual, isPrivate := a.privateEndpoints.Load(existing)
		if private || isPrivate {
			if !private || !isPrivate || endpoint != actual || existing.InfoHash() != spec.InfoHash {
				return nil, false, errTorrentSessionConflict
			}
			return existing, false, nil
		}
	}
	if private {
		a.private.registerMeta(meta)
		spec.DhtNodes, spec.Webseeds, spec.Sources, spec.PeerAddrs, spec.Trackers = nil, nil, nil, nil, nil
	}
	t, created, err := a.client.AddTorrentSpec(spec)
	if err == nil && private {
		a.privateEndpoints.Store(t, endpoint)
	}
	return t, created, err
}

// Follow a temporary torrent to GotInfo even if the HTTP waiter timed out.
func (a *api) watchPrivateMagnet(t *torrent.Torrent) {
	select {
	case <-t.GotInfo():
	case <-t.Closed():
		return
	}
	if !privateInfo(t.Info()) {
		return
	}
	unlock := a.ownership.operation(t.InfoHash())
	defer unlock()
	a.rejectPrivateMagnet(t)
}

func (a *api) rejectPrivateMagnet(t *torrent.Torrent) {
	hash := t.InfoHash()
	mi := t.Metainfo()
	a.private.registerMeta(&mi)
	owner, _ := a.metadataOnly.Load(hash)
	current, _ := a.client.Torrent(hash)
	if owner == t && current == t {
		a.metadataOnly.Delete(hash)
		t.Drop()
	}
}

func writeAddError(w http.ResponseWriter, kind string, err error) {
	switch {
	case errors.Is(err, errPrivateMagnet):
		writeError(w, 400, "private_magnet_unsupported", err)
	case errors.Is(err, errTorrentSessionConflict):
		writeError(w, 409, "torrent_session_conflict", err)
	case errors.Is(err, errTorrentV2Unsupported):
		writeError(w, 400, "torrent_v2_unsupported", err)
	default:
		writeError(w, 400, kind, err)
	}
}
