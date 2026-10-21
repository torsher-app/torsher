import process from 'node:process'
import { createApp } from './app.ts'
import { config } from './config.ts'
import { migrateDb } from './db/index.ts'
import { createEngine, isEngineReady } from './services/engine/index.ts'
import { purgeExpiredAliases } from './services/sources/aliases.ts'
import { enforceStorage } from './services/storage/index.ts'
import { purgeExpiredMetaCache } from './services/tmdb/cache.ts'
import { resumeResolving } from './services/torrents/index.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// Кэш растёт, пока смотрят и качают: лимит и запас места проверяются раз в минуту
const STORAGE_CHECK_MS = 60 * 1000

migrateDb()

// Срок хранения данных TMDB ограничен: чистим и при старте, и раз в сутки
function purgeTmdbData() {
  purgeExpiredMetaCache()
  purgeExpiredAliases()
}

purgeTmdbData()
setInterval(purgeTmdbData, DAY_MS).unref()

const app = createApp(
  {
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

  enforceStorage().catch(err =>
    engineLog.error({ err }, 'Storage check failed'),
  )
}

// Раздачи, которые ждали метаданные до перезапуска, дожидаются их снова
const engine = createEngine(engineLog, () => {
  resumeResolving().catch(err => engineLog.error({ err }, 'Resolve failed'))
  checkStorage()
})

setInterval(checkStorage, STORAGE_CHECK_MS).unref()

// Движок — дочерний процесс: без остановки он пережил бы сервер и держал
// порт и сессию, а `node --watch` при перезапуске шлёт именно SIGTERM
async function shutdown() {
  await engine.stop()
  await app.close()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
process.once('exit', () => engine.kill())

await app.listen({ port: config.port, host: config.host })

void engine.start()
