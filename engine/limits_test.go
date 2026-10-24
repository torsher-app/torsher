package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"golang.org/x/time/rate"
)

// Лимиты в тестах — сотни килобайт: запас ограничителей уменьшен, иначе
// мегабайт по умолчанию проглотил бы раздачу целиком
func smallBurst(t *testing.T) {
	t.Helper()

	burst := minLimiterBurst
	minLimiterBurst = 64 << 10
	t.Cleanup(func() { minLimiterBurst = burst })
}

func putSettings(t *testing.T, url string, settings liveSettings) {
	t.Helper()

	response := put(t, url+"/settings", fmt.Sprintf(
		`{"downloadLimit":%d,"uploadLimit":%d,"connsPerTorrent":%d,"connsTotal":%d,"activeDownloads":%d}`,
		settings.DownloadLimit, settings.UploadLimit, settings.ConnsPerTorrent, settings.ConnsTotal, settings.ActiveDownloads,
	))
	response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("settings: status %d", response.StatusCode)
	}
}

func bytesOf(engine *api, hash torrent.InfoHash) int64 {
	added, _ := engine.client.Torrent(hash)

	return added.BytesCompleted()
}

func TestDownloadLimitWithoutStream(t *testing.T) {
	smallBurst(t)

	const limit = 512 << 10

	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	putSettings(t, server.URL, liveSettings{DownloadLimit: limit, ConnsPerTorrent: 50})

	start := time.Now()
	hash := downloadFixture(t, engine, server, fx)

	time.Sleep(2 * time.Second)

	got := bytesOf(engine, hash)
	allowed := int64(minLimiterBurst) + int64(time.Since(start).Seconds()*limit) + 256<<10

	if got == 0 || got > allowed {
		t.Fatalf("downloaded %d bytes in %v, allowed at most %d", got, time.Since(start), allowed)
	}
}

// Просмотр лимит загрузки не учитывает: поток читает раздачу быстрее лимита,
// а выбранный файл другой раздачи привратник держит
func TestStreamBypassesDownloadLimit(t *testing.T) {
	smallBurst(t)

	const limit = 128 << 10

	background := newNamedFixture(t, "Background.mkv", 16<<20)
	watched := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	engine.restore(context.Background())
	putSettings(t, server.URL, liveSettings{DownloadLimit: limit, ConnsPerTorrent: 50})

	backgroundHash := downloadFixture(t, engine, server, background)

	post(t, server.URL+"/torrents", watched.raw).Body.Close()
	stream, _ := engine.client.Torrent(watched.meta.HashInfoBytes())
	stream.AddClientPeer(watched.seeder)
	file := stream.Files()[0]

	reader := engine.windows.open(stream, file, newStreamReader(context.Background(), file), file.Length())
	defer reader.Close()

	if engine.limits.download.Limit() != rate.Inf {
		t.Fatal("an open stream must lift the library limiter")
	}

	start := time.Now()
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	elapsed := time.Since(start)

	if len(data) != len(watched.content) {
		t.Fatalf("stream read %d of %d bytes", len(data), len(watched.content))
	}

	// По лимиту файл читался бы 24 с
	if elapsed > 6*time.Second {
		t.Fatalf("stream took %v: it must not wait for the download limit", elapsed)
	}

	waitFor(t, 5*time.Second, engine.limits.isHeld)

	added, _ := engine.client.Torrent(backgroundHash)
	waitFor(t, 5*time.Second, func() bool {
		return added.Files()[0].Priority() == torrent.PiecePriorityNone
	})

	before := bytesOf(engine, backgroundHash)
	time.Sleep(time.Second)
	after := bytesOf(engine, backgroundHash)

	if after == int64(len(background.content)) {
		t.Fatal("the background file downloaded without a limit")
	}

	if after-before > 1<<20 {
		t.Fatalf("held background file still downloaded %d bytes", after-before)
	}

	reader.Close()

	waitFor(t, 5*time.Second, func() bool { return !engine.limits.isHeld() })

	if engine.limits.download.Limit() != limitOf(limit) {
		t.Fatal("the library limiter must return when the last stream closes")
	}
}

func TestQueueWaitsForActiveDownload(t *testing.T) {
	smallBurst(t)

	first := newNamedFixture(t, "First.mkv", 3<<20)
	second := newNamedFixture(t, "Second.mkv", 3<<20)
	engine, server := newTestEngine(t, t.TempDir())
	engine.restore(context.Background())
	// Лимит держит первую раздачу недокачанной, пока проверяется очередь
	putSettings(t, server.URL, liveSettings{DownloadLimit: 128 << 10, ConnsPerTorrent: 50, ActiveDownloads: 1})

	firstHash := downloadFixture(t, engine, server, first)
	time.Sleep(5 * time.Millisecond)
	secondHash := downloadFixture(t, engine, server, second)

	if stateOfHash(t, engine, firstHash).Queued || !stateOfHash(t, engine, secondHash).Queued {
		t.Fatal("the second download must wait for the first")
	}

	time.Sleep(time.Second)

	if got := bytesOf(engine, secondHash); got != 0 {
		t.Fatalf("queued download got %d bytes", got)
	}

	// Поток раздачи в очереди читается: окну очередь не мешает
	queued, _ := engine.client.Torrent(secondHash)
	file := queued.Files()[0]
	reader := engine.windows.open(queued, file, newStreamReader(context.Background(), file), 0)
	if _, err := io.ReadFull(reader, make([]byte, 4096)); err != nil {
		t.Fatal(err)
	}
	reader.Close()

	putSettings(t, server.URL, liveSettings{ConnsPerTorrent: 50})

	if stateOfHash(t, engine, secondHash).Queued {
		t.Fatal("without a queue nothing waits")
	}

	waitFor(t, 30*time.Second, func() bool {
		return stateOfHash(t, engine, secondHash).WantedCompleted == int64(len(second.content))
	})
}

// Раздачу, которой ничего не нужно, с `seed: false` движок не раздаёт;
// отданное за всё время переживает перезапуск
func TestSeedFlagAndUploadedSurviveRestart(t *testing.T) {
	fx := newFixture(t)
	dataDir := t.TempDir()
	engine, server := newTestEngine(t, dataDir)
	engine.restore(context.Background())
	hash := downloadFixture(t, engine, server, fx)

	waitFor(t, 30*time.Second, func() bool {
		return stateOfHash(t, engine, hash).WantedCompleted == int64(len(fx.content))
	})
	fx.seeder.Close()

	response := put(t, server.URL+"/torrents/"+hash.HexString()+"/seed", `{"seed":false}`)
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("seed: status %d", response.StatusCode)
	}

	if stateOfHash(t, engine, hash).Seeding {
		t.Fatal("a finished torrent with seed off must not seed")
	}

	leecher := newLeecher(t, fx)
	leecher.AddClientPeer(engine.client)
	time.Sleep(time.Second)

	if leecher.BytesCompleted() != 0 {
		t.Fatalf("leecher got %d bytes from a torrent that must not seed", leecher.BytesCompleted())
	}

	put(t, server.URL+"/torrents/"+hash.HexString()+"/seed", `{"seed":true}`).Body.Close()
	// Соединение, по которому не отдавали, библиотека могла закрыть
	leecher.AddClientPeer(engine.client)
	waitFor(t, 30*time.Second, func() bool { return leecher.BytesMissing() == 0 })

	uploaded := stateOfHash(t, engine, hash).Uploaded
	if uploaded < int64(len(fx.content)) {
		t.Fatalf("uploaded %d, want at least %d", uploaded, len(fx.content))
	}

	engine.flushAllUploaded()

	restartDir := t.TempDir()
	copyDir(t, dataDir+"/torrents", restartDir+"/torrents")
	restarted, _ := newTestEngine(t, restartDir)
	restarted.restore(context.Background())

	if got := stateOfHash(t, restarted, hash).Uploaded; got != uploaded {
		t.Fatalf("uploaded after restart %d, want %d", got, uploaded)
	}
}

func newLeecher(t *testing.T, fx fixture) *torrent.Torrent {
	t.Helper()

	cfg := torrent.NewDefaultClientConfig()
	offline(cfg)
	cfg.DataDir = t.TempDir()

	client, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })

	lt, err := client.AddTorrent(fx.meta)
	if err != nil {
		t.Fatal(err)
	}
	lt.DownloadAll()

	return lt
}

func TestUploadLimit(t *testing.T) {
	smallBurst(t)

	const limit = 256 << 10

	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	hash := downloadFixture(t, engine, server, fx)

	waitFor(t, 30*time.Second, func() bool {
		return stateOfHash(t, engine, hash).WantedCompleted == int64(len(fx.content))
	})
	fx.seeder.Close()

	putSettings(t, server.URL, liveSettings{UploadLimit: limit, ConnsPerTorrent: 50})

	leecher := newLeecher(t, fx)
	start := time.Now()
	leecher.AddClientPeer(engine.client)
	time.Sleep(2 * time.Second)

	got := leecher.BytesCompleted()
	allowed := int64(minLimiterBurst) + int64(time.Since(start).Seconds()*limit) + 256<<10

	if got == 0 || got > allowed {
		t.Fatalf("uploaded %d bytes in %v, allowed at most %d", got, time.Since(start), allowed)
	}
}

func TestInvalidSettingsAreRejected(t *testing.T) {
	_, server := newTestEngine(t, t.TempDir())

	for _, body := range []string{
		`{"downloadLimit":-1,"connsPerTorrent":50}`,
		`{"connsPerTorrent":0}`,
		`not json`,
	} {
		response := put(t, server.URL+"/settings", body)
		response.Body.Close()

		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: status %d", body, response.StatusCode)
		}
	}
}

func TestConnCaps(t *testing.T) {
	for _, tc := range []struct {
		name       string
		per, total int
		streamed   []bool
		want       []int
	}{
		{"no total", 50, 0, []bool{false, false}, []int{50, 50}},
		{"fits", 50, 200, []bool{false, false}, []int{50, 50}},
		{"shared", 50, 200, []bool{false, false, false, false, false, false, false, false}, []int{25, 25, 25, 25, 25, 25, 25, 25}},
		{"stream first", 50, 100, []bool{true, false, false, false, false}, []int{50, 12, 12, 12, 12}},
		{"floor", 50, 10, []bool{false, false, false, false, false, false, false, false, false, false, false, false}, []int{2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2}},
		{"stream over total", 50, 20, []bool{true, false}, []int{50, 2}},
	} {
		if got := connCaps(tc.per, tc.total, tc.streamed); !slices.Equal(got, tc.want) {
			t.Errorf("%s: %v, want %v", tc.name, got, tc.want)
		}
	}
}
