import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  copyData,
  mapPath,
  readOwner,
  sanitizeDb,
  savedStoragePath,
  standDirFor,
} from './standData.ts'

let root: string

function dataAt(dir: string) {
  return {
    dataDir: dir,
    databasePath: join(dir, 'torsher.db'),
    downloadsPath: join(dir, 'downloads'),
    libraryPath: join(dir, 'library'),
  }
}

function createSourceDb(path: string) {
  const db = new Database(path)

  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
    CREATE TABLE torrents (id TEXT PRIMARY KEY, download_dir TEXT);
    CREATE TABLE storage_moves (id TEXT PRIMARY KEY);
    CREATE TABLE notification_channels (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
    CREATE TABLE library_folders (id TEXT PRIMARY KEY, path TEXT NOT NULL);
    CREATE TABLE server_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `)

  return db
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torsher-stand-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('standDirFor', () => {
  it('names the stand after the checkout and keeps worktrees apart', () => {
    const a = standDirFor('/tmp/stands', '/work/torsher-app')
    const b = standDirFor('/tmp/stands', '/work/torsher-app/.worktrees/x')

    expect(a).toMatch(/^\/tmp\/stands\/torsher-app-[0-9a-f]{8}$/)
    expect(b).toMatch(/^\/tmp\/stands\/x-[0-9a-f]{8}$/)
    expect(standDirFor('/tmp/stands', '/work/torsher-app/')).toBe(a)
  })
})

describe('mapPath', () => {
  const moves: [string, string][] = [['/src/data', '/stand/data']]

  it('moves paths inside a source dir to the stand', () => {
    expect(mapPath('/src/data/library', moves)).toBe('/stand/data/library')
    expect(mapPath('/src/data', moves)).toBe('/stand/data')
  })

  it('leaves paths outside and lookalike prefixes alone', () => {
    expect(mapPath('/media/movies', moves)).toBeUndefined()
    expect(mapPath('/src/data-other', moves)).toBeUndefined()
  })
})

describe('copy and sanitize', () => {
  it('copies a consistent snapshot without touching the source', async () => {
    const source = dataAt(join(root, 'source'))
    const stand = dataAt(join(root, 'stand'))

    mkdirSync(source.dataDir, { recursive: true })
    writeFileSync(join(source.dataDir, 'secret.key'), 'key')

    const db = createSourceDb(source.databasePath)

    // Строка остаётся в WAL: снимок обязан её увидеть
    db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(
      'u1',
      'me@real.test',
      'hash',
    )

    const hashOf = (path: string) =>
      createHash('sha256').update(readFileSync(path)).digest('hex')
    const before = [source.databasePath, `${source.databasePath}-wal`].map(
      hashOf,
    )

    await copyData(source, stand, false)

    expect(
      [source.databasePath, `${source.databasePath}-wal`].map(hashOf),
    ).toEqual(before)
    expect(readOwner(stand.databasePath)?.email).toBe('me@real.test')
    expect(readFileSync(join(stand.dataDir, 'secret.key'), 'utf8')).toBe('key')
    db.close()
  })

  it('keeps the copy away from the developer paths, backups and channels', async () => {
    const source = dataAt(join(root, 'source'))
    const stand = dataAt(join(root, 'stand'))

    mkdirSync(source.dataDir, { recursive: true })

    const db = createSourceDb(source.databasePath)

    db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(
      'u1',
      'me@real.test',
      'hash',
    )
    db.prepare('INSERT INTO torrents VALUES (?, ?)').run(
      't1',
      '/media/torrents',
    )
    db.prepare('INSERT INTO storage_moves VALUES (?)').run('m1')
    db.prepare('INSERT INTO notification_channels VALUES (?, 1)').run('c1')
    db.prepare('INSERT INTO library_folders VALUES (?, ?)').run(
      'own',
      source.libraryPath,
    )
    db.prepare('INSERT INTO library_folders VALUES (?, ?)').run(
      'picked',
      '/media/movies',
    )

    const setting = db.prepare('INSERT INTO server_settings VALUES (?, ?, 0)')

    setting.run(
      'storage.paths',
      JSON.stringify({ downloads: '/media/torrents' }),
    )
    setting.run(
      'backups',
      JSON.stringify({ enabled: true, dir: '/media/backups', time: '03:00' }),
    )
    db.close()

    expect(savedStoragePath(source.databasePath, 'downloads')).toBe(
      '/media/torrents',
    )

    await copyData(source, stand, false)
    sanitizeDb(stand.databasePath, source, stand, 'stand@example.test')

    const copy = new Database(stand.databasePath, { readonly: true })
    const value = (sql: string) => copy.prepare(sql).pluck().all()

    expect(value('SELECT email FROM users')).toEqual(['stand@example.test'])
    expect(value('SELECT download_dir FROM torrents')).toEqual([null])
    expect(value('SELECT id FROM storage_moves')).toEqual([])
    expect(value('SELECT enabled FROM notification_channels')).toEqual([0])
    expect(value('SELECT path FROM library_folders ORDER BY id')).toEqual([
      stand.libraryPath,
      '/media/movies',
    ])
    expect(
      value(`SELECT key FROM server_settings WHERE key = 'storage.paths'`),
    ).toEqual([])
    expect(
      JSON.parse(
        value(
          `SELECT value FROM server_settings WHERE key = 'backups'`,
        )[0] as string,
      ),
    ).toEqual({ enabled: false, time: '03:00' })
    copy.close()

    expect(readOwner(source.databasePath)?.email).toBe('me@real.test')
  })

  it('turns scheduled backups off when the copy has no backup settings', async () => {
    const source = dataAt(join(root, 'source'))
    const stand = dataAt(join(root, 'stand'))

    mkdirSync(source.dataDir, { recursive: true })
    createSourceDb(source.databasePath).close()

    await copyData(source, stand, false)
    sanitizeDb(stand.databasePath, source, stand, 'stand@example.test')

    const copy = new Database(stand.databasePath, { readonly: true })

    expect(
      copy
        .prepare(`SELECT value FROM server_settings WHERE key = 'backups'`)
        .pluck()
        .get(),
    ).toBe(JSON.stringify({ enabled: false }))
    copy.close()
  })
})
