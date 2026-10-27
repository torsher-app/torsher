import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import {
  migrationsBefore as copyMigrationsBefore,
  readMigrationsJournal,
} from './fixtures/index.ts'

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

const journal = readMigrationsJournal()
const profilesIdx = journal.entries.findIndex(entry =>
  readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8').includes(
    'CREATE TABLE `profiles`',
  ),
)
const tempDirs: string[] = []

/** Каталог первых `count` миграций: база в том виде, в каком её застаёт обновление */
function migrationsBefore(count: number) {
  const dir = copyMigrationsBefore(count)

  tempDirs.push(dir)

  return dir
}

function migrationsBeforeProfiles() {
  return migrationsBefore(profilesIdx)
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('журнал миграций', () => {
  // Drizzle применяет только миграции новее последней в базе: `when` не по
  // порядку (после слияния веток) молча пропустил бы миграцию
  it('when строго растёт вместе с idx', () => {
    const entries = [...journal.entries].sort((a, b) => a.idx - b.idx)

    for (let i = 1; i < entries.length; i++)
      expect(entries[i]!.when).toBeGreaterThan(entries[i - 1]!.when)
  })
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

describe('миграция оценки на постере', () => {
  const posterIdx = journal.entries.findIndex(entry =>
    readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8').includes(
      'SET `poster_rating` = \'tmdb\'',
    ),
  )

  it('переводит настройку в набор сервисов и не трогает данные профиля', () => {
    const sqlite = new Database(':memory:')

    sqlite.pragma('foreign_keys = ON')

    const db = drizzle(sqlite)

    migrate(db, { migrationsFolder: migrationsBefore(posterIdx) })

    const now = Date.now()

    sqlite
      .prepare(
        'INSERT INTO profiles (id, name, color, poster_rating, position, created_at) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)',
      )
      .run(
        ...['p1', 'Один', 'violet', 'own', 0, now],
        ...['p2', 'Два', 'green', 'imdb', 1, now],
        ...['p3', 'Три', 'blue', 'none', 2, now],
      )
    sqlite
      .prepare(
        'INSERT INTO profile_titles (profile_id, title_id, rating, rated_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('p1', 'tmdb:movie:1', 8, now, now)

    migrate(db, { migrationsFolder: MIGRATIONS_DIR })

    expect(
      sqlite
        .prepare('SELECT id, poster_rating FROM profiles ORDER BY id')
        .all(),
    ).toEqual([
      { id: 'p1', poster_rating: 'tmdb' },
      { id: 'p2', poster_rating: 'imdb' },
      { id: 'p3', poster_rating: '' },
    ])
    expect(
      sqlite.prepare('SELECT count(*) AS n FROM profile_titles').get(),
    ).toEqual({ n: 1 })
  })
})

describe('миграция папок своей раскладки', () => {
  const followsIdx = journal.entries.findIndex(entry =>
    readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8').includes(
      'SET `follows_env` = 1',
    ),
  )

  it('папка своей раскладки идёт за окружением, подключённые — нет', () => {
    const sqlite = new Database(':memory:')
    const db = drizzle(sqlite)

    migrate(db, { migrationsFolder: migrationsBefore(followsIdx) })

    const now = Date.now()

    sqlite
      .prepare(
        'INSERT INTO libraries (id, kind, name, managed, exclude, watch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        ...['own', 'video', 'Torsher', 1, '[]', 1, now],
        ...['user', 'video', 'Фильмы', 0, '[]', 1, now],
      )
    sqlite
      .prepare(
        'INSERT INTO library_folders (id, library_id, path) VALUES (?, ?, ?), (?, ?, ?)',
      )
      .run('f1', 'own', '/data/library', 'f2', 'user', '/media/movies')

    migrate(db, { migrationsFolder: MIGRATIONS_DIR })

    expect(
      sqlite
        .prepare('SELECT id, follows_env FROM library_folders ORDER BY id')
        .all(),
    ).toEqual([
      { id: 'f1', follows_env: 1 },
      { id: 'f2', follows_env: 0 },
    ])
  })
})

describe('миграция происхождения раздач', () => {
  const originIdx = journal.entries.findIndex(entry =>
    readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8').includes(
      'SET `origin` = \'manual\'',
    ),
  )

  it('добавленные в панели — `manual`, выбранные из карточки — `search`', () => {
    const sqlite = new Database(':memory:')
    const db = drizzle(sqlite)

    migrate(db, { migrationsFolder: migrationsBefore(originIdx) })

    const insert = sqlite.prepare(
      'INSERT INTO torrents (id, info_hash, name, source, status, title_id, match_status, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )

    insert.run(
      'card',
      '1'.repeat(40),
      'A',
      'file',
      'ready',
      'tmdb:tv:1',
      null,
      0,
    )
    insert.run('panel', '2'.repeat(40), 'B', 'file', 'ready', null, null, 0)
    insert.run(
      'recognized',
      '3'.repeat(40),
      'C',
      'file',
      'ready',
      'tmdb:tv:1',
      'matched',
      0,
    )

    migrate(db, { migrationsFolder: MIGRATIONS_DIR })

    expect(
      sqlite.prepare('SELECT id, origin FROM torrents ORDER BY id').all(),
    ).toEqual([
      { id: 'card', origin: 'search' },
      { id: 'panel', origin: 'manual' },
      { id: 'recognized', origin: 'manual' },
    ])
  })
})

describe('миграция имени пользователя', () => {
  const usernameIdx = journal.entries.findIndex(entry =>
    readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8').includes(
      'RENAME COLUMN "name" TO "username"',
    ),
  )

  it('логином становится имя аккаунта, email уходит, версия сессий остаётся', () => {
    const sqlite = new Database(':memory:')
    const db = drizzle(sqlite)

    migrate(db, { migrationsFolder: migrationsBefore(usernameIdx) })

    sqlite
      .prepare(
        'INSERT INTO users (id, name, email, password_hash, session_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('u1', 'Anton', 'owner@example.com', 'x', 3, 0, 0)

    migrate(db, { migrationsFolder: MIGRATIONS_DIR })

    expect(
      sqlite.prepare('SELECT id, username, session_version FROM users').all(),
    ).toEqual([{ id: 'u1', username: 'Anton', session_version: 3 }])
    expect(
      sqlite
        .prepare('SELECT name FROM pragma_table_info(\'users\')')
        .all()
        .map(column => (column as { name: string }).name),
    ).not.toContain('email')
  })
})
