import { createApp } from './app.ts'
import { config } from './config.ts'
import { migrateDb } from './db/index.ts'

migrateDb()

const app = createApp({ logger: true })

await app.listen({ port: config.port, host: config.host })
