import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { durableSqlite } from './durable.ts'

it('fsyncs the durable boundary in a real WAL database and restores NORMAL after success/failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'torsher-maintenance-wal-'))
  const path = join(root, 'synthetic.db')
  let sqlite = new Database(path)
  try {
    sqlite.pragma('journal_mode=WAL')
    sqlite.exec('CREATE TABLE operations (id TEXT PRIMARY KEY)')
    sqlite.close()
    sqlite = new Database(path)
    sqlite.pragma('synchronous=NORMAL')
    expect(sqlite.pragma('synchronous', { simple: true })).toBe(1)
    durableSqlite(sqlite, () => {
      expect(sqlite.pragma('synchronous', { simple: true })).toBe(2)
      sqlite.prepare('INSERT INTO operations VALUES (?)').run('durable')
    })
    expect(sqlite.pragma('synchronous', { simple: true })).toBe(1)
    expect(() =>
      durableSqlite(sqlite, () => {
        sqlite.prepare('INSERT INTO operations VALUES (?)').run('rollback')
        throw new Error('synthetic_crash')
      }),
    ).toThrow('synthetic_crash')
    expect(sqlite.pragma('synchronous', { simple: true })).toBe(1)
    expect(sqlite.prepare('SELECT id FROM operations').pluck().all()).toEqual([
      'durable',
    ])
  }
  finally {
    sqlite.close()
    await rm(root, { recursive: true, force: true })
  }
})
