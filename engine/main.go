// torsher-engine — торрент-движок Torsher: раздачи, поток файла с Range и
// статистика по HTTP API на loopback. Сеть, DHT и выбор кусков — библиотека
// anacrolix/torrent; её «отзывчивый» ридер даёт срочный приоритет кускам у
// позиции чтения, от этого зависит время старта и перемотки.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	g "github.com/anacrolix/generics"
	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/storage"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:0", "адрес HTTP API (только loopback)")
	downloads := flag.String("downloads", "downloads", "каталог файлов раздач")
	dataDir := flag.String("data", "engine-data", "каталог состояния движка")
	peerPort := flag.Int("peer-port", 0, "порт для входящих соединений пиров (0 — любой свободный)")
	seed := flag.Bool("seed", true, "раздавать скачанное пирам")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if err := run(*listen, *downloads, *dataDir, *peerPort, *seed, logger); err != nil {
		logger.Error("engine stopped", "err", err)
		os.Exit(1)
	}
}

// Хранилище клиента: каталог загрузок и отметки скачанных кусков
type clientStorage struct {
	downloads  string
	completion storage.PieceCompletion
}

// Конфигурация клиента общая для движка и тестов: тесты отключают сеть наружу
func newClientConfig(downloads, dataDir string, peerPort int, seed bool) (*torrent.ClientConfig, clientStorage, error) {
	if err := os.MkdirAll(downloads, 0o755); err != nil {
		return nil, clientStorage{}, err
	}

	completion, err := storage.NewBoltPieceCompletion(dataDir)
	if err != nil {
		return nil, clientStorage{}, err
	}

	cfg := torrent.NewDefaultClientConfig()
	cfg.ListenPort = peerPort
	cfg.DataDir = downloads
	// Без `Seed` библиотека отдаёт куски только в обмен на свои и перестаёт
	// раздавать скачанное
	cfg.Seed = seed
	cfg.DefaultStorage = storage.NewFileOpts(storage.NewFileClientOpts{
		ClientBaseDir:   downloads,
		FilePathMaker:   filePathOf,
		PieceCompletion: completion,
		// Без `.part`: с ними хранилище пишет кусок всегда в `<файл>.part`, даже
		// когда файл уже готов, а потом переименовывает его поверх готового.
		// Кусок на стыке двух файлов, с которого открытие раздачи снимает
		// отметку, так затирал готовую серию разреженным файлом
		UsePartFiles: g.Some(false),
	})
	// Сообщения библиотеки — только предупреждения и ошибки: остальное шумит в журнале сервера
	cfg.Slogger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))

	return cfg, clientStorage{downloads: downloads, completion: completion}, nil
}

func run(listen, downloads, dataDir string, peerPort int, seed bool, logger *slog.Logger) error {
	cfg, store, err := newClientConfig(downloads, dataDir, peerPort, seed)
	if err != nil {
		return err
	}

	client, err := torrent.NewClient(cfg)
	if err != nil {
		return err
	}
	defer client.Close()

	sess, err := newSession(filepath.Join(dataDir, "torrents"))
	if err != nil {
		return err
	}

	engine := newAPI(client, sess, store, logger)

	ln, err := net.Listen("tcp", listen)
	if err != nil {
		return err
	}

	server := &http.Server{
		Handler:           engine.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Восстановление сотен раздач с проверкой файлов идёт долго: API уже
	// слушает, и супервизор видит живой процесс (`restoring`), а не молчание
	restoring := make(chan struct{})
	go func() {
		defer close(restoring)
		engine.restore(ctx)
	}()
	// Клиент закрывается после восстановления: оно ещё работает с раздачами
	defer func() {
		stop()
		<-restoring
	}()

	go engine.speeds.run(ctx, client)

	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()

	logger.Info("engine listening", "addr", ln.Addr().String())

	if err := server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}

	return nil
}
