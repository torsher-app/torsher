package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"sync"
	"syscall"
	"time"

	"github.com/anacrolix/torrent/metainfo"
)

var diagnosticHash = regexp.MustCompile(`^[a-f0-9]{40}$`)

func diskErrorKind(err error) string {
	switch {
	case errors.Is(err, syscall.ENOSPC):
		return "ENOSPC"
	case errors.Is(err, syscall.EACCES):
		return "EACCES"
	case errors.Is(err, syscall.EROFS):
		return "EROFS"
	case errors.Is(err, syscall.EDQUOT):
		return "EDQUOT"
	default:
		return "other"
	}
}

// Callback storage не берёт блокировку клиента и не ждёт вывода журнала.
// Очередь и таблица подавления ограничены независимо от числа раздач.
type storageWriteFailure struct {
	hash  metainfo.Hash
	piece int
	kind  string
	short bool
}
type storageDiagnostics struct {
	mu      sync.Mutex
	last    map[metainfo.Hash]time.Time
	pending chan storageWriteFailure
}

func newStorageDiagnostics() *storageDiagnostics {
	return &storageDiagnostics{last: map[metainfo.Hash]time.Time{}, pending: make(chan storageWriteFailure, 128)}
}
func (d *storageDiagnostics) writeFailed(hash metainfo.Hash, piece int, n, requested int, err error) {
	if d == nil || errors.Is(err, context.Canceled) || (err == nil && n == requested) {
		return
	}
	now := time.Now()
	d.mu.Lock()
	defer d.mu.Unlock()
	if at, ok := d.last[hash]; ok && now.Sub(at) < time.Minute {
		return
	}
	if len(d.last) >= 1024 {
		// При полной таблице удаляем только истёкшие ключи; новые не вытесняют
		// активный throttle и не превращают отказ диска в поток сообщений.
		for key, at := range d.last {
			if now.Sub(at) >= time.Minute {
				delete(d.last, key)
			}
		}
		if len(d.last) >= 1024 {
			return
		}
	}
	select {
	case d.pending <- storageWriteFailure{hash, piece, diskErrorKind(err), n < requested}:
		d.last[hash] = now
	default:
	}
}
func (a *api) logStorageFailures(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case f := <-a.lifecycle.diagnostics.pending:
			a.logger.Error("storage write failed", "event", "engine.storage_write_failed", "infoHash", f.hash.HexString(), "piece", f.piece, "errorKind", f.kind, "shortWrite", f.short)
		}
	}
}

// Записываем только статус и типизированный kind; тело ответа не читаем и
// не меняем. Unwrap сохраняет доступ ResponseController к исходному writer.
type diagnosticResponse struct {
	http.ResponseWriter
	status            int
	kind              string
	expectedRestoring bool
}

func (w *diagnosticResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *diagnosticResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *diagnosticResponse) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(body)
}
func (w *diagnosticResponse) ReadFrom(r io.Reader) (int64, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	if target, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		return target.ReadFrom(r)
	}
	return io.Copy(struct{ io.Writer }{w.ResponseWriter}, r)
}
func apiErrorKind(kind string) string {
	switch kind {
	case "storage", "timeout":
		return kind
	default:
		return "other"
	}
}
func (a *api) diagnosticErrors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		result := &diagnosticResponse{ResponseWriter: w}
		next.ServeHTTP(result, r)
		if result.status < 500 || result.expectedRestoring {
			return
		}
		// Pattern принадлежит ServeMux, а не URL запроса; query/path не пишем.
		operation := r.Pattern
		if operation == "" {
			operation = "unknown"
		}
		if !a.apiErrorLog.allow(operation, time.Now()) {
			return
		}
		attrs := []any{"event", "engine.api_error", "operation", operation, "statusCode", result.status, "errorKind", apiErrorKind(result.kind)}
		var hash metainfo.Hash
		if err := hash.FromHexString(r.PathValue("hash")); err == nil {
			attrs = append(attrs, "infoHash", hash.HexString())
		}
		a.logger.Error("engine API failed", attrs...)
	})
}

type apiErrorThrottle struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func (t *apiErrorThrottle) allow(key string, now time.Time) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.last == nil {
		t.last = map[string]time.Time{}
	}
	if at, ok := t.last[key]; ok && now.Sub(at) < time.Minute {
		return false
	}
	// Ключи — конечный набор шаблонов собственных маршрутов.
	if len(t.last) >= 64 {
		return false
	}
	t.last[key] = now
	return true
}

// В upstream даже WARN может содержать имя torrent, URL или PathError.
// Не пересылаем свободный текст и группы: сохраняем уровень, класс ошибки
// и узкую категорию операции, не меняя обработку самой ошибки библиотекой.
func libraryAttrs(attrs []slog.Attr) ([]slog.Attr, bool) {
	var safe []slog.Attr
	canceled := false
	var visit func(slog.Attr)
	visit = func(attr slog.Attr) {
		value := attr.Value.Resolve()
		if value.Kind() == slog.KindGroup {
			for _, child := range value.Group() {
				visit(child)
			}
			return
		}
		if err, ok := value.Any().(error); ok {
			if errors.Is(err, context.Canceled) {
				canceled = true
				return
			}
			safe = append(safe, slog.String("errorKind", diskErrorKind(err)))
		}
		if attr.Key == "ih" || attr.Key == "torrent.ih" {
			hash := value.String()
			if diagnosticHash.MatchString(hash) {
				safe = append(safe, slog.String("infoHash", hash))
			}
		}
	}
	for _, attr := range attrs {
		visit(attr)
	}
	return safe, canceled
}
func libraryOperation(message string) string {
	switch message {
	case "error reading", "initial read failed", "read failed after reader reset", "read failed after completion resync":
		return "read"
	case "error getting piece completion", "error marking piece complete", "error marking piece not complete":
		return "completion"
	case "finished hashing piece":
		return "hash"
	default:
		return "other"
	}
}
