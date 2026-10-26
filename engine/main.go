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
	"syscall"
	"time"

	g "github.com/anacrolix/generics"
	"github.com/anacrolix/torrent"
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
	encryption string
	live       liveSettings
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
	flag.Parse()

	opts.dht = !*noDHT
	opts.pex = !*noPEX

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if err := opts.validate(); err != nil {
		logger.Error("invalid options", "err", err)
		os.Exit(2)
	}

	if err := run(*listen, *downloads, *dataDir, opts, logger); err != nil {
		logger.Error("engine stopped", "err", err)
		os.Exit(1)
	}
}

// Журнал библиотеки без записей об отменённом чтении. Плеер закрывает поток
// на каждой перемотке и остановке, а ридер библиотеки пишет такую отмену
// тремя записями ERROR — по одной на каждую попытку чтения
type withoutCanceled struct{ slog.Handler }

func (h withoutCanceled) Handle(ctx context.Context, record slog.Record) error {
	canceled := false

	record.Attrs(func(attr slog.Attr) bool {
		err, ok := attr.Value.Any().(error)
		canceled = ok && errors.Is(err, context.Canceled)
		return !canceled
	})

	if canceled {
		return nil
	}

	return h.Handler.Handle(ctx, record)
}

func (h withoutCanceled) WithAttrs(attrs []slog.Attr) slog.Handler {
	return withoutCanceled{h.Handler.WithAttrs(attrs)}
}

func (h withoutCanceled) WithGroup(name string) slog.Handler {
	return withoutCanceled{h.Handler.WithGroup(name)}
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
	downloads  string
	completion storage.PieceCompletion
	limits     *limits
	windows    *windows
}

// Файловое хранилище каталога. Отметки кусков общие у всех каталогов: ключ —
// infohash и номер куска, поэтому перенос раздачи их не теряет
func fileStorage(dir string, completion storage.PieceCompletion) storage.ClientImplCloser {
	return storage.NewFileOpts(storage.NewFileClientOpts{
		ClientBaseDir:   dir,
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
	cfg.NoDHT = !opts.dht
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
	cfg.DefaultStorage = fileStorage(downloads, completion)
	// Сообщения библиотеки — только предупреждения и ошибки: остальное шумит в журнале сервера
	cfg.Slogger = slog.New(withoutCanceled{slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn})})

	return cfg, clientParts{downloads: downloads, completion: completion, limits: speedLimits, windows: streams}, nil
}

func run(listen, downloads, dataDir string, opts engineOptions, logger *slog.Logger) error {
	cfg, store, err := newClientConfig(downloads, dataDir, opts)
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

	// Сразу, а не после восстановления: `restore` тоже берёт блокировку и
	// может застрять под ней
	go engine.watchdog(ctx, func() { client.Torrents() })
	go engine.speeds.run(ctx, client)
	go engine.schedule(ctx)
	go engine.limits.gate(ctx)

	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()

	if err := server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}

	return nil
}
