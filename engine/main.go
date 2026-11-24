// torsher-engine — торрент-движок Torsher: раздачи, поток файла с Range и
// статистика по HTTP API на loopback. Сеть, DHT и выбор кусков — библиотека
// anacrolix/torrent; её «отзывчивый» ридер даёт срочный приоритет кускам у
// позиции чтения, от этого зависит время старта и перемотки.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"

	g "github.com/anacrolix/generics"
	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/mse"
	"github.com/anacrolix/torrent/storage"
)

// Настройки клиента. Сеть (порт, UPnP, DHT, PEX, шифрование) библиотека
// читает при создании клиента — они меняются только перезапуском движка;
// лимиты, соединения и очередь меняются на лету (`PUT /settings`)
type engineOptions struct {
	peerPort int
	seed     bool
	upnp     bool
	dht      bool
	pex      bool
	// `prefer` — шифровать, если пир умеет; `require` — только с шифрованием
	encryption    string
	bindInterface string
	live          liveSettings
}

func defaultOptions() engineOptions {
	return engineOptions{
		seed:       true,
		dht:        true,
		pex:        true,
		encryption: "prefer",
		live:       liveSettings{ConnsPerTorrent: 50},
	}
}

func main() {
	opts := defaultOptions()

	listen := flag.String("listen", "127.0.0.1:0", "адрес HTTP API (только loopback)")
	downloads := flag.String("downloads", "downloads", "каталог файлов раздач по умолчанию: раздача без своего каталога")
	dataDir := flag.String("data", "engine-data", "каталог состояния движка")
	flag.IntVar(&opts.peerPort, "peer-port", 0, "порт для входящих соединений пиров (0 — любой свободный)")
	flag.BoolVar(&opts.seed, "seed", opts.seed, "раздавать скачанное пирам")
	flag.BoolVar(&opts.upnp, "upnp", false, "пробросить порт пиров на роутере через UPnP")
	noDHT := flag.Bool("no-dht", false, "без DHT: пиры только от трекеров и PEX")
	noPEX := flag.Bool("no-pex", false, "без обмена пирами (PEX)")
	flag.StringVar(&opts.encryption, "encryption", opts.encryption, "шифрование соединений: prefer или require")
	flag.Int64Var(&opts.live.DownloadLimit, "download-limit", 0, "лимит загрузки выбранных файлов, байт/с (0 — без лимита)")
	flag.Int64Var(&opts.live.UploadLimit, "upload-limit", 0, "лимит отдачи, байт/с (0 — без лимита)")
	flag.IntVar(&opts.live.ConnsPerTorrent, "conns-per-torrent", opts.live.ConnsPerTorrent, "соединений с пирами на раздачу")
	flag.IntVar(&opts.live.ConnsTotal, "conns-total", 0, "соединений с пирами всего (0 — без общего предела)")
	flag.IntVar(&opts.live.ActiveDownloads, "active-downloads", 0, "сколько раздач качают выбор одновременно (0 — без очереди)")
	flag.StringVar(&opts.bindInterface, "bind-interface", "", "сетевой интерфейс для торрент-трафика")
	guard := flag.Bool("network-guard", false, "устанавливать правила привязки по запросам движка")
	guardUID := flag.Uint("guard-uid", 1000, "UID процесса движка для доступа к сетевому помощнику")
	flag.Parse()

	opts.dht = !*noDHT
	opts.pex = !*noPEX

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if *guard {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		if uint64(*guardUID) > uint64(^uint32(0)) {
			logger.Error("invalid network helper UID")
			os.Exit(2)
		}
		if err := serveNetworkGuard(ctx, guardSocketPath(), uint32(*guardUID)); err != nil {
			logger.Error("network helper stopped", "err", err)
			os.Exit(1)
		}
		return
	}

	if err := opts.validate(); err != nil {
		logger.Error("invalid options", "err", err)
		os.Exit(2)
	}

	if err := run(*listen, *downloads, *dataDir, opts, logger); err != nil {
		if errors.Is(err, errNetworkChanged) {
			os.Exit(12)
		}
		logger.Error("engine stopped", "err", err)
		os.Exit(1)
	}
}

// Фильтрует отмену и оставляет только безопасные факты upstream.
type withoutCanceled struct {
	slog.Handler
	throttle *apiErrorThrottle
}

func (h withoutCanceled) Handle(ctx context.Context, record slog.Record) error {
	var attrs []slog.Attr
	record.Attrs(func(attr slog.Attr) bool { attrs = append(attrs, attr); return true })
	safe, canceled := libraryAttrs(attrs)
	if canceled {
		return nil
	}
	operation := libraryOperation(record.Message)
	throttleKey := operation
	for _, attr := range safe {
		if attr.Key == "errorKind" {
			throttleKey += ":" + attr.Value.String()
			break
		}
	}
	if h.throttle != nil && !h.throttle.allow(throttleKey, time.Now()) {
		return nil
	}
	projected := slog.NewRecord(record.Time, record.Level, "torrent library diagnostic", record.PC)
	projected.AddAttrs(slog.String("libraryOperation", operation))
	projected.AddAttrs(safe...)
	return h.Handler.Handle(ctx, projected)
}
func (h withoutCanceled) WithAttrs(attrs []slog.Attr) slog.Handler {
	safe, _ := libraryAttrs(attrs)
	return withoutCanceled{Handler: h.Handler.WithAttrs(safe), throttle: h.throttle}
}
func (h withoutCanceled) WithGroup(string) slog.Handler { return h }

func newLibraryLogger() *slog.Logger {
	return slog.New(withoutCanceled{Handler: slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}), throttle: &apiErrorThrottle{}})
}

func (o engineOptions) validate() error {
	if o.encryption != "prefer" && o.encryption != "require" {
		return fmt.Errorf("unknown encryption %q", o.encryption)
	}

	return o.live.validate()
}

// Части клиента, которые нужны API: каталог загрузок и отметки скачанных
// кусков (удаление), лимиты и окна потоков (их колбэк вшит в конфиг клиента)
type clientParts struct {
	lifecycle   *storageLifecycle
	downloads   string
	completion  storage.PieceCompletion
	limits      *limits
	windows     *windows
	private     *privateRegistry
	maintenance *maintenanceFences
}

// Файловое хранилище каталога. Отметки кусков общие у всех каталогов: ключ —
// infohash и номер куска, поэтому перенос раздачи их не теряет
func fileStorage(dir string, completion storage.PieceCompletion) storage.ClientImplCloser {
	return storage.NewFileOpts(storage.NewFileClientOpts{
		ClientBaseDir:   dir,
		Logger:          newLibraryLogger(),
		FilePathMaker:   filePathOf,
		PieceCompletion: completion,
		// Без `.part`: с ними хранилище пишет кусок всегда в `<файл>.part`, даже
		// когда файл уже готов, а потом переименовывает его поверх готового.
		// Кусок на стыке двух файлов, с которого открытие раздачи снимает
		// отметку, так затирал готовую серию разреженным файлом
		UsePartFiles: g.Some(false),
	})
}

// Писатель соединения в anacrolix v1.61 теряет пробуждение: пересчёт
// запросов или готовый к отдаче кусок, пришедшие между его проходом и
// засыпанием, ждут следующего события, а с единственным пиром его нет —
// обмен встаёт при живом незадушенном соединении. Будит писателя тогда
// только таймер keepalive (по умолчанию минута), поэтому он короткий.
// Исправлено в upstream (#1078, #1071) после v1.61.0
const peerKeepAlive = 5 * time.Second

// Конфигурация клиента общая для движка и тестов: тесты отключают сеть наружу
func newClientConfig(downloads, dataDir string, opts engineOptions) (*torrent.ClientConfig, clientParts, error) {
	if err := os.MkdirAll(downloads, 0o755); err != nil {
		return nil, clientParts{}, err
	}

	completion, err := storage.NewBoltPieceCompletion(dataDir)
	if err != nil {
		return nil, clientParts{}, err
	}

	streams := newWindows()
	speedLimits := newLimits(opts.live, streams)

	cfg := torrent.NewDefaultClientConfig()
	cfg.ListenPort = opts.peerPort
	cfg.DataDir = downloads
	// Без `Seed` библиотека отдаёт куски только в обмен на свои и перестаёт
	// раздавать скачанное
	cfg.Seed = opts.seed
	cfg.NoDefaultPortForwarding = !opts.upnp
	private := &privateRegistry{}
	private.configure(cfg)
	cfg.DisablePEX = !opts.pex
	if opts.encryption == "require" {
		// Только RC4 после обфускации заголовка: открытый текст пира отклоняется
		cfg.HeaderObfuscationPolicy = torrent.HeaderObfuscationPolicy{Preferred: true, RequirePreferred: true}
		cfg.CryptoProvides = mse.CryptoMethodRC4
		cfg.CryptoSelector = func(mse.CryptoMethod) mse.CryptoMethod { return mse.CryptoMethodRC4 }
	}
	cfg.KeepAliveTimeout = peerKeepAlive
	cfg.EstablishedConnsPerTorrent = opts.live.ConnsPerTorrent
	// Свои ограничители, а не общий `unlimited` пакета: `SetLimit` у него
	// поменял бы лимит всем клиентам процесса
	cfg.DownloadRateLimiter = speedLimits.download
	cfg.UploadRateLimiter = speedLimits.upload
	cfg.Callbacks.ReceivedUsefulData = append(cfg.Callbacks.ReceivedUsefulData, speedLimits.received)
	lifecycle := &storageLifecycle{torrents: map[metainfo.Hash]*storageLifetime{}, diagnostics: newStorageDiagnostics()}
	cfg.DefaultStorage = trackedStorage{ClientImplCloser: fileStorage(downloads, completion), lifecycle: lifecycle}
	// Сообщения библиотеки — только предупреждения и ошибки: остальное шумит в журнале сервера
	cfg.Slogger = newLibraryLogger()

	return cfg, clientParts{lifecycle: lifecycle, downloads: downloads, completion: completion, limits: speedLimits, windows: streams, private: private}, nil
}

func run(listen, downloads, dataDir string, opts engineOptions, logger *slog.Logger) error {
	cfg, store, err := newClientConfig(downloads, dataDir, opts)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// Normal shutdown may still send a bounded stopped over this transport.
	// The interface watcher keeps the binding fail-closed throughout it.
	transportCtx, stopTransport := context.WithCancel(context.Background())
	defer stopTransport()
	var changed atomic.Bool

	sess, err := newSession(filepath.Join(dataDir, "torrents"))
	if err != nil {
		return err
	}
	restoredSessions, restoreErrors := sess.load()
	store.maintenance = loadMaintenance(filepath.Join(dataDir, "maintenance"))
	store.private.loadSessions(restoredSessions, store.maintenance)

	state := guardResponse{Status: "unbound"}
	var binding *boundTransport
	if opts.bindInterface != "" {
		state = authorizeBinding(ctx, opts.bindInterface)
		if state.Status == "bound" {
			binding, err = openBoundTransport(transportCtx, opts.bindInterface, state.Device, opts.peerPort)
			if err != nil {
				state.Status = bindFailureStatus(err)
			}
		}
		if binding == nil {
			makeClientOffline(cfg)
		} else {
			defer binding.stop()
			binding.configure(cfg)
		}
	}

	client, err := torrent.NewClient(cfg)
	if err != nil {
		return err
	}
	if binding != nil {
		if err := binding.attach(client, opts.dht, store.private); err != nil {
			binding.stop()
			client.Close()
			binding = nil
			state.Status = bindFailureStatus(err)
			makeClientOffline(cfg)
			client, err = torrent.NewClient(cfg)
			if err != nil {
				return err
			}
		}
	}
	defer client.Close()
	if opts.bindInterface == "" && opts.dht {
		for _, listener := range client.Listeners() {
			if packet, ok := listener.(net.PacketConn); ok {
				if err := store.private.attachDHT(client, packet); err != nil {
					return err
				}
			}
		}
	}

	engine := newAPI(client, sess, store, logger)
	engine.network = networkHandler(opts.bindInterface, state)
	engine.networkOffline = opts.bindInterface != "" && binding == nil
	peerPort := client.LocalPort()
	dhtEnabled, upnpEnabled := opts.dht, opts.upnp
	if opts.bindInterface != "" {
		dhtEnabled, upnpEnabled = binding != nil && opts.dht, false
	}
	if binding != nil {
		peerPort = binding.port
	}
	if !engine.networkOffline {
		engine.trackers = newPrivateTrackerManager(ctx, cfg.TrackerDialContext, peerPort)
		defer func() {
			healthy := !changed.Load() && (binding == nil || binding.ctx.Err() == nil)
			engine.trackers.close(engine, healthy)
		}()
	}
	logger.Info("engine network configured", "event", "engine.network", "peerPort", peerPort, "dht", dhtEnabled, "pex", opts.pex, "upnp", upnpEnabled, "encryption", opts.encryption, "connsPerTorrent", opts.live.ConnsPerTorrent, "connsTotal", opts.live.ConnsTotal)
	// После восстановления и до закрытия клиента: счётчики раздач живут в нём
	defer engine.flushAllUploaded()

	ln, err := net.Listen("tcp", listen)
	if err != nil {
		return err
	}

	server := &http.Server{
		Handler:           engine.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	if binding != nil {
		go func() {
			if binding.watch(transportCtx) {
				changed.Store(true)
				stop()
			}
		}()
	}

	// Восстановление сотен раздач с проверкой файлов идёт долго: API уже
	// слушает, и супервизор видит живой процесс (`restoring`), а не молчание
	restoring := make(chan struct{})
	go func() {
		defer close(restoring)
		engine.restoreLoaded(ctx, restoredSessions, restoreErrors)
	}()
	// Клиент закрывается после восстановления: оно ещё работает с раздачами
	defer func() {
		stop()
		<-restoring
	}()

	// Сразу, а не после восстановления: `restore` тоже берёт блокировку и
	// может застрять под ней
	go engine.watchdog(ctx, func() { client.Torrents() })
	go engine.speeds.run(ctx, client, logger)
	go engine.logStorageFailures(ctx)
	go engine.schedule(ctx)
	go engine.limits.gate(ctx)

	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()

	if err := server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}

	if ctx.Err() != nil {
		<-shutdownDone
	}
	if changed.Load() {
		return errNetworkChanged
	}
	return nil
}
