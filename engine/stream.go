package main

import (
	"context"
	"mime"
	"net/http"
	"path"
	"strconv"
	"time"

	"github.com/anacrolix/torrent"
)

// Сколько впереди позиции чтения библиотека качает срочно, кусок под
// позицией — первым. Дальше идёт окно просмотра (`window.go`)
var streamReadahead int64 = 16 << 20

func newStreamReader(ctx context.Context, file *torrent.File) torrent.Reader {
	reader := file.NewReader()
	reader.SetContext(ctx)
	reader.SetResponsive()
	reader.SetReadahead(streamReadahead)

	return reader
}

// Поток файла с Range: 206, 416, `Content-Range` и `Content-Length` отдаёт
// `http.ServeContent`. Обрыв соединения отменяет контекст ридера.
// `window` — сколько байт впереди позиции качать, пока поток открыт; без
// него качается только readahead
func (a *api) stream(w http.ResponseWriter, r *http.Request) {
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}

	file, ok := fileOf(w, r, t)
	if !ok {
		return
	}

	window, _ := strconv.ParseInt(r.URL.Query().Get("window"), 10, 64)

	reader := a.windows.open(t, file, newStreamReader(r.Context(), file), window)
	defer reader.Close()

	name := path.Base(file.Path())
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Тип задан заранее: иначе ServeContent читает начало файла, чтобы угадать
	// его, и тянет первые куски даже для запроса из середины
	w.Header().Set("Content-Type", contentType)
	http.ServeContent(w, r, name, time.Time{}, reader)
}
