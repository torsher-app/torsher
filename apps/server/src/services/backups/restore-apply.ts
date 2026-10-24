import type { BackupPaths } from './paths.ts'
import type { RestoreState, RestoreWarning } from './restore-state.ts'
import { createHash } from 'node:crypto'
import { existsSync, renameSync, rmSync } from 'node:fs'
import Database from 'better-sqlite3'
import { migrateConnection } from '../../db/index.ts'
import { toBackupError } from './errors.ts'
import { readKeyFile, writeKeyFile } from './files.ts'
import { MANIFEST_TABLE } from './manifest.ts'
import { readRestoreState, writeRestoreState } from './restore-state.ts'
import { lastAppliedAt } from './schema-version.ts'

const DB_SUFFIXES = ['-wal', '-shm'] as const
const PRE_RESTORE = '.pre-restore'

type ApplyingState = Extract<RestoreState, { state: 'applying' }>

/** Подмена записи ключа в тестах: сбой посреди подмены */
export const restoreDeps = { writeKeyFile }

export type ApplyResult
  = | { applied: false }
    | { applied: true, backup: string, warnings: RestoreWarning[] }
    | {
      applied: false
      failed: true
      backup?: string
      reason: string
      error?: unknown
    }

function moveIfExists(from: string, to: string) {
  if (existsSync(from))
    renameSync(from, to)
}

function removeDbFiles(dbPath: string) {
  rmSync(dbPath, { force: true })

  for (const suffix of DB_SUFFIXES)
    rmSync(`${dbPath}${suffix}`, { force: true })
}

/**
 * Возврат прежней базы и ключа. Журнал и общая память переносятся раньше
 * самой базы, поэтому `torsher.db.pre-restore` на месте — значит, перенесено
 * всё, и текущие файлы принадлежат копии. Прежний ключ возвращается всегда,
 * если он отложен: отметка в состоянии могла не успеть записаться. Каждый
 * шаг можно повторить.
 */
function rollback(paths: BackupPaths, state: ApplyingState) {
  const { dbPath, keyPath } = paths

  if (!state.hadDb) {
    removeDbFiles(dbPath)
  }
  else if (existsSync(`${dbPath}${PRE_RESTORE}`)) {
    removeDbFiles(dbPath)
    renameSync(`${dbPath}${PRE_RESTORE}`, dbPath)
  }

  for (const suffix of DB_SUFFIXES)
    moveIfExists(`${dbPath}${suffix}${PRE_RESTORE}`, `${dbPath}${suffix}`)

  if (existsSync(`${keyPath}${PRE_RESTORE}`))
    renameSync(`${keyPath}${PRE_RESTORE}`, keyPath)
  else if (state.keySwapped && !state.keyHadPrevious)
    rmSync(keyPath, { force: true })

  rmSync(paths.pendingPath, { force: true })
  rmSync(paths.pendingKeyPath, { force: true })
}

function removePreRestore(paths: BackupPaths) {
  rmSync(`${paths.dbPath}${PRE_RESTORE}`, { force: true })

  for (const suffix of DB_SUFFIXES)
    rmSync(`${paths.dbPath}${suffix}${PRE_RESTORE}`, { force: true })

  rmSync(`${paths.keyPath}${PRE_RESTORE}`, { force: true })
}

function fail(
  paths: BackupPaths,
  state: ApplyingState,
  reason: string,
  error?: unknown,
): ApplyResult {
  rollback(paths, state)
  writeRestoreState(paths.statePath, {
    state: 'failed',
    backup: state.backup,
    at: new Date().toISOString(),
    reason,
  })

  return { applied: false, failed: true, backup: state.backup, reason, error }
}

/**
 * Ключ секретов из копии. Ключ из `TORSHER_SECRET` главнее файла: тогда
 * файл не трогаем, а несовпадение — предупреждение владельцу. Отметка о
 * подмене ставится в `state` до первой операции с файлами: откат после
 * любого сбоя знает, что возвращать.
 */
function swapKey(
  paths: BackupPaths,
  state: ApplyingState,
  envSecret: string | undefined,
  warnings: RestoreWarning[],
) {
  const backupKey = readKeyFile(paths.pendingKeyPath)

  if (!backupKey) {
    warnings.push({ kind: 'no_secret_key' })
    return
  }

  if (envSecret) {
    const envKey = createHash('sha256').update(envSecret).digest()

    if (!envKey.equals(backupKey))
      warnings.push({ kind: 'secret_mismatch' })

    return
  }

  if (readKeyFile(paths.keyPath)?.equals(backupKey))
    return

  state.keySwapped = true
  state.keyHadPrevious = existsSync(paths.keyPath)
  writeRestoreState(paths.statePath, state)
  moveIfExists(paths.keyPath, `${paths.keyPath}${PRE_RESTORE}`)
  restoreDeps.writeKeyFile(paths.keyPath, backupKey)
}

/** Миграции и проверки восстановленной базы; строка — причина отказа */
async function migrateRestored(paths: BackupPaths) {
  const db = new Database(paths.dbPath)

  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // Пустой или чужой файл: миграции превратили бы его в новую пустую базу
    if (lastAppliedAt(db) === null)
      return 'not_torsher'

    await migrateConnection(db, {
      migrationsFolder: paths.migrationsFolder,
      dbPath: paths.dbPath,
      dataDir: paths.dataDir,
      preUpdateBackup: false,
      skipPreUpdateBackup: false,
    })

    if (db.pragma('integrity_check', { simple: true }) !== 'ok')
      return 'integrity'

    const { n } = db.prepare('SELECT count(*) AS n FROM users').get() as {
      n: number
    }

    if (n === 0)
      return 'no_account'

    db.exec(`DROP TABLE IF EXISTS "${MANIFEST_TABLE}"`)

    return undefined
  }
  finally {
    db.close()
  }
}

/**
 * Подмена базы на проверенную копию — на старте, до любого обращения к базе
 * и ключу секретов. Копия догоняет схему миграциями; любой сбой возвращает
 * прежние файлы. Старт посреди подмены (`applying`) — тот же откат.
 */
export async function applyPendingRestore(
  paths: BackupPaths,
  envSecret?: string,
): Promise<ApplyResult> {
  const current = readRestoreState(paths.statePath)

  if (current?.state === 'applying')
    return fail(paths, current, 'interrupted')

  if (current?.state === 'verified') {
    return {
      applied: true,
      backup: current.backup,
      warnings: current.warnings,
    }
  }

  if (current?.state !== 'pending') {
    // Подготовка оборвалась до `pending`: снимок без состояния не нужен
    rmSync(paths.pendingPath, { force: true })
    rmSync(paths.pendingKeyPath, { force: true })

    return { applied: false }
  }

  // Остатки прошлого восстановления, которое применилось, но не успело
  // убрать за собой: текущие база и ключ уже проверены. Иначе откат этого
  // восстановления вернул бы их вместо текущих
  removePreRestore(paths)

  const state: ApplyingState = {
    state: 'applying',
    backup: current.backup,
    requestedAt: current.requestedAt,
    hadDb: existsSync(paths.dbPath),
  }

  writeRestoreState(paths.statePath, state)

  const warnings: RestoreWarning[] = []

  try {
    if (!existsSync(paths.pendingPath))
      return fail(paths, state, 'missing_file')

    for (const suffix of DB_SUFFIXES) {
      moveIfExists(
        `${paths.dbPath}${suffix}`,
        `${paths.dbPath}${suffix}${PRE_RESTORE}`,
      )
    }

    moveIfExists(paths.dbPath, `${paths.dbPath}${PRE_RESTORE}`)
    renameSync(paths.pendingPath, paths.dbPath)
    swapKey(paths, state, envSecret, warnings)
  }
  catch (err) {
    return fail(paths, state, toBackupError(err).kind, err)
  }

  try {
    const problem = await migrateRestored(paths)

    if (problem)
      return fail(paths, state, problem)
  }
  catch (err) {
    return fail(paths, state, 'migration_failed', err)
  }

  rmSync(paths.pendingKeyPath, { force: true })
  writeRestoreState(paths.statePath, {
    state: 'verified',
    backup: state.backup,
    at: new Date().toISOString(),
    warnings,
  })

  return { applied: true, backup: state.backup, warnings }
}

/**
 * После того как сервер начал слушать порт: прежние файлы больше не нужны.
 * Итог остаётся в `restore.json`, пока владелец не закроет его в панели.
 */
export function finalizeRestore(paths: BackupPaths) {
  const current = readRestoreState(paths.statePath)

  if (current?.state !== 'verified')
    return

  removePreRestore(paths)
  writeRestoreState(paths.statePath, { ...current, state: 'done' })
}
