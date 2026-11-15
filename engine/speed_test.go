package main

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestDownloadSpeedMeasurementAvailability(t *testing.T) {
	fx := newNamedFixture(t, "Synthetic.speed.mkv", 256<<10)
	engine, server := newTestEngine(t, t.TempDir())
	hash := fx.meta.HashInfoBytes()
	seed, _ := fx.seeder.Torrent(hash)
	waitFor(t, 5*time.Second, func() bool { return seed.PieceState(0).Complete })
	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()
	added, _ := engine.client.Torrent(hash)
	measured := func(want bool) {
		t.Helper()
		body, err := json.Marshal(engine.stateOf(added))
		if err != nil {
			t.Fatal(err)
		}
		var response map[string]any
		if err := json.Unmarshal(body, &response); err != nil {
			t.Fatal(err)
		}
		if response["downloadSpeedMeasured"] != want {
			t.Fatalf("downloadSpeedMeasured = %v, want %v", response["downloadSpeedMeasured"], want)
		}
	}
	measured(false)
	now := time.Unix(1_000, 0)
	engine.speeds.sample(now, engine.client.Torrents())
	measured(false)
	engine.speeds.sample(now.Add(time.Second), engine.client.Torrents())
	measured(true)
	if got := engine.stateOf(added).DownloadSpeed; got != 0 {
		t.Fatalf("measured idle speed = %d", got)
	}
	added.AddClientPeer(fx.seeder)
	readRange(t, fmt.Sprintf("%s/torrents/%s/files/0/stream", server.URL, hash.HexString()), 0, 256<<10)
	waitFor(t, 5*time.Second, func() bool { return added.PieceState(0).Complete })
	engine.speeds.sample(now.Add(2*time.Second), engine.client.Torrents())
	measured(true)
	if got := engine.stateOf(added).DownloadSpeed; got <= 0 {
		t.Fatalf("measured download speed = %d", got)
	}
	previous := added
	engine.metadataOnly.Store(hash, true)
	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()
	added, _ = engine.client.Torrent(hash)
	if added == previous {
		t.Fatal("same-hash torrent was not reopened")
	}
	// No sampler tick with an empty torrent list occurs between generations.
	measured(false)
	engine.speeds.sample(now.Add(3*time.Second), engine.client.Torrents())
	measured(false)
	engine.speeds.sample(now.Add(4*time.Second), engine.client.Torrents())
	measured(true)
	if got := engine.stateOf(added).DownloadSpeed; got != 0 {
		t.Fatalf("new generation inherited previous bytes: %d", got)
	}
	engine.speeds.sample(now.Add(5*time.Second), nil)
	measured(false)
}
