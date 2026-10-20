import { createApp } from './app.ts'
import { config } from './config.ts'
import { migrateDb } from './db/index.ts'
import { purgeExpiredMetaCache } from './services/tmdb/cache.ts'

const DAY_MS = 24 * 60 * 60 * 1000

migrateDb()

// Срок хранения данных TMDB ограничен: чистим и при старте, и раз в сутки
purgeExpiredMetaCache()
setInterval(purgeExpiredMetaCache, DAY_MS).unref()

const app = createApp({ logger: true })

await app.listen({ port: config.port, host: config.host })
