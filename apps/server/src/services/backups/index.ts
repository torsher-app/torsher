import type { BackupSecret } from './restore-request.ts'
import type { RestoreWarning } from './restore-state.ts'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { libraryFolders } from '../../db/schema.ts'
import { requestRestart } from '../lifecycle.ts'
import { overlaps } from '../library/folders.ts'
import { logFor } from '../logs/index.ts'
import { diskUsage } from '../storage/disk.ts'
import { cleanupBackupTemp } from './cleanup.ts'
import { backupDirOf, backupDirProblem } from './dir.ts'
import { BackupError, toBackupError } from './errors.ts'
import { listBackupsIn } from './list.ts'
import { parseBackupName } from './names.ts'
import { applyPendingRestore, finalizeRestore } from './restore-apply.ts'
import { openBackupFile, prepareRestore } from './restore-request.ts'
import {
  addRestoreWarnings,
  dismissRestoreState,
  readRestoreState,
} from './restore-state.ts'
import { backupPaths, createBackupNow } from './run.ts'
import { nextScheduledAt } from './scheduler.ts'
import { getBackupSettings, keyMaterialOf } from './settings.ts'
import { getBackupState, runtime } from './state.ts'

export { BackupError } from './errors.ts'
export type { BackupErrorKind } from './errors.ts'
export { backupPaths, createBackupNow } from './run.ts'
export {
  backupTick,
  startBackupScheduler,
  stopBackupScheduler,
} from './scheduler.ts'
export {
  clearBackupPassword,
  getBackupSettings,
  saveBackupSettings,
  setBackupPassword,
} from './settings.ts'

export async function listBackups() {
  const { defaultDir } = backupPaths()

  return listBackupsIn(
    backupDirOf(getBackupSettings(), defaultDir).path,
    defaultDir,
  )
}

/** Каталог из панели: доступен на запись и не пересекается с хранилищем */
export async function checkBackupDir(path: string) {
  const folders = getDb()
    .select({ path: libraryFolders.path })
    .from(libraryFolders)
    .all()

  return backupDirProblem(
    path,
    [
      config.downloadsPath,
      config.libraryPath,
      ...folders.map(row => row.path),
    ],
    overlaps,
  )
}

export async function getBackupStatus(now = new Date()) {
  const settings = getBackupSettings()
  const { defaultDir } = backupPaths()
  const dir = backupDirOf(settings, defaultDir)
  const state = getBackupState()
  const { items, available } = await listBackupsIn(dir.path, defaultDir)
  const disk = available
    ? await diskUsage(dir.path).catch(() => undefined)
    : undefined
  // База после восстановления бывает старше файлов в каталоге
  const newestFile = items[0]?.createdAt.toISOString()
  const lastSuccessAt = [state.lastSuccessAt, newestFile]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)

  return {
    settings: {
      enabled: settings.enabled,
      time: settings.time,
      keepDaily: settings.keepDaily,
      keepWeekly: settings.keepWeekly,
      dir: settings.dir,
      encryption: {
        mode: settings.encryption.mode,
        setAt: settings.encryption.setAt,
      },
    },
    dir: { ...dir, available, free: disk?.free, total: disk?.total },
    state: {
      running: runtime.running
        ? {
            reason: runtime.running.reason,
            startedAt: runtime.running.startedAt.toISOString(),
          }
        : undefined,
      lastSuccessAt,
      lastAttempt: state.lastAttempt,
      nextAt: nextScheduledAt(items, now)?.toISOString(),
    },
    restore: restoreStatus(),
    items: items.map(({ path: _path, ...item }) => item),
  }
}

/** Путь копии по имени: каталог копий, затем каталог по умолчанию */
export async function backupPath(name: string) {
  if (!parseBackupName(name))
    throw new BackupError('not_found')

  const { items } = await listBackups()
  const item = items.find(candidate => candidate.name === name)

  if (!item)
    throw new BackupError('not_found')

  return item.path
}

/**
 * Восстановление из панели. Занятость ставится сразу, до первого `await`:
 * второй запрос получает `busy`. Дешёвые отказы (нет файла, не копия,
 * неверный пароль) — сразу; проверка, копия текущей базы и перезапуск — в
 * фоне. Между процессами (команда в контейнере) — замок `restore.lock`.
 */
export async function requestRestore(
  source: { name: string } | { path: string, backupName: string },
  secret: BackupSecret = {},
) {
  if (
    runtime.restore?.state === 'checking'
    || runtime.restore?.state === 'pending'
  ) {
    throw new BackupError('busy')
  }

  const backupName = 'name' in source ? source.name : source.backupName

  runtime.restore = {
    state: 'checking',
    backup: backupName,
    startedAt: new Date(),
  }

  let path: string
  let opened

  try {
    path = 'name' in source ? await backupPath(source.name) : source.path
    opened = await openBackupFile(path, {
      password: secret.password,
      keyMaterial: secret.keyMaterial ?? keyMaterialOf(getBackupSettings()),
    })
  }
  catch (err) {
    runtime.restore = undefined
    throw toBackupError(err)
  }

  void prepareRestore({
    path,
    backupName,
    opened,
    paths: backupPaths(),
    preRestore: () => createBackupNow('pre-restore'),
  }).then(
    () => {
      runtime.restore = { state: 'pending', backup: backupName }
      logFor('backups').info(
        { backup: backupName },
        'Restore is ready, restarting',
      )
      requestRestart('restore')
    },
    (err: unknown) => {
      const error = toBackupError(err)

      runtime.restore = {
        state: 'failed',
        backup: backupName,
        error: { kind: error.kind, params: error.params },
      }
      logFor('backups').error(
        { err, kind: error.kind, backup: backupName },
        'Restore check failed',
      )
    },
  )
}

/**
 * Подготовка восстановления в этом процессе или состояние из `restore.json`:
 * ожидание перезапуска (в том числе после команды в контейнере) и итог
 * прошлого запуска.
 */
export function restoreStatus() {
  if (runtime.restore) {
    const { state, backup } = runtime.restore

    return runtime.restore.state === 'failed'
      ? { state, backup, error: runtime.restore.error }
      : { state, backup }
  }

  const saved = readRestoreState(backupPaths().statePath)

  if (saved?.state === 'pending')
    return { state: saved.state, backup: saved.backup, at: saved.requestedAt }

  if (saved?.state === 'done') {
    return {
      state: saved.state,
      backup: saved.backup,
      at: saved.at,
      warnings: saved.warnings,
    }
  }

  if (saved?.state === 'failed') {
    return {
      state: saved.state,
      backup: saved.backup,
      at: saved.at,
      reason: saved.reason,
      warnings: saved.warnings ?? [],
    }
  }

  return undefined
}

export function dismissRestoreResult() {
  if (runtime.restore?.state === 'failed')
    runtime.restore = undefined

  dismissRestoreState(backupPaths().statePath)
}

export function applyPendingRestoreNow() {
  if (config.databasePath === ':memory:')
    return Promise.resolve({ applied: false } as const)

  return applyPendingRestore(backupPaths(), config.torsherSecret)
}

export function finalizeRestoreNow() {
  finalizeRestore(backupPaths())
}

export function addRestoreWarningsNow(warnings: RestoreWarning[]) {
  addRestoreWarnings(backupPaths().statePath, warnings)
}

/** Чистка до открытия базы: временный каталог и каталог по умолчанию */
export function cleanupBackupTempNow() {
  const { tmpDir, defaultDir } = backupPaths()

  return cleanupBackupTemp({ tmpDir, dirs: [defaultDir] })
}
