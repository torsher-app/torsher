import process from 'node:process'
import { createApp } from './app.ts'
import { config } from './config.ts'
import { migrateDb } from './db/index.ts'
import { createEngine, isEngineReady } from './services/engine/index.ts'
import { cleanTranscodes, stopAllSessions } from './services/media/index.ts'
import { startCheck } from './services/net/check.ts'
import { purgeExpiredAliases } from './services/sources/aliases.ts'
import { enforceStorage } from './services/storage/index.ts'
import { purgeExpiredMetaCache } from './services/tmdb/cache.ts'
import { resumeResolving } from './services/torrents/index.ts'
import { createShutdown } from './shutdown.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// Кэш растёт, пока смотрят и качают: лимит и запас места проверяются раз в минуту
const STORAGE_CHECK_MS = 60 * 1000
// «Обзор» берёт недоступные хосты из последней проверки: без фоновой он
// после перезапуска ничего не знал бы о сети, пока владелец не открыл «Сеть»
const HOST_CHECK_MS = 30 * 60 * 1000

migrateDb()

// Срок хранения данных TMDB ограничен: чистим и при старте, и раз в сутки
function purgeTmdbData() {
  purgeExpiredMetaCache()
  purgeExpiredAliases()
}

purgeTmdbData()
setInterval(purgeTmdbData, DAY_MS).unref()
await cleanTranscodes()

const app = createApp(
  {
    // Плеер держит поток часами: при остановке его не дожидаемся
    forceCloseConnections: true,
    logger: {
      serializers: {
        // Токен потока в адресе действует часами: в журнал он не попадает
        req: request => ({
          method: request.method,
          url: request.url.replace(/([?&]token=)[^&]+/, '$1[redacted]'),
          host: request.host,
          remoteAddress: request.ip,
        }),
      },
    },
  },
  config.clients,
)

const engineLog = app.log.child({ module: 'engine' })

function checkStorage() {
  if (!isEngineReady())
    return

  enforceStorage()
    .then((result) => {
      // Вытеснение удаляет файлы раздач: без записи его не отличить от потери данных
      if (result.evicted.length > 0) {
        engineLog.warn(
          { evicted: result.evicted, available: result.available },
          'Cache evicted',
        )
      }
    })
    .catch(err => engineLog.error({ err }, 'Storage check failed'))
}

// Раздачи, которые ждали метаданные до перезапуска, дожидаются их снова
const engine = createEngine(engineLog, () => {
  resumeResolving().catch(err => engineLog.error({ err }, 'Resolve failed'))
  checkStorage()
})

setInterval(checkStorage, STORAGE_CHECK_MS).unref()

function checkHosts() {
  try {
    startCheck()
  }
  catch (err) {
    app.log.error({ err }, 'Host check failed')
  }
}

// Движок — дочерний процесс: без остановки он пережил бы сервер и держал
// порт и сессию, а `node --watch` при перезапуске шлёт именно SIGTERM
const shutdown = createShutdown({
  steps: [
    // ffmpeg перепаковки тоже дочерний: его сегменты после выхода не нужны
    stopAllSessions,
    () => engine.stop(),
    () => app.close(),
  ],
  kill: () => engine.kill(),
  exit: code => process.exit(code),
  onError: err => app.log.error({ err }, 'Shutdown failed'),
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.once('exit', () => engine.kill())

await app.listen({ port: config.port, host: config.host })

void engine.start()
checkHosts()
setInterval(checkHosts, HOST_CHECK_MS).unref()
