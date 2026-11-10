package main

import (
	"bytes"
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

// Окно другого файла не уступает фоновой серии с High, а позиция
// чтения получает срочный приоритет ридера поверх обоих.
func TestStreamWindowKeepsUpWithFirstFile(t *testing.T) {
	fx, _, _ := newTwoFileFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	post(t, server.URL+"/torrents?files=0,1", fx.raw).Body.Close()
	added, _ := engine.client.Torrent(fx.meta.HashInfoBytes())
	file := added.Files()[1]
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader := newStreamReader(ctx, file)
	reader.SetReadahead(1)
	window := engine.windows.open(added, file, reader, file.Length())
	defer window.Close()
	done := make(chan struct{})
	go func() {
		_, _ = window.Read(make([]byte, 1))
		close(done)
	}()
	defer func() {
		cancel()
		<-done
	}()

	// Последний кусок второго файла вне readahead и не пересекается с первым.
	// Срочный приоритет ридера появляется только после входа горутины в Read.
	waitFor(t, 5*time.Second, func() bool {
		return added.Piece(added.NumPieces()-1).State().Priority == torrent.PiecePriorityHigh &&
			added.Piece(int(file.Offset()/added.Info().PieceLength)).State().Priority > torrent.PiecePriorityHigh
	})
	last := added.Piece(added.NumPieces() - 1).State().Priority
	if last != torrent.PiecePriorityHigh {
		t.Fatalf("stream window priority %v, want High", last)
	}
	position := added.Piece(int(file.Offset() / added.Info().PieceLength)).State().Priority
	if position <= torrent.PiecePriorityHigh {
		t.Fatalf("reader priority %v does not beat the background file", position)
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

func TestTwoStreamReadersKeepIndependentPositionsAndLifetime(t *testing.T) {
	engine, added, fx := streamFixture(t)
	file := added.Files()[0]
	pieceLength := added.Info().PieceLength
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	first := engine.windows.open(added, file, newStreamReader(ctx, file), 2*pieceLength)
	second := engine.windows.open(added, file, newStreamReader(ctx, file), 2*pieceLength)
	firstClosed, secondClosed := false, false
	defer func() {
		if !firstClosed {
			first.Close()
		}
		if !secondClosed {
			second.Close()
		}
	}()
	if _, err := second.Seek(6*pieceLength, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	readAt := func(reader torrent.Reader, position int64) {
		t.Helper()
		data := make([]byte, 4096)
		if _, err := io.ReadFull(reader, data); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(data, fx.content[position:position+int64(len(data))]) {
			t.Fatalf("reader returned data from another position, want %d", position)
		}
	}
	readAt(first, 0)
	readAt(second, 6*pieceLength)
	// Перемотка A не меняет текущую позицию B.
	if _, err := first.Seek(10*pieceLength, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	readAt(first, 10*pieceLength)
	readAt(second, 6*pieceLength+4096)
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	firstClosed = true
	if !engine.windows.streaming(added.InfoHash()) {
		t.Fatal("closing one reader released the other stream")
	}
	// После закрытия A второй ридер продолжает читать, а затем получает
	// новые куски за пределами своего прежнего окна.
	readAt(second, 6*pieceLength+8192)
	if added.Piece(4).State().Complete {
		t.Fatal("the piece outside both reader windows was already downloaded")
	}
	if _, err := second.Seek(4*pieceLength, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	readAt(second, 4*pieceLength)
	waitFor(t, 5*time.Second, func() bool {
		return added.Piece(4).State().Complete
	})
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
	secondClosed = true
	if engine.windows.streaming(added.InfoHash()) {
		t.Fatal("the last reader did not release the stream")
	}
}

// Проба и субтитры читают без окна: куски окна не помечаются, но поток
// считается открытым — лимит загрузки его не касается
func TestStreamWithoutWindowKeepsOnlyReadahead(t *testing.T) {
	engine, added, _ := streamFixture(t)
	file := added.Files()[0]
	hash := added.InfoHash()

	reader := engine.windows.open(added, file, newStreamReader(context.Background(), file), 0)

	if _, err := io.ReadFull(reader, make([]byte, 4096)); err != nil {
		t.Fatal(err)
	}

	if !engine.windows.streaming(hash) {
		t.Fatal("a stream without a window must count as open")
	}

	engine.windows.mu.Lock()
	tw := engine.windows.byTorrent[hash]
	engine.windows.mu.Unlock()

	tw.updating.Lock()
	marked := len(tw.marked)
	tw.updating.Unlock()

	if marked != 0 {
		t.Fatalf("a stream without a window marked %d pieces", marked)
	}

	reader.Close()

	if engine.windows.streaming(hash) {
		t.Fatal("a closed stream still counts as open")
	}
}
