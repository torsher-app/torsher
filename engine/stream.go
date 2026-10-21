package main

import (
	"context"
	"mime"
	"net/http"
	"path"
	"time"

	"github.com/anacrolix/torrent"
)

// Сколько впереди позиции чтения качать в приоритете. Кусок под позицией
// библиотека запрашивает срочно, окно — следом
var streamReadahead int64 = 16 << 20

// Через сколько после начала просмотра выбранный файл докачивается целиком
const backgroundDelay = 30 * time.Second

func newStreamReader(ctx context.Context, file *torrent.File) torrent.Reader {
	reader := file.NewReader()
	reader.SetContext(ctx)
	reader.SetResponsive()
	reader.SetReadahead(streamReadahead)

	return reader
}

// Поток файла с Range: 206, 416, `Content-Range` и `Content-Length` отдаёт
// `http.ServeContent`. Обрыв соединения отменяет контекст ридера
func (a *api) stream(w http.ResponseWriter, r *http.Request) {
	t, ok := a.torrentOf(w, r)
	if !ok {
		return
	}

	file, ok := fileOf(w, r, t)
	if !ok {
		return
	}

	// Плеер начал читать: через полминуты файл докачивается целиком в фоне
	time.AfterFunc(backgroundDelay, func() { a.startBackground(t) })

	reader := newStreamReader(r.Context(), file)
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
