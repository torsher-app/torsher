package main

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
)

// Окно просмотра. Пока поток открыт, куски на `window` байт впереди позиции
// чтения получают высокий приоритет; срочные куски у позиции даёт readahead
// ридера библиотеки. Вне окон открытых потоков куски не качаются (если файл
// не выбран целиком), поэтому закрытый поток останавливает закачку.
//
// Приоритет куска в anacrolix — максимум из приоритетов файла, ридеров и
// самого куска, поэтому окно не мешает выбранным файлам, а они — окну.
// Высокий, а не обычный: файл, который качается первым, тоже высокий, и
// иначе фоновая закачка сезона обгоняла бы окно просмотра другой серии.

// Сколько недокачанных кусков окна запрашивать за раз: ближние к позиции
// идут первыми и не отнимают пиров у куска под позицией. Остальное окно
// подтягивается по мере готовности, как у ридера TorrServer
const windowBatchBytes int64 = 64 << 20

const minWindowBatchPieces = 4

// Плеер на паузе не двигает позицию, а куски окна докачиваются: пересчёт
// по таймеру выдаёт следующую порцию
const windowRefresh = time.Second

type windows struct {
	mu        sync.Mutex
	byTorrent map[metainfo.Hash]*torrentWindows
	// Поток открыт или закрыт: лимиты и соединения зависят от открытых потоков
	streamChanged func(opened bool)
}

// Живёт, пока раздача в движке: перемотка закрывает поток и открывает новый,
// и пересчёт закрытого не должен снять куски, которые уже пометил новый
type torrentWindows struct {
	t       *torrent.Torrent
	readers map[*windowReader]struct{}
	// Закрывается, когда закрыт последний поток: таймер пересчёта не нужен
	stop chan struct{}

	// Пересчёты одной раздачи идут по одному: иначе устаревший набор мог бы
	// перезаписать свежий
	updating sync.Mutex
	// Куски, которым приоритет поставило окно: снимаем только их
	marked map[int]struct{}
}

func newWindows() *windows {
	return &windows{
		byTorrent:     map[metainfo.Hash]*torrentWindows{},
		streamChanged: func(bool) {},
	}
}

type windowReader struct {
	torrent.Reader
	owner  *windows
	t      *torrent.Torrent
	file   *torrent.File
	window int64
	// Длина куска: колбэк лимитов читает позицию под блокировкой клиента
	pieceLength int64
	pos         atomic.Int64
	// Кусок под позицией при прошлом пересчёте
	piece atomic.Int64
}

// Ридер потока с окном. `window <= 0` — без окна: так читают проба и
// субтитры. Такой поток куски окна не помечает, но считается открытым:
// лимит загрузки его тоже не касается
func (w *windows) open(t *torrent.Torrent, file *torrent.File, reader torrent.Reader, window int64) torrent.Reader {
	r := &windowReader{
		Reader:      reader,
		owner:       w,
		t:           t,
		file:        file,
		window:      max(window, 0),
		pieceLength: t.Info().PieceLength,
	}
	r.piece.Store(-1)

	w.mu.Lock()
	tw, ok := w.byTorrent[t.InfoHash()]
	if !ok {
		tw = &torrentWindows{
			t:       t,
			readers: map[*windowReader]struct{}{},
			marked:  map[int]struct{}{},
		}
		w.byTorrent[t.InfoHash()] = tw
	}
	if len(tw.readers) == 0 {
		tw.stop = make(chan struct{})
		go tw.refresh(w, tw.stop)
	}
	tw.readers[r] = struct{}{}
	w.mu.Unlock()

	w.streamChanged(true)
	r.moved()

	return r
}

func (r *windowReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	r.pos.Add(int64(n))
	r.moved()

	return n, err
}

func (r *windowReader) Seek(offset int64, whence int) (int64, error) {
	pos, err := r.Reader.Seek(offset, whence)
	if err == nil {
		r.pos.Store(pos)
		r.moved()
	}

	return pos, err
}

func (r *windowReader) Close() error {
	err := r.Reader.Close()

	closed := false

	r.owner.mu.Lock()
	tw := r.owner.byTorrent[r.t.InfoHash()]
	if tw != nil {
		if _, open := tw.readers[r]; open {
			delete(tw.readers, r)
			closed = true
			if len(tw.readers) == 0 {
				close(tw.stop)
			}
		}
	}
	r.owner.mu.Unlock()

	if tw != nil {
		tw.update(r.owner)
	}

	if closed {
		r.owner.streamChanged(false)
	}

	return err
}

// Пересчёт — только когда позиция перешла на другой кусок: чтение идёт
// блоками по десяткам килобайт
func (r *windowReader) moved() {
	piece := (r.file.Offset() + r.pos.Load()) / r.pieceLength
	if r.piece.Swap(piece) == piece {
		return
	}

	r.owner.mu.Lock()
	tw := r.owner.byTorrent[r.t.InfoHash()]
	r.owner.mu.Unlock()

	if tw != nil {
		tw.update(r.owner)
	}
}

func (tw *torrentWindows) refresh(owner *windows, stop chan struct{}) {
	ticker := time.NewTicker(windowRefresh)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-tw.t.Closed():
			return
		case <-ticker.C:
			tw.update(owner)
		}
	}
}

// Диапазон кусков [first, end) окна ридера
type pieceSpan struct {
	first, end int
}

// Раздачу забыли: её окна больше не нужны. Открытые потоки закроются сами
// и будут сняты со счёта — `Close` найдёт, что раздачи уже нет
func (w *windows) forget(hash metainfo.Hash) {
	w.mu.Lock()
	tw, ok := w.byTorrent[hash]
	open := 0
	if ok {
		open = len(tw.readers)
		if open > 0 {
			close(tw.stop)
		}
		delete(w.byTorrent, hash)
	}
	w.mu.Unlock()

	for range open {
		w.streamChanged(false)
	}
}

// У раздачи открыт поток
func (w *windows) streaming(hash metainfo.Hash) bool {
	w.mu.Lock()
	defer w.mu.Unlock()

	tw := w.byTorrent[hash]

	return tw != nil && len(tw.readers) > 0
}

// Кусок нужен открытому потоку: от куска под позицией до конца окна или
// опережения ридера. Вызывается колбэком под блокировкой клиента, поэтому
// клиента не трогает
func (w *windows) streamPiece(t *torrent.Torrent, index int) bool {
	w.mu.Lock()
	defer w.mu.Unlock()

	tw := w.byTorrent[t.InfoHash()]
	if tw == nil {
		return false
	}

	for r := range tw.readers {
		begin := r.file.Offset() + r.pos.Load()
		end := min(begin+max(r.window, streamReadahead), r.file.Offset()+r.file.Length())
		if begin >= end {
			continue
		}

		if index >= int(begin/r.pieceLength) && index <= int((end-1)/r.pieceLength) {
			return true
		}
	}

	return false
}

// Снимает приоритеты, которые поставили окна раздачи; следующий пересчёт
// поставит их снова. Нужно паузе: см. `setPaused`
func (w *windows) release(hash metainfo.Hash) {
	w.mu.Lock()
	tw := w.byTorrent[hash]
	w.mu.Unlock()

	if tw == nil {
		return
	}

	tw.updating.Lock()
	defer tw.updating.Unlock()

	for index := range tw.marked {
		tw.t.Piece(index).SetPriority(torrent.PiecePriorityNone)
		delete(tw.marked, index)
	}
}

func (r *windowReader) span() pieceSpan {
	pieceLength := r.pieceLength
	fileEnd := r.file.Offset() + r.file.Length()
	begin := r.file.Offset() + r.pos.Load()
	end := min(begin+r.window, fileEnd)

	if begin >= end {
		return pieceSpan{}
	}

	return pieceSpan{first: int(begin / pieceLength), end: int((end-1)/pieceLength) + 1}
}

func (tw *torrentWindows) update(owner *windows) {
	tw.updating.Lock()
	defer tw.updating.Unlock()

	select {
	case <-tw.t.Closed():
		return
	default:
	}

	owner.mu.Lock()
	spans := make([]pieceSpan, 0, len(tw.readers))
	for r := range tw.readers {
		spans = append(spans, r.span())
	}
	owner.mu.Unlock()

	batch := max(int(windowBatchBytes/tw.t.Info().PieceLength), minWindowBatchPieces)
	wanted := map[int]struct{}{}

	for _, span := range spans {
		missing := 0
		for index := span.first; index < span.end && missing < batch; index++ {
			if tw.t.Piece(index).State().Complete {
				continue
			}
			wanted[index] = struct{}{}
			missing++
		}
	}

	for index := range tw.marked {
		if _, ok := wanted[index]; !ok {
			tw.t.Piece(index).SetPriority(torrent.PiecePriorityNone)
			delete(tw.marked, index)
		}
	}

	for index := range wanted {
		if _, ok := tw.marked[index]; !ok {
			tw.t.Piece(index).SetPriority(torrent.PiecePriorityHigh)
			tw.marked[index] = struct{}{}
		}
	}
}
