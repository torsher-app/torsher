import type { BackupPaths } from './paths.ts'
import { Buffer } from 'node:buffer'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  migrationsBefore,
  migrationsWithExtra,
  readMigrationsJournal,
} from '../../db/fixtures/index.ts'
import { MIGRATIONS_DIR } from '../../db/index.ts'
import { createBackup } from './create.ts'
import {
  count,
  createFileDb,
  openFileDb,
  seedData,
  tempDataDir,
} from './fixtures/index.ts'
import { MANIFEST_TABLE } from './manifest.ts'
import { backupPathsFor } from './paths.ts'
import {
  applyPendingRestore,
  finalizeRestore,
  restoreDeps,
} from './restore-apply.ts'
import {
  openBackupFile,
  prepareRestore,
  verifyBackupFile,
} from './restore-request.ts'
import { readRestoreState, writeRestoreState } from './restore-state.ts'

const OLD_COUNT = 12
const backupKey = Buffer.alloc(32, 9)
const currentKey = Buffer.alloc(32, 1)
const temp: string[] = []

function track<T extends string>(dir: T) {
  temp.push(dir)
  return dir
}

afterEach(() => {
  vi.restoreAllMocks()

  for (const dir of temp.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** Копия базы, созданной миграциями `migrationsFolder` */
async function backupOf(
  migrationsFolder: string,
  target: string,
  prepare?: (db: Database.Database) => void,
) {
  const source = track(tempDataDir())
  const { db, dbPath } = createFileDb(source, migrationsFolder)

  seedData(db)
  prepare?.(db)
  db.close()

  const created = await createBackup({
    dbPath,
    tmpDir: join(source, 'backups-tmp'),
    dir: target,
    reason: 'scheduled',
    version: '0.9.0',
    secretKey: backupKey,
  })

  return join(target, created.name)
}

/** Сервер со своей базой, ключом секретов и каталогом копий */
function server() {
  const dataDir = track(tempDataDir())
  const { db, dbPath } = createFileDb(dataDir)
  const now = Date.now()

  db.prepare(
    'INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('current', 'Current', 'hash', now, now)
  db.close()
  writeFileSync(
    join(dataDir, 'secret.key'),
    `${currentKey.toString('base64')}\n`,
  )

  const backups = join(dataDir, 'backups')

  mkdirSync(backups)

  return { dataDir, dbPath, backups, paths: backupPathsFor(dbPath, dataDir) }
}

async function request(path: string, paths: BackupPaths) {
  await prepareRestore({
    path,
    backupName: 'backup',
    opened: await openBackupFile(path),
    paths,
    preRestore: () =>
      createBackup({
        dbPath: paths.dbPath,
        tmpDir: paths.tmpDir,
        dir: join(paths.dataDir, 'backups'),
        reason: 'pre-restore',
        version: '1.0.0',
        secretKey: currentKey,
      }),
  })
}

function files(dbPath: string) {
  return {
    db: readFileSync(dbPath),
    wal: existsSync(`${dbPath}-wal`)
      ? readFileSync(`${dbPath}-wal`)
      : undefined,
  }
}

describe('восстановление', () => {
  it('старая копия на новой схеме: миграции догоняют, данные и аккаунт на месте', async () => {
    const { dbPath, backups, paths } = server()
    const old = migrationsBefore(OLD_COUNT)

    track(old)

    const backup = await backupOf(old, backups)

    await request(backup, paths)

    expect(readRestoreState(paths.statePath)).toMatchObject({
      state: 'pending',
    })
    // Проверенный снимок и ключ копии — только для владельца
    expect(statSync(paths.pendingPath).mode & 0o777).toBe(0o600)
    expect(statSync(paths.pendingKeyPath).mode & 0o777).toBe(0o600)

    const result = await applyPendingRestore(paths)

    expect(result).toMatchObject({ applied: true, warnings: [] })

    const db = new Database(dbPath, { readonly: true })

    expect(count(db, '__drizzle_migrations')).toBe(
      readMigrationsJournal().entries.length,
    )
    expect(db.prepare('SELECT id FROM users').all()).toEqual([{ id: 'owner' }])
    expect(db.prepare('SELECT kind FROM title_aliases').all()).toEqual([
      { kind: 'user' },
    ])
    expect(
      db
        .prepare(`SELECT 1 FROM sqlite_master WHERE name = ?`)
        .get(MANIFEST_TABLE),
    ).toBeUndefined()
    db.close()

    // Ключ секретов — из копии, прежний сохранён до конца восстановления
    expect(readFileSync(paths.keyPath, 'utf8').trim()).toBe(
      backupKey.toString('base64'),
    )
    expect(existsSync(`${dbPath}.pre-restore`)).toBe(true)
    expect(existsSync(`${paths.keyPath}.pre-restore`)).toBe(true)

    finalizeRestore(paths)

    expect(existsSync(`${dbPath}.pre-restore`)).toBe(false)
    expect(existsSync(`${paths.keyPath}.pre-restore`)).toBe(false)
    expect(readRestoreState(paths.statePath)).toMatchObject({
      state: 'done',
      backup: 'backup',
    })
  })

  it('restores personal data and its local versions from a current backup', async () => {
    const { dbPath, backups, paths } = server()
    let token: unknown
    const backup = await backupOf(MIGRATIONS_DIR, backups, (db) => {
      db.exec(`
        INSERT INTO profiles (id,name,color,position,created_at)
        VALUES ('diary-viewer','Viewer','blue',1,0);
        INSERT INTO diary_entries
          (profile_id,id,title_id,season,episode,precision,day,origin,note,created_at,updated_at)
        VALUES ('diary-viewer','entry','tmdb:movie:21',0,0,'day','2024-02-29','manual','A note',1,1);
        INSERT INTO diary_seen (profile_id,title_id,season,episode)
        VALUES ('diary-viewer','tmdb:movie:21',0,0);
        INSERT INTO rewatch_cycles
          (profile_id,id,title_id,start_season,start_episode,target_season,target_episode,state,created_at,updated_at)
        VALUES ('diary-viewer','cycle','tmdb:tv:22',1,1,2,3,'paused',1,2);
        INSERT INTO cycle_progress (profile_id,cycle_id,season,episode,position,updated_at)
        VALUES ('diary-viewer','cycle',2,3,350,2);
        INSERT INTO mine_title_preferences (profile_id,title_id,note,continuation,updated_at)
        VALUES ('diary-viewer','tmdb:tv:22','Remember', 'paused', 2);
        INSERT INTO mine_profile_preferences (profile_id,start_section,updated_at)
        VALUES ('diary-viewer','diary',2);
        INSERT INTO server_settings (key,value,updated_at)
        VALUES ('mine.diaryTimeZone','"Pacific/Auckland"',1);
      `)
      token = db
        .prepare('SELECT mutation_token FROM diary_entries')
        .pluck()
        .get()
    })

    await request(backup, paths)
    expect(await applyPendingRestore(paths)).toMatchObject({
      applied: true,
      warnings: [],
    })
    const db = new Database(dbPath, { readonly: true })
    try {
      expect(token).toEqual(expect.any(String))
      expect(
        db.prepare('SELECT day, note, mutation_token FROM diary_entries').get(),
      ).toEqual({
        day: '2024-02-29',
        note: 'A note',
        mutation_token: token,
      })
      expect(count(db, 'diary_seen')).toBe(1)
      expect(db.prepare('SELECT state FROM rewatch_cycles').pluck().get()).toBe(
        'paused',
      )
      expect(
        db.prepare('SELECT position FROM cycle_progress').pluck().get(),
      ).toBe(350)
      expect(
        db.prepare('SELECT note FROM mine_title_preferences').pluck().get(),
      ).toBe('Remember')
      expect(
        db
          .prepare('SELECT start_section FROM mine_profile_preferences')
          .pluck()
          .get(),
      ).toBe('diary')
      expect(
        db
          .prepare(
            'SELECT json_extract(value,\'$\') FROM server_settings WHERE key = \'mine.diaryTimeZone\'',
          )
          .pluck()
          .get(),
      ).toBe('Pacific/Auckland')
    }
    finally {
      db.close()
    }
  })

  it('с TORSHER_SECRET файл ключа не трогается, другой ключ копии — предупреждение', async () => {
    const { backups, paths } = server()
    const backup = await backupOf(MIGRATIONS_DIR, backups)

    await request(backup, paths)

    const result = await applyPendingRestore(paths, 'some other secret')

    expect(result).toMatchObject({
      applied: true,
      warnings: [{ kind: 'secret_mismatch' }],
    })
    expect(readFileSync(paths.keyPath, 'utf8').trim()).toBe(
      currentKey.toString('base64'),
    )
  })

  it('копия от более новой версии — newer_version, текущая база не тронута', async () => {
    const { dbPath, backups, paths } = server()
    const newer = track(
      migrationsWithExtra('CREATE TABLE `future_things` (`id` integer);'),
    )
    const backup = await backupOf(newer, backups)
    const before = files(dbPath)

    await expect(request(backup, paths)).rejects.toMatchObject({
      kind: 'newer_version',
    })
    expect(files(dbPath)).toEqual(before)
    expect(existsSync(paths.pendingPath)).toBe(false)
    expect(readRestoreState(paths.statePath)).toBeUndefined()
  })

  it('чужая база SQLite — not_torsher', async () => {
    const { dataDir, backups } = server()
    const foreignDir = track(tempDataDir())
    const foreign = new Database(join(foreignDir, 'torsher.db'))

    foreign.exec('CREATE TABLE notes (id integer)')
    foreign.close()

    const backup = await createBackup({
      dbPath: join(foreignDir, 'torsher.db'),
      tmpDir: join(foreignDir, 'tmp'),
      dir: backups,
      reason: 'manual',
      version: '1.0.0',
      secretKey: backupKey,
    })
    const path = join(backups, backup.name)

    await expect(
      verifyBackupFile(path, await openBackupFile(path), {
        tmpDir: join(dataDir, 'backups-tmp'),
        dataDir,
        migrationsFolder: MIGRATIONS_DIR,
      }),
    ).rejects.toMatchObject({ kind: 'not_torsher' })
  })

  it('старт посреди подмены (applying) — откат, failed/interrupted, база побайтно та же', async () => {
    const { dbPath, paths } = server()
    // Сервер работал: часть данных в журнале WAL
    const live = openFileDb(dbPath)

    live
      .prepare(
        'INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)',
      )
      .run('k', '"v"', 0)

    const before = files(dbPath)

    // Питание пропало после переноса базы, но до конца подмены
    writeRestoreState(paths.statePath, {
      state: 'applying',
      backup: 'backup',
      requestedAt: new Date().toISOString(),
      hadDb: true,
      keySwapped: true,
      keyHadPrevious: true,
    })
    renameSync(`${dbPath}-wal`, `${dbPath}-wal.pre-restore`)
    renameSync(`${dbPath}-shm`, `${dbPath}-shm.pre-restore`)
    renameSync(dbPath, `${dbPath}.pre-restore`)
    writeFileSync(dbPath, 'half-restored')
    renameSync(paths.keyPath, `${paths.keyPath}.pre-restore`)
    writeFileSync(paths.keyPath, 'new key')

    const result = await applyPendingRestore(paths)

    expect(result).toMatchObject({
      applied: false,
      failed: true,
      reason: 'interrupted',
    })
    expect(readRestoreState(paths.statePath)).toMatchObject({
      state: 'failed',
      reason: 'interrupted',
    })
    expect(files(dbPath)).toEqual(before)
    expect(readFileSync(paths.keyPath, 'utf8').trim()).toBe(
      currentKey.toString('base64'),
    )
    expect(existsSync(`${dbPath}.pre-restore`)).toBe(false)
    live.close()
  })

  it('падение миграции после подмены — откат базы и ключа', async () => {
    const { dbPath, backups, paths } = server()
    const backup = await backupOf(MIGRATIONS_DIR, backups)

    await request(backup, paths)

    const before = files(dbPath)
    const broken = track(migrationsWithExtra('THIS IS NOT SQL;'))
    const result = await applyPendingRestore({
      ...paths,
      migrationsFolder: broken,
    })

    expect(result).toMatchObject({
      applied: false,
      failed: true,
      reason: 'migration_failed',
    })
    expect(files(dbPath)).toEqual(before)
    expect(readFileSync(paths.keyPath, 'utf8').trim()).toBe(
      currentKey.toString('base64'),
    )
    expect(existsSync(paths.pendingPath)).toBe(false)
    expect(existsSync(paths.pendingKeyPath)).toBe(false)
  })

  it('без restore.json старт ничего не меняет и убирает брошенный снимок', async () => {
    const { dbPath, paths } = server()
    const before = files(dbPath)

    writeFileSync(paths.pendingPath, 'leftover')

    expect(await applyPendingRestore(paths)).toEqual({ applied: false })
    expect(files(dbPath)).toEqual(before)
    expect(existsSync(paths.pendingPath)).toBe(false)
  })
  it('сбой записи ключа посреди подмены (ENOSPC) — прежний ключ побайтно на месте', async () => {
    const { dbPath, backups, paths } = server()
    const backup = await backupOf(MIGRATIONS_DIR, backups)

    await request(backup, paths)

    const before = files(dbPath)
    const keyBefore = readFileSync(paths.keyPath)

    vi.spyOn(restoreDeps, 'writeKeyFile').mockImplementation((path) => {
      writeFileSync(path, 'half')
      throw Object.assign(new Error('no space left on device'), {
        code: 'ENOSPC',
      })
    })

    const result = await applyPendingRestore(paths)

    expect(result).toMatchObject({
      applied: false,
      failed: true,
      reason: 'no_space',
    })
    expect(readFileSync(paths.keyPath)).toEqual(keyBefore)
    expect(existsSync(`${paths.keyPath}.pre-restore`)).toBe(false)
    expect(files(dbPath)).toEqual(before)
  })

  it('пустой restore-pending.db — failed, исходная база на месте', async () => {
    const { dbPath, paths } = server()
    const before = files(dbPath)

    writeFileSync(paths.pendingPath, '')
    writeRestoreState(paths.statePath, {
      state: 'pending',
      backup: 'backup',
      requestedAt: new Date().toISOString(),
    })

    const result = await applyPendingRestore(paths)

    expect(result).toMatchObject({
      applied: false,
      failed: true,
      reason: 'not_torsher',
    })
    expect(files(dbPath)).toEqual(before)
    expect(existsSync(paths.pendingPath)).toBe(false)
  })

  it('копия без аккаунта — not_torsher уже на проверке', async () => {
    const { dataDir, backups } = server()
    const source = track(tempDataDir())
    const { db, dbPath } = createFileDb(source)

    db.close()

    const created = await createBackup({
      dbPath,
      tmpDir: join(source, 'tmp'),
      dir: backups,
      reason: 'manual',
      version: '1.0.0',
      secretKey: backupKey,
    })
    const path = join(backups, created.name)

    await expect(
      verifyBackupFile(path, await openBackupFile(path), {
        tmpDir: join(dataDir, 'backups-tmp'),
        dataDir,
        migrationsFolder: MIGRATIONS_DIR,
      }),
    ).rejects.toMatchObject({ kind: 'not_torsher' })
  })

  it('два восстановления одновременно — второе busy', async () => {
    const { backups, paths } = server()
    const backup = await backupOf(MIGRATIONS_DIR, backups)
    const results = await Promise.allSettled([
      request(backup, paths),
      request(backup, paths),
    ])

    expect(results.map(result => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ])
    expect(
      results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      )?.reason,
    ).toMatchObject({ kind: 'busy' })
    expect(existsSync(paths.restoreLockPath)).toBe(false)
  })
  it('остатки .pre-restore прошлого восстановления не возвращаются при сбое нового', async () => {
    const { dbPath, backups, paths } = server()
    const backup = await backupOf(MIGRATIONS_DIR, backups)

    await request(backup, paths)

    // Прошлое восстановление применилось, но не успело убрать прежние файлы
    writeFileSync(`${dbPath}.pre-restore`, 'older database')
    writeFileSync(`${dbPath}-wal.pre-restore`, 'older wal')
    writeFileSync(`${paths.keyPath}.pre-restore`, 'older key')

    const before = files(dbPath)
    const keyBefore = readFileSync(paths.keyPath)
    const broken = track(migrationsWithExtra('THIS IS NOT SQL;'))
    const result = await applyPendingRestore({
      ...paths,
      migrationsFolder: broken,
    })

    expect(result).toMatchObject({
      applied: false,
      failed: true,
      reason: 'migration_failed',
    })
    expect(files(dbPath)).toEqual(before)
    expect(readFileSync(paths.keyPath)).toEqual(keyBefore)
    expect(existsSync(`${dbPath}.pre-restore`)).toBe(false)
    expect(existsSync(`${paths.keyPath}.pre-restore`)).toBe(false)
  })
})
