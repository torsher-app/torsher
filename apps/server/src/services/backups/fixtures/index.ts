import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { MIGRATIONS_DIR } from '../../../db/index.ts'

/** Тестовый каталог данных с файловой базой: копии снимаются только с файла */
export function tempDataDir() {
  return mkdtempSync(join(tmpdir(), 'torsher-backups-'))
}

export function openFileDb(dbPath: string) {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  return db
}

export function createFileDb(
  dataDir: string,
  migrationsFolder = MIGRATIONS_DIR,
) {
  const dbPath = join(dataDir, 'torsher.db')
  const db = openFileDb(dbPath)

  migrate(drizzle(db), { migrationsFolder })

  return { db, dbPath }
}

function hasTable(db: Database.Database, name: string) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name),
  )
}

/** Аккаунт, данные зрителя и данные TMDB, которые в копию попасть не должны */
export function seedData(db: Database.Database) {
  const now = Date.now()

  const columns = db
    .prepare('SELECT name FROM pragma_table_info(\'users\')')
    .pluck()
    .all()

  // Старые копии — до миграции имени пользователя: логин там был email
  if (columns.includes('username')) {
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('owner', 'Owner', 'hash', now, now)
  }
  else {
    db.prepare(
      'INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('owner', 'Owner', 'owner@example.com', 'hash', now, now)
  }
  db.prepare(
    'INSERT INTO meta_cache (key, json, fetched_at) VALUES (?, ?, ?)',
  ).run('tmdb:movie:1', '{}', now)
  db.prepare(
    'INSERT INTO title_aliases (title_id, value, normalized, kind, synced_at) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
  ).run(
    'tmdb:movie:1',
    'Sample',
    'sample',
    'official',
    now,
    'tmdb:movie:1',
    'Custom',
    'custom',
    'user',
    now,
  )

  if (hasTable(db, 'title_external_ids')) {
    db.prepare(
      'INSERT INTO title_external_ids (type, tmdb_id, imdb_id, fetched_at) VALUES (?, ?, ?, ?)',
    ).run('movie', 1, 'tt9000001', now)
  }
}

export function count(db: Database.Database, table: string) {
  return (
    db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }
  ).n
}
