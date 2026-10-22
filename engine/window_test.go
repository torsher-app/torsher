package main

import (
	"context"
	"io"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
)

// Раздача добавлена без выбора и подключена к сидеру: качают только потоки
func streamFixture(t *testing.T) (*api, *torrent.Torrent, fixture) {
	t.Helper()

	// Окна в куски, а не в мегабайты: раздача в тестах — 13 кусков по 256 КиБ
	readahead := streamReadahead
	streamReadahead = 256 << 10
	t.Cleanup(func() { streamReadahead = readahead })

	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())

	if response := post(t, server.URL+"/torrents", fx.raw); response.StatusCode != 200 {
		t.Fatalf("add: status %d", response.StatusCode)
	}

	added, _ := engine.client.Torrent(fx.meta.HashInfoBytes())
	added.AddClientPeer(fx.seeder)

	return engine, added, fx
}

func completePieces(added *torrent.Torrent) (count int, last int) {
	last = -1
	for index := range added.NumPieces() {
		if added.Piece(index).State().Complete {
			count++
			last = index
		}
	}

	return count, last
}

func TestStreamDownloadsOnlyTheWindowAhead(t *testing.T) {
	engine, added, fx := streamFixture(t)
	file := added.Files()[0]
	pieceLength := added.Info().PieceLength

	reader := engine.windows.open(added, file, newStreamReader(context.Background(), file), 2*pieceLength)

	buf := make([]byte, 1000)
	if _, err := io.ReadFull(reader, buf); err != nil {
		t.Fatal(err)
	}

	// Окно — куски 0 и 1, readahead — тоже; больше качать нечего
	waitFor(t, 30*time.Second, func() bool {
		count, _ := completePieces(added)
		return count >= 2
	})
	time.Sleep(2 * windowRefresh)

	if count, last := completePieces(added); last > 2 {
		t.Fatalf("downloaded beyond the window: %d pieces, last %d", count, last)
	}

	// Позиция ушла вперёд — окно за ней
	if _, err := reader.Seek(8*pieceLength, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(reader, buf); err != nil {
		t.Fatal(err)
	}

	waitFor(t, 30*time.Second, func() bool {
		return added.Piece(9).State().Complete
	})
	time.Sleep(2 * windowRefresh)

	if _, last := completePieces(added); last > 10 {
		t.Fatalf("downloaded beyond the moved window: last piece %d of %d", last, added.NumPieces())
	}

	if file.BytesCompleted() >= int64(len(fx.content)) {
		t.Fatal("the whole file was downloaded by a stream")
	}
}

func TestClosedStreamStopsDownloading(t *testing.T) {
	engine, added, _ := streamFixture(t)
	file := added.Files()[0]
	pieceLength := added.Info().PieceLength

	reader := engine.windows.open(added, file, newStreamReader(context.Background(), file), 6*pieceLength)

	buf := make([]byte, 1000)
	if _, err := io.ReadFull(reader, buf); err != nil {
		t.Fatal(err)
	}

	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}

	for index := range added.NumPieces() {
		state := added.Piece(index).State()
		if !state.Complete && state.Priority != torrent.PiecePriorityNone {
			t.Fatalf("piece %d still wanted after the stream closed: priority %v", index, state.Priority)
		}
	}
}

func TestStreamWithoutWindowKeepsOnlyReadahead(t *testing.T) {
	engine, added, _ := streamFixture(t)
	file := added.Files()[0]

	reader := engine.windows.open(added, file, newStreamReader(context.Background(), file), 0)
	defer reader.Close()

	if _, ok := reader.(*windowReader); ok {
		t.Fatal("a stream without a window must not be tracked")
	}
}
