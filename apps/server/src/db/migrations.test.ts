import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

interface Journal {
  entries: { idx: number, tag: string }[]
}

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
) as Journal
const profilesIdx = journal.entries.findIndex(entry =>
  readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8').includes(
    'CREATE TABLE `profiles`',
  ),
)
const tempDirs: string[] = []

/** Каталог миграций до профилей: база в том виде, в каком её застаёт обновление */
function migrationsBeforeProfiles() {
  const dir = mkdtempSync(join(tmpdir(), 'torsher-migrations-'))

  tempDirs.push(dir)
  cpSync(MIGRATIONS_DIR, dir, { recursive: true })
  writeFileSync(
    join(dir, 'meta/_journal.json'),
    JSON.stringify({
      ...journal,
      entries: journal.entries.slice(0, profilesIdx),
    }),
  )

  return dir
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('миграция профилей', () => {
  it('создаёт профиль владельца и переносит в него позиции и прогресс', () => {
    const sqlite = new Database(':memory:')

    sqlite.pragma('foreign_keys = ON')

    const db = drizzle(sqlite)

    migrate(db, { migrationsFolder: migrationsBeforeProfiles() })

    const now = Date.now()

    sqlite
      .prepare(
        'INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('u1', 'Owner', 'owner@example.com', 'x', now, now)
    sqlite
      .prepare(
        'INSERT INTO torrents (id, info_hash, name, source, status, added_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('t1', '0'.repeat(40), 'Sample', 'file', 'ready', now)
    sqlite
      .prepare(
        'INSERT INTO watch_states (torrent_id, file_index, position, duration, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('t1', 0, 120, 3600, now)
    sqlite
      .prepare(
        'INSERT INTO title_progress (title_id, season, episode, position, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('tmdb:tv:1', 1, 2, 300, now)

    migrate(db, { migrationsFolder: MIGRATIONS_DIR })

    const profiles = sqlite.prepare('SELECT * FROM profiles').all() as {
      id: string
      name: string
    }[]

    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.name).toBe('Owner')
    expect(profiles[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(sqlite.prepare('SELECT * FROM watch_states').all()).toEqual([
      expect.objectContaining({
        profile_id: profiles[0]!.id,
        torrent_id: 't1',
        position: 120,
      }),
    ])
    expect(sqlite.prepare('SELECT * FROM title_progress').all()).toEqual([
      expect.objectContaining({
        profile_id: profiles[0]!.id,
        title_id: 'tmdb:tv:1',
        position: 300,
      }),
    ])

    // Повторный запуск при старте сервера ничего не меняет
    migrate(db, { migrationsFolder: MIGRATIONS_DIR })

    expect(sqlite.prepare('SELECT id FROM profiles').all()).toEqual([
      { id: profiles[0]!.id },
    ])
    expect(
      sqlite.prepare('SELECT count(*) AS n FROM watch_states').get(),
    ).toEqual({ n: 1 })
  })

  it('на пустой базе профилей не создаёт: первый появится с аккаунтом', () => {
    const sqlite = new Database(':memory:')

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })

    expect(sqlite.prepare('SELECT count(*) AS n FROM profiles').get()).toEqual({
      n: 0,
    })
  })
})
