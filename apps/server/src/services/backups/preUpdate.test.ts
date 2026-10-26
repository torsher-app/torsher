import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  migrationsBefore,
  migrationsWithExtra,
  readMigrationsJournal,
} from '../../db/fixtures/index.ts'
import {
  DowngradeError,
  migrateConnection,
  MIGRATIONS_DIR,
  PreUpdateBackupError,
} from '../../db/index.ts'
import {
  count,
  createFileDb,
  openFileDb,
  seedData,
  tempDataDir,
} from './fixtures/index.ts'

const OLD_COUNT = 12
const temp: string[] = []

function track(dir: string) {
  temp.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temp.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** База прежней версии с аккаунтом и данными */
function oldServer() {
  const dataDir = track(tempDataDir())
  const { db, dbPath } = createFileDb(
    dataDir,
    track(migrationsBefore(OLD_COUNT)),
  )

  seedData(db)

  return { db, dbPath, dataDir }
}

function options(dbPath: string, dataDir: string, extra = {}) {
  return {
    migrationsFolder: MIGRATIONS_DIR,
    dbPath,
    dataDir,
    preUpdateBackup: true,
    skipPreUpdateBackup: false,
    ...extra,
  }
}

function backupsIn(dir: string) {
  return existsSync(dir)
    ? readdirSync(dir).filter(name => name.startsWith('torsher-backup-'))
    : []
}

const fullCount = readMigrationsJournal().entries.length

describe('копия перед миграциями', () => {
  it('есть новые миграции — одна копия pre-update, повторный старт копию не делает', async () => {
    const { db, dbPath, dataDir } = oldServer()

    const report = await migrateConnection(db, options(dbPath, dataDir))
    const dir = join(dataDir, 'backups')

    expect(report.backup).toMatchObject({ dirKind: 'main' })
    expect(backupsIn(dir)).toEqual([report.backup!.name])
    expect(report.backup!.name).toMatch(/-pre-update-v/)
    expect(count(db, '__drizzle_migrations')).toBe(fullCount)

    const again = await migrateConnection(db, options(dbPath, dataDir))

    expect(again.backup).toBeUndefined()
    expect(backupsIn(dir)).toHaveLength(1)
    db.close()
  })

  it('в имени копии — версия, с которой работала база, а не новая', async () => {
    const dataDir = track(tempDataDir())
    const { db, dbPath } = createFileDb(
      dataDir,
      track(migrationsBefore(fullCount - 1)),
    )

    seedData(db)
    db.prepare(
      'INSERT INTO server_versions (version, started_at) VALUES (?, ?), (?, ?)',
    ).run('0.9.0', 0, '0.9.1', 0)

    const report = await migrateConnection(db, options(dbPath, dataDir))

    expect(report.backup!.name).toMatch(/-pre-update-v0\.9\.1\.db\.gz$/)
    db.close()
  })

  it('выбранный каталог недоступен — копия в каталог по умолчанию', async () => {
    const { db, dbPath, dataDir } = oldServer()

    db.prepare(
      'INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)',
    ).run(
      'backups',
      JSON.stringify({ dir: join(dataDir, 'nas-not-mounted') }),
      0,
    )

    const report = await migrateConnection(db, options(dbPath, dataDir))

    expect(report.backup?.dirKind).toBe('fallback')
    expect(backupsIn(join(dataDir, 'backups'))).toHaveLength(1)
    db.close()
  })

  it('каталог и запасной недоступны — ошибка, миграции не применены; с разрешением — применены', async () => {
    const { db, dbPath, dataDir } = oldServer()

    db.prepare(
      'INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)',
    ).run(
      'backups',
      JSON.stringify({ dir: join(dataDir, 'nas-not-mounted') }),
      0,
    )
    // На месте каталога по умолчанию — файл: туда не записать
    writeFileSync(join(dataDir, 'backups'), '')

    const error = await migrateConnection(db, options(dbPath, dataDir)).catch(
      err => err,
    )

    expect(error).toBeInstanceOf(PreUpdateBackupError)
    expect(error.message).toContain(
      `The backups folder ${join(dataDir, 'backups')} is unavailable.`,
    )
    expect(count(db, '__drizzle_migrations')).toBe(OLD_COUNT)

    const report = await migrateConnection(
      db,
      options(dbPath, dataDir, { skipPreUpdateBackup: true }),
    )

    expect(report.skippedBackup).toMatchObject({ kind: 'dir_unavailable' })
    expect(count(db, '__drizzle_migrations')).toBe(fullCount)
    db.close()
  })

  it('не хватает места — причина с размерами для человека', () => {
    const error = new PreUpdateBackupError(
      'no_space',
      { need: 67952984, free: 1048576 },
      undefined,
    )

    expect(error.message).toContain(
      'Not enough disk space: 64.8 MB needed, 1.0 MB free.',
    )
    expect(error.message).toContain('The database was not changed.')
  })

  it('пустая новая база — копии нет', async () => {
    const dataDir = track(tempDataDir())
    const dbPath = join(dataDir, 'torsher.db')
    const db = openFileDb(dbPath)

    const report = await migrateConnection(db, options(dbPath, dataDir))

    expect(report.backup).toBeUndefined()
    expect(backupsIn(join(dataDir, 'backups'))).toEqual([])
    expect(count(db, '__drizzle_migrations')).toBe(fullCount)
    db.close()
  })

  it('база от более новой версии — понятная ошибка с последней pre-update, база не тронута', async () => {
    const dataDir = track(tempDataDir())
    const { db, dbPath } = createFileDb(
      dataDir,
      track(
        migrationsWithExtra('CREATE TABLE `future_things` (`id` integer);'),
      ),
    )
    const name = 'torsher-backup-20261020T040000Z-pre-update-v0.9.0.db.gz'

    mkdirSync(join(dataDir, 'backups'))
    writeFileSync(join(dataDir, 'backups', name), '')

    const error = (await migrateConnection(db, options(dbPath, dataDir)).catch(
      err => err,
    )) as DowngradeError

    expect(error).toBeInstanceOf(DowngradeError)
    expect(error.message).toContain(`torsher restore ${name}`)
    expect(count(db, '__drizzle_migrations')).toBe(fullCount + 1)
    db.close()
  })
})
