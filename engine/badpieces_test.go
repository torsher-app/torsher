package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

// Сидер раздаёт файл с диска как есть: испорченные байты уходят пирам под
// отметкой «кусок есть», как у пира со старой версией релиза. Пишем на место:
// обрезка файла под mmap сидера даёт SIGBUS
func writeSeededBytes(t *testing.T, fx fixture, offset int, data []byte) {
	t.Helper()

	f, err := os.OpenFile(fx.path, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	if _, err := f.WriteAt(data, int64(offset)); err != nil {
		t.Fatal(err)
	}
}

func readRange(t *testing.T, url string, from, to int) []byte {
	t.Helper()

	request, _ := http.NewRequest(http.MethodGet, url, nil)
	request.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", from, to-1))

	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(response.Body)

	return body
}

func TestBadPiecesAreCountedAndDownloadedAgain(t *testing.T) {
	fx := newFixture(t)
	engine, server := newTestEngine(t, t.TempDir())
	hash := fx.meta.HashInfoBytes()
	pieceLength := 256 << 10
	from, to := 2*pieceLength, 3*pieceLength

	broken := bytes.Clone(fx.content[from+100 : from+200])
	for i := range broken {
		broken[i] ^= 0xff
	}
	writeSeededBytes(t, fx, from+100, broken)
	post(t, server.URL+"/torrents?files=0", fx.raw).Body.Close()

	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)

	stream := fmt.Sprintf("%s/torrents/%s/files/0/stream", server.URL, hash.HexString())
	// Отзывчивый ридер отдаёт чанки до проверки: что пришло — не важно
	readRange(t, stream, from, to)

	waitFor(t, 15*time.Second, func() bool {
		return stateOfHash(t, engine, hash).BadPieces > 0
	})

	grown := engine.speeds.sample(time.Now(), engine.client.Torrents())
	if len(grown) != 1 || grown[0].hash != hash || grown[0].total < 1 {
		t.Fatalf("growth %+v", grown)
	}

	// Сидер поправил файл: библиотека сняла отметку битого куска и качает его
	// заново, новый поток отдаёт верные байты
	writeSeededBytes(t, fx, from+100, fx.content[from+100:from+200])

	waitFor(t, 15*time.Second, func() bool {
		return added.PieceState(2).Complete
	})

	if body := readRange(t, stream, from, to); !bytes.Equal(body, fx.content[from:to]) {
		t.Fatal("stream serves the bad bytes after the piece was downloaded again")
	}
}
