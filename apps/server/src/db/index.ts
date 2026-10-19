import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { config } from '../config.ts'
import * as schema from './schema.ts'

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

function open() {
  if (config.databasePath !== ':memory:')
    mkdirSync(dirname(config.databasePath), { recursive: true })

  const sqlite = new Database(config.databasePath)

  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  return drizzle(sqlite, { schema })
}

let instance: ReturnType<typeof open> | undefined

/**
 * База открывается при первом обращении: приложение можно поднять в памяти
 * (тесты, выгрузка OpenAPI) без файла базы.
 */
export function getDb() {
  instance ??= open()

  return instance
}

export function migrateDb() {
  migrate(getDb(), { migrationsFolder: MIGRATIONS_DIR })
}
