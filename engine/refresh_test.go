package main

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
)

// Серии сезона: размеры не кратны куску, поэтому куски на стыках принадлежат
// двум сериям
func newEpisodes(count int) [][]byte {
	episodes := make([][]byte, count)

	for i := range episodes {
		episodes[i] = make([]byte, 3*(256<<10)+1000*(i+1))
		_, _ = rand.Read(episodes[i])
	}

	return episodes
}

// Раздача-папка `name` с сериями `E01.mkv`… и сидер, который её раздаёт
func newSeasonFixture(t *testing.T, name string, episodes [][]byte) fixture {
	t.Helper()

	root := t.TempDir()
	dir := filepath.Join(root, name)

	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	for i, content := range episodes {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("E%02d.mkv", i+1)), content, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	info := metainfo.Info{PieceLength: 256 << 10}
	if err := info.BuildFromFilePath(dir); err != nil {
		t.Fatal(err)
	}

	infoBytes, err := bencode.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}

	meta := &metainfo.MetaInfo{InfoBytes: infoBytes}

	var raw bytes.Buffer
	if err := meta.Write(&raw); err != nil {
		t.Fatal(err)
	}

	cfg := torrent.NewDefaultClientConfig()
	offline(cfg)
	cfg.Seed = true
	cfg.DataDir = root

	seeder, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { seeder.Close() })

	st, err := seeder.AddTorrent(meta)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.VerifyData(); err != nil {
		t.Fatal(err)
	}

	return fixture{meta: meta, raw: raw.Bytes(), seeder: seeder}
}

func filesQuery(count int) string {
	query := ""
	for i := range count {
		if i > 0 {
			query += ","
		}
		query += fmt.Sprint(i)
	}
	return query
}

// Старая версия раздачи уже скачана: её файлы лежат в каталоге загрузок,
// раздача добавлена и признала их своими по хэшу. Без передачи от сидера:
// закачка тут не проверяется, а каждая настоящая передача в тестах изредка
// встаёт (см. скилл движка)
func addDownloaded(t *testing.T, engine *api, server *httptest.Server, fx fixture, name string, episodes [][]byte) metainfo.Hash {
	t.Helper()

	dir := filepath.Join(engine.downloads, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for i, content := range episodes {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("E%02d.mkv", i+1)), content, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	hash := fx.meta.HashInfoBytes()
	post(t, server.URL+"/torrents?files="+filesQuery(len(episodes)), fx.raw).Body.Close()

	waitFor(t, 30*time.Second, func() bool {
		state := stateOfHash(t, engine, hash)
		return state.BytesWanted > 0 && state.WantedCompleted == state.BytesWanted
	})

	return hash
}

func forgetKeepingFiles(t *testing.T, server *httptest.Server, hash metainfo.Hash) {
	t.Helper()

	request, _ := http.NewRequest(http.MethodDelete, server.URL+"/torrents/"+hash.HexString(), nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("forget: status %d", response.StatusCode)
	}
}

// Новая версия раздачи того же сезона: серии 1–2 → 1–3. `changed` — вторая
// серия перезалита с тем же размером
func refreshedSeason(changed bool) (old, fresh [][]byte) {
	old = newEpisodes(2)
	fresh = append(append([][]byte{}, old...), newEpisodes(1)...)

	if changed {
		fresh[1] = make([]byte, len(old[1]))
		_, _ = rand.Read(fresh[1])
	}

	return old, fresh
}

func inspectOnDisk(t *testing.T, server *httptest.Server, fx fixture, dir string) []string {
	t.Helper()

	details := decode[torrentDetails](t, post(t, server.URL+"/torrents/inspect?dir="+url.QueryEscape(dir), fx.raw))
	states := make([]string, len(details.Files))
	for i, file := range details.Files {
		states[i] = file.OnDisk
	}

	return states
}

// Добавить новую версию с выбором всех серий и докачать её с её сидера.
// Возвращает, сколько полезных байт пришло от пиров
func downloadRefreshed(t *testing.T, engine *api, server *httptest.Server, fx fixture, count int) int64 {
	t.Helper()

	hash := fx.meta.HashInfoBytes()
	post(t, server.URL+"/torrents?files="+filesQuery(count), fx.raw).Body.Close()

	added, _ := engine.client.Torrent(hash)
	added.AddClientPeer(fx.seeder)

	waitFor(t, 30*time.Second, func() bool {
		state := stateOfHash(t, engine, hash)
		return state.WantedCompleted == state.BytesWanted
	})

	stats := added.Stats()

	return stats.BytesReadUsefulData.Int64()
}

func assertEpisodes(t *testing.T, dir string, episodes [][]byte) {
	t.Helper()

	for i, want := range episodes {
		got, err := os.ReadFile(filepath.Join(dir, fmt.Sprintf("E%02d.mkv", i+1)))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("episode %d differs from the new version", i+1)
		}
	}
}

// Сколько можно скачать, если перенесённые серии не качаются: новая серия и
// куски на её стыке с предыдущей
func refreshBudget(fresh [][]byte) int64 {
	return int64(len(fresh[len(fresh)-1])) + 2*(256<<10)
}

func TestInspectComparesFilesOnDisk(t *testing.T) {
	_, fresh := refreshedSeason(false)
	fx := newSeasonFixture(t, "Show", fresh)
	_, server := newTestEngine(t, t.TempDir())
	dir := t.TempDir()
	show := filepath.Join(dir, "Show")

	if err := os.MkdirAll(show, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(show, "E01.mkv"), fresh[0], 0o644); err != nil {
		t.Fatal(err)
	}
	other := make([]byte, len(fresh[1]))
	_, _ = rand.Read(other)
	if err := os.WriteFile(filepath.Join(show, "E02.mkv"), other, 0o644); err != nil {
		t.Fatal(err)
	}

	if got := inspectOnDisk(t, server, fx, dir); fmt.Sprint(got) != "[match differs missing]" {
		t.Fatalf("on disk: %v", got)
	}

	// Другой размер — тоже другой файл
	if err := os.WriteFile(filepath.Join(show, "E02.mkv"), fresh[1][:100], 0o644); err != nil {
		t.Fatal(err)
	}
	if got := inspectOnDisk(t, server, fx, dir); got[1] != diskDiffers {
		t.Fatalf("shorter file: %v", got)
	}

	// Без `dir` сверки нет
	if got := inspectOnDisk(t, server, fx, ""); fmt.Sprint(got) != "[  ]" {
		t.Fatalf("without dir: %v", got)
	}

	response := post(t, server.URL+"/torrents/inspect?dir=relative", fx.raw)
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("relative dir: status %d", response.StatusCode)
	}
}

// Тема обновилась, имя раздачи то же: старую забыли без файлов, новую добавили
// в тот же каталог — скачанные серии не качаются заново, докачивается новая
func TestRefreshedTorrentKeepsDownloadedEpisodes(t *testing.T) {
	old, fresh := refreshedSeason(false)
	oldFx := newSeasonFixture(t, "Show", old)
	newFx := newSeasonFixture(t, "Show", fresh)
	engine, server := newTestEngine(t, t.TempDir())

	forgetKeepingFiles(t, server, addDownloaded(t, engine, server, oldFx, "Show", old))

	if got := inspectOnDisk(t, server, newFx, engine.downloads); fmt.Sprint(got) != "[match match missing]" {
		t.Fatalf("on disk: %v", got)
	}

	if read := downloadRefreshed(t, engine, server, newFx, 3); read > refreshBudget(fresh) {
		t.Fatalf("downloaded %d bytes again, budget %d", read, refreshBudget(fresh))
	}

	assertEpisodes(t, filepath.Join(engine.downloads, "Show"), fresh)
}

// Перезалитую серию anacrolix ловит по хэшу и качает заново, но пишет её на
// месте: файл загрузок, связанный хардлинком с библиотекой, менял бы и файл
// библиотеки. Сервер убирает отличающийся файл до добавления — библиотека
// остаётся при старой версии
func TestRefreshedTorrentRedownloadsChangedEpisode(t *testing.T) {
	old, fresh := refreshedSeason(true)
	oldFx := newSeasonFixture(t, "Show", old)
	newFx := newSeasonFixture(t, "Show", fresh)
	engine, server := newTestEngine(t, t.TempDir())
	show := filepath.Join(engine.downloads, "Show")

	forgetKeepingFiles(t, server, addDownloaded(t, engine, server, oldFx, "Show", old))

	library := filepath.Join(t.TempDir(), "E02.mkv")
	if err := os.Link(filepath.Join(show, "E02.mkv"), library); err != nil {
		t.Fatal(err)
	}

	states := inspectOnDisk(t, server, newFx, engine.downloads)
	if fmt.Sprint(states) != "[match differs missing]" {
		t.Fatalf("on disk: %v", states)
	}
	if err := os.Remove(filepath.Join(show, "E02.mkv")); err != nil {
		t.Fatal(err)
	}

	read := downloadRefreshed(t, engine, server, newFx, 3)
	if budget := refreshBudget(fresh) + int64(len(fresh[1])); read > budget {
		t.Fatalf("downloaded %d bytes, budget %d", read, budget)
	}

	assertEpisodes(t, show, fresh)

	if got, _ := os.ReadFile(library); !bytes.Equal(got, old[1]) {
		t.Fatal("library file was rewritten by the new version")
	}
}

// Имя раздачи сменилось («1–2 из 3» → «1–3 из 3»): новая версия ложится в новую
// папку. Сервер заранее ставит туда хардлинки совпавших серий — и они тоже не
// качаются заново
func TestRefreshedTorrentUnderOtherName(t *testing.T) {
	old, fresh := refreshedSeason(false)
	oldFx := newSeasonFixture(t, "Show 1-2", old)
	newFx := newSeasonFixture(t, "Show 1-3", fresh)
	engine, server := newTestEngine(t, t.TempDir())

	forgetKeepingFiles(t, server, addDownloaded(t, engine, server, oldFx, "Show 1-2", old))

	from := filepath.Join(engine.downloads, "Show 1-2")
	to := filepath.Join(engine.downloads, "Show 1-3")
	if err := os.MkdirAll(to, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"E01.mkv", "E02.mkv"} {
		if err := os.Link(filepath.Join(from, name), filepath.Join(to, name)); err != nil {
			t.Fatal(err)
		}
	}

	if got := inspectOnDisk(t, server, newFx, engine.downloads); fmt.Sprint(got) != "[match match missing]" {
		t.Fatalf("on disk: %v", got)
	}

	if read := downloadRefreshed(t, engine, server, newFx, 3); read > refreshBudget(fresh) {
		t.Fatalf("downloaded %d bytes again, budget %d", read, refreshBudget(fresh))
	}

	assertEpisodes(t, to, fresh)
}

// Новая раздача не верит файлам на диске: у её infohash ещё нет отметок
// кусков, и anacrolix проверяет их по хэшу. Перезалитая серия того же размера
// не считается скачанной
func TestRefreshedTorrentDoesNotTrustChangedEpisode(t *testing.T) {
	old, fresh := refreshedSeason(true)
	oldFx := newSeasonFixture(t, "Show", old)
	newFx := newSeasonFixture(t, "Show", fresh)
	engine, server := newTestEngine(t, t.TempDir())

	forgetKeepingFiles(t, server, addDownloaded(t, engine, server, oldFx, "Show", old))

	hash := newFx.meta.HashInfoBytes()
	post(t, server.URL+"/torrents?files=0,1,2", newFx.raw).Body.Close()
	added, _ := engine.client.Torrent(hash)

	waitFor(t, 30*time.Second, func() bool {
		for index := range added.NumPieces() {
			if state := added.Piece(index).State(); state.Hashing || state.QueuedForHash || state.Marking {
				return false
			}
		}
		return true
	})

	// Первая серия сошлась, кроме куска на стыке со второй, вторая — ни одним куском
	state := stateOfHash(t, engine, hash)
	if state.FileProgress[0] < 3*added.Info().PieceLength {
		t.Fatalf("unchanged episode is not complete: %v", state.FileProgress)
	}
	if state.FileProgress[1] != 0 {
		t.Fatalf("changed episode is trusted: %v", state.FileProgress)
	}
}
