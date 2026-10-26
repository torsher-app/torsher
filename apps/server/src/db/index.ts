import type {
  BackupErrorKind,
  BackupErrorParams,
} from '../services/backups/errors.ts'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { config } from '../config.ts'
import { BackupError, toBackupError } from '../services/backups/errors.ts'
import { backupErrorText } from '../services/backups/messages.ts'
import {
  compareSchema,
  lastAppliedAt,
  readJournal,
} from '../services/backups/schema-version.ts'
import * as schema from './schema.ts'

export const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

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

/** База от более новой версии: её миграций нет в этой сборке */
export class DowngradeError extends Error {
  readonly backup?: string

  constructor(backup?: string) {
    super(
      backup
        ? `The database was updated by a newer version of Torsher. Start that version again, or restore the backup made before the update: torsher restore ${backup}`
        : 'The database was updated by a newer version of Torsher. Start that version again, or restore a backup made before the update (torsher backups lists them).',
    )
    this.name = 'DowngradeError'
    this.backup = backup
  }
}

/** Копия перед миграциями не удалась: обновлять базу без неё сервер не станет */
export class PreUpdateBackupError extends Error {
  readonly kind: BackupErrorKind
  readonly params: BackupErrorParams

  constructor(
    kind: BackupErrorKind,
    params: BackupErrorParams,
    cause: unknown,
  ) {
    // Текст читают в журнале контейнера, где панели нет: причина — словами
    const [reason, hint]
      = kind === 'key_unavailable'
        ? [
            'The backup password cannot be read with the current secret key (TORSHER_SECRET or secret.key changed).',
            'Put the previous key back, or set TORSHER_SKIP_PRE_UPDATE_BACKUP=1 once and set the backup password again in Settings > Backups.',
          ]
        : [
            backupErrorText(new BackupError(kind, params)),
            'Free up space or fix access to the backups folder, or set TORSHER_SKIP_PRE_UPDATE_BACKUP=1 to update without a backup.',
          ]

    super(
      `Could not back up the database before updating it. ${reason} The database was not changed. ${hint}`,
      { cause },
    )
    this.name = 'PreUpdateBackupError'
    this.kind = kind
    this.params = params
  }
}

export interface MigrateOptions {
  migrationsFolder: string
  dbPath: string
  dataDir: string
  preUpdateBackup: boolean
  skipPreUpdateBackup: boolean
}

export interface MigrateReport {
  backup?: { name: string, size: number, dirKind: 'main' | 'fallback' }
  /** Копия не удалась, а владелец разрешил обновляться без неё */
  skippedBackup?: { kind: BackupErrorKind, params: BackupErrorParams }
}

/**
 * Миграции на данном соединении: запрет даунгрейда, копия перед миграциями
 * (если они есть, а база не пустая), затем Drizzle.
 */
export async function migrateConnection(
  sqlite: Database.Database,
  options: MigrateOptions,
): Promise<MigrateReport> {
  const { lastWhen } = readJournal(options.migrationsFolder)
  const applied = lastAppliedAt(sqlite)
  const schemaState = compareSchema(applied, lastWhen)
  const report: MigrateReport = {}

  if (schemaState === 'ahead') {
    const { latestPreUpdate }
      = await import('../services/backups/pre-update.ts')

    throw new DowngradeError(
      await latestPreUpdate(sqlite, options.dbPath, options.dataDir).catch(
        () => undefined,
      ),
    )
  }

  if (
    schemaState === 'behind'
    && applied !== null
    && options.preUpdateBackup
    && options.dbPath !== ':memory:'
  ) {
    // Модуль копий тянет за собой сервисы, которые сами импортируют базу
    const { preUpdateBackup }
      = await import('../services/backups/pre-update.ts')

    try {
      const created = await preUpdateBackup({
        db: sqlite,
        dbPath: options.dbPath,
        dataDir: options.dataDir,
      })

      report.backup = {
        name: created.name,
        size: created.size,
        dirKind: created.dirKind,
      }
    }
    catch (err) {
      const error = toBackupError(err)

      if (!options.skipPreUpdateBackup)
        throw new PreUpdateBackupError(error.kind, error.params, err)

      report.skippedBackup = { kind: error.kind, params: error.params }
    }
  }

  migrate(drizzle(sqlite), { migrationsFolder: options.migrationsFolder })

  return report
}

export function migrateDb(options: Partial<MigrateOptions> = {}) {
  return migrateConnection(getDb().$client, {
    migrationsFolder: MIGRATIONS_DIR,
    dbPath: config.databasePath,
    dataDir: config.dataDir,
    preUpdateBackup: true,
    skipPreUpdateBackup: config.skipPreUpdateBackup,
    ...options,
  })
}
