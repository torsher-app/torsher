import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupBackupTemp } from './cleanup.ts'
import { ensureBackupDir } from './dir.ts'
import { fileDeps } from './files.ts'
import { inspectInWorker } from './snapshot.ts'
import { createBackup } from './create.ts'
import { BackupError } from './errors.ts'
import {
  count,
  createFileDb,
  seedData,
  tempDataDir,
} from './fixtures/index.ts'
import { listBackupsIn } from './list.ts'
import { MANIFEST_TABLE } from './manifest.ts'
import { gunzipToFile } from './crypto.ts'
import { backupDeps } from './space.ts'

const dirs: string[] = []
const secretKey = Buffer.alloc(32, 7)

function setup() {
  const dataDir = tempDataDir()

  dirs.push(dataDir)

  const { db, dbPath } = createFileDb(dataDir)

  seedData(db)

  const dir = join(dataDir, 'backups')

  mkdirSync(dir)

  return {
    db,
    dbPath,
    dataDir,
    dir,
    tmpDir: join(dataDir, 'backups-tmp'),
    options: {
      dbPath,
      tmpDir: join(dataDir, 'backups-tmp'),
      dir,
      reason: 'manual' as const,
      version: '1.2.3',
      secretKey,
    },
  }
}

async function unpack(path: string, dataDir: string) {
  const target = join(dataDir, 'unpacked.db')

  rmSync(target, { force: true })
  await gunzipToFile(path, target, Number.POSITIVE_INFINITY)

  return new Database(target, { readonly: true })
}

afterEach(() => {
  vi.restoreAllMocks()

  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('снимок базы', () => {
  it('идёт в потоке, пока главный поток пишет: снимок цел, без данных TMDB, с манифестом', async () => {
    const { db, dataDir, dir, tmpDir, options } = setup()
    const insert = db.prepare(
      'INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)',
    )
    let inserted = 0
    const progress = { done: false }
    const backup = createBackup(options).finally(() => {
      progress.done = true
    })

    // Вставки идут, пока снимок не готов: SQLITE_BUSY здесь уронил бы тест
    while (!progress.done) {
      insert.run(`key-${inserted}`, '"x"', Date.now())
      inserted++
      await new Promise(resolve => setImmediate(resolve))
    }

    const created = await backup

    expect(inserted).toBeGreaterThan(0)
    expect(created.name).toMatch(
      /^torsher-backup-\d{8}T\d{6}Z-manual-v1\.2\.3\.db\.gz$/,
    )
    expect(readdirSync(dir)).toEqual([created.name])
    expect(existsSync(tmpDir) ? readdirSync(tmpDir) : []).toEqual([])

    const snapshot = await unpack(join(dir, created.name), dataDir)

    expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(count(snapshot, 'users')).toBe(1)
    expect(count(snapshot, 'meta_cache')).toBe(0)
    expect(count(snapshot, 'title_external_ids')).toBe(0)
    expect(snapshot.prepare('SELECT kind FROM title_aliases').all()).toEqual([
      { kind: 'user' },
    ])
    expect(count(snapshot, 'server_settings')).toBeLessThanOrEqual(inserted)

    const manifest = Object.fromEntries(
      (
        snapshot.prepare(`SELECT key, value FROM ${MANIFEST_TABLE}`).all() as {
          key: string
          value: string
        }[]
      ).map(row => [row.key, row.value]),
    )

    expect(manifest).toMatchObject({
      format: '1',
      version: '1.2.3',
      reason: 'manual',
      secretKey: secretKey.toString('base64'),
    })
    snapshot.close()

    // Исходная база не тронута
    expect(count(db, 'meta_cache')).toBe(1)
    db.close()
  })

  it('в базе уже есть таблица манифеста (распакована из копии) — заменяется свежей', async () => {
    const { db, dataDir, dir, options } = setup()

    db.exec(
      `CREATE TABLE ${MANIFEST_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    )
    db.prepare(`INSERT INTO ${MANIFEST_TABLE} VALUES (?, ?)`).run(
      'version',
      '0.1.0',
    )

    const created = await createBackup(options)
    const snapshot = await unpack(join(dir, created.name), dataDir)
    const version = snapshot
      .prepare(`SELECT value FROM ${MANIFEST_TABLE} WHERE key = 'version'`)
      .get() as { value: string }

    expect(version.value).toBe('1.2.3')
    snapshot.close()
    db.close()
  })

  it('две копии в одну секунду получают разные имена', async () => {
    const { db, options, dir } = setup()
    const now = new Date('2026-10-24T01:00:00Z')
    const first = await createBackup({ ...options, now })
    const second = await createBackup({ ...options, now })

    expect(first.name).not.toBe(second.name)
    expect(readdirSync(dir).sort()).toEqual([first.name, second.name].sort())
    db.close()
  })

  it('файловая база обязательна', async () => {
    const { db, options } = setup()

    await expect(
      createBackup({ ...options, dbPath: ':memory:' }),
    ).rejects.toMatchObject({
      kind: 'io',
    })
    db.close()
  })
})

describe('права файлов', () => {
  it('копия 0600, временный каталог и каталог по умолчанию 0700', async () => {
    const { db, options, dir, tmpDir, dataDir } = setup()
    const created = await createBackup(options)

    expect(statSync(join(dir, created.name)).mode & 0o777).toBe(0o600)
    expect(statSync(tmpDir).mode & 0o777).toBe(0o700)

    const fresh = join(dataDir, 'fresh-backups')

    await ensureBackupDir({ path: fresh, source: 'default' })
    expect(statSync(fresh).mode & 0o777).toBe(0o700)
    db.close()
  })
})

describe('права по возможности', () => {
  it('chmod отвечает EPERM (ФС без прав POSIX) — копия всё равно создана', async () => {
    const { db, options, dir } = setup()

    vi.spyOn(fileDeps, 'chmod').mockRejectedValue(
      Object.assign(new Error('operation not permitted'), { code: 'EPERM' }),
    )

    const created = await createBackup(options)

    expect(fileDeps.chmod).toHaveBeenCalled()
    expect(readdirSync(dir)).toEqual([created.name])
    db.close()
  })
})

describe('проверка файла в потоке', () => {
  it('собирает факты о базе: целостность, таблицы, аккаунт, миграции', async () => {
    const { db, dbPath } = setup()

    db.close()

    const facts = await inspectInWorker({
      path: dbPath,
      manifestTable: MANIFEST_TABLE,
    })

    expect(facts).toMatchObject({
      integrity: 'ok',
      hasMigrations: true,
      hasUsers: true,
      users: 1,
    })
    expect(facts.lastApplied).toBeGreaterThan(0)
    expect(facts.manifest).toBeUndefined()
  })
})

describe('нехватка места', () => {
  it('до снимка: no_space с цифрами, файлов нет', async () => {
    const { db, options, dir, tmpDir } = setup()

    vi.spyOn(backupDeps, 'diskUsage').mockResolvedValue({
      total: 1e9,
      free: 1000,
    })

    const error = (await createBackup(options).catch(
      err => err,
    )) as BackupError

    expect(error).toBeInstanceOf(BackupError)
    expect(error.kind).toBe('no_space')
    expect(error.params.free).toBe(1000)
    expect(Number(error.params.need)).toBeGreaterThan(1000)
    expect(readdirSync(dir)).toEqual([])
    expect(readdirSync(tmpDir)).toEqual([])
    db.close()
  })

  it('eNOSPC посреди записи: no_space, временные файлы удалены', async () => {
    const { db, options, dir, tmpDir } = setup()

    vi.spyOn(backupDeps, 'createWriteStream').mockImplementation(((
      path: string,
    ) => {
      writeFileSync(path, 'partial')

      return new Writable({
        write(_chunk, _encoding, callback) {
          callback(
            Object.assign(new Error('no space left on device'), {
              code: 'ENOSPC',
            }),
          )
        },
      })
    }) as unknown as typeof backupDeps.createWriteStream)

    await expect(createBackup(options)).rejects.toMatchObject({
      kind: 'no_space',
    })
    expect(readdirSync(dir)).toEqual([])
    expect(readdirSync(tmpDir)).toEqual([])
    db.close()
  })
})

describe('прерывание', () => {
  it('отмена снимка обрывает поток: io, временные файлы удалены', async () => {
    const { db, options, dir, tmpDir } = setup()
    const insert = db.prepare(
      'INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)',
    )

    // База побольше, чтобы снимок шёл заметное время
    db.transaction(() => {
      for (let i = 0; i < 3000; i++) {
        insert.run(
          `big-${i}`,
          JSON.stringify(randomBytes(8192).toString('hex')),
          0,
        )
      }
    })()

    const controller = new AbortController()
    const backup = createBackup({ ...options, signal: controller.signal })

    // Поток уже пишет снимок: обрываем его посреди работы
    await vi.waitFor(
      () =>
        expect(existsSync(tmpDir) && readdirSync(tmpDir).length > 0).toBe(true),
      { interval: 1, timeout: 5000 },
    )
    controller.abort()

    await expect(backup).rejects.toMatchObject({ kind: 'io' })
    expect(readdirSync(dir)).toEqual([])
    expect(readdirSync(tmpDir)).toEqual([])
    db.close()
  })

  it('на старте брошенные .tmp и весь временный каталог удаляются и не попадают в список', async () => {
    const { db, dir, tmpDir, dataDir } = setup()
    const name = 'torsher-backup-20261024T040000Z-scheduled-v1.0.0.db.gz'

    mkdirSync(tmpDir)
    writeFileSync(join(tmpDir, 'snapshot-abc.db'), 'x')
    writeFileSync(join(dir, `${name}.tmp`), 'x')
    writeFileSync(join(dir, 'notes.tmp'), 'x')

    expect((await listBackupsIn(dir, dir)).items).toEqual([])

    await cleanupBackupTemp({ tmpDir, dirs: [dir] })

    expect(existsSync(tmpDir)).toBe(false)
    // Чужой файл в каталоге копий не трогаем
    expect(readdirSync(dir)).toEqual(['notes.tmp'])
    expect(dataDir).toBeTruthy()
    db.close()
  })
})
