import type { Readable } from 'node:stream'
import type { BackupSecret } from './restore-request.ts'
import type { RestoreWarning } from './restore-state.ts'
import { rm } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { libraryFolders } from '../../db/schema.ts'
import { requestRestart } from '../lifecycle.ts'
import { overlaps } from '../library/folders.ts'
import { logFor } from '../logs/index.ts'
import { needsSetup } from '../users/index.ts'
import { diskUsage } from '../storage/disk.ts'
import { knownDownloadDirs, sameVolume } from '../storage/folders.ts'
import { envStoragePath, storagePath } from '../storage/paths.ts'
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
import { nextScheduledAt, schedulerStartedAt } from './scheduler.ts'
import { getBackupSettings, keyMaterialOf } from './settings.ts'
import { getBackupState, runtime, updateBackupState } from './state.ts'
import { saveUploadedBackup } from './upload.ts'

export type { BackupDirProblem } from './dir.ts'
export { BackupError } from './errors.ts'
export type { BackupErrorKind } from './errors.ts'
export { BACKUP_REASONS, parseBackupName } from './names.ts'
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
export { firstRunUploadPath, uploadLimits } from './upload.ts'

export async function listBackups() {
  const { defaultDir } = backupPaths()

  return listBackupsIn(
    backupDirOf(getBackupSettings(), defaultDir).path,
    defaultDir,
  )
}

/**
 * Куда копиям нельзя: каталоги загрузок (действующий, окружения и прежние
 * каталоги раздач), библиотеки и подключённые папки
 */
function storageDirs() {
  const folders = getDb()
    .select({ path: libraryFolders.path })
    .from(libraryFolders)
    .all()

  return [
    ...knownDownloadDirs(),
    envStoragePath('downloads'),
    storagePath('library'),
    envStoragePath('library'),
    ...folders.map(row => row.path),
  ]
}

/** Каталог из панели: доступен на запись и не пересекается с хранилищем */
export async function checkBackupDir(path: string) {
  return backupDirProblem(path, storageDirs(), overlaps)
}

/** Проверка в диалоге выбора каталога: причина отказа, место и том базы */
export async function inspectBackupDir(path: string) {
  const problem = await checkBackupDir(path)
  const target = isAbsolute(path) ? resolve(path) : path
  const readable
    = problem === null || problem === 'denied' || problem === 'overlaps_storage'
  const [disk, sameAsDatabase] = readable
    ? await Promise.all([
        diskUsage(target).catch(() => undefined),
        sameVolume(target, config.dataDir),
      ])
    : [undefined, false]

  return {
    path: target,
    problem,
    free: disk?.free ?? 0,
    total: disk?.total ?? 0,
    sameVolumeAsDatabase: sameAsDatabase,
  }
}

function errorOf(error: { kind: string, params?: Record<string, unknown> }) {
  return {
    kind: error.kind,
    params: Object.fromEntries(
      Object.entries(error.params ?? {}).filter(
        (entry): entry is [string, string | number] =>
          typeof entry[1] === 'string' || typeof entry[1] === 'number',
      ),
    ),
  }
}

// «Обзор» опрашивается раз в 5 с, а каталог бывает на NAS: файлы — не чаще
// раза в 30 с. Новая копия видна сразу через состояние
const FILES_CACHE_MS = 30_000
let filesCache: { at: number, newest?: string } | undefined

export async function getBackupStatus(now = new Date()) {
  const settings = getBackupSettings()
  const { defaultDir } = backupPaths()
  const dir = backupDirOf(settings, defaultDir)
  const state = getBackupState()
  const { items, available } = await listBackupsIn(dir.path, defaultDir)
  const [disk, sameAsDatabase] = available
    ? await Promise.all([
        diskUsage(dir.path).catch(() => undefined),
        sameVolume(dir.path, config.dataDir),
      ])
    : [undefined, false]
  // База после восстановления бывает старше файлов в каталоге. Загруженная
  // копия — не копия этого сервера: её дата ничего не говорит о защите
  const lastSuccessAt = latestOf(state.lastSuccessAt, newestOwnBackup(items))

  return {
    settings: {
      enabled: settings.enabled,
      time: settings.time,
      keepDaily: settings.keepDaily,
      keepWeekly: settings.keepWeekly,
      mode: settings.encryption.mode,
      passwordSetAt:
        settings.encryption.mode === 'password'
          ? settings.encryption.setAt
          : undefined,
    },
    dir: {
      ...dir,
      available,
      free: disk?.free,
      total: disk?.total,
      sameVolumeAsDatabase: sameAsDatabase,
    },
    state: {
      running: runtime.running
        ? {
            reason: runtime.running.reason,
            startedAt: runtime.running.startedAt.toISOString(),
          }
        : undefined,
      lastSuccessAt,
      lastAttempt: state.lastAttempt && {
        at: state.lastAttempt.at,
        error: state.lastAttempt.error && errorOf(state.lastAttempt.error),
      },
      manual: runtime.manual && {
        at: runtime.manual.at,
        error: runtime.manual.error && errorOf(runtime.manual.error),
      },
      nextAt: nextScheduledAt(items, now)?.toISOString(),
      // В образе по умолчанию UTC: панель подписывает время поясом сервера
      timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    restore: restoreStatus(),
    items: items.map(({ path: _path, createdAt, ...item }) => ({
      ...item,
      createdAt: createdAt.toISOString(),
    })),
  }
}

/** Ручная копия в фоне: ответ панели не ждёт снимка, итог — в состоянии */
export function startManualBackup() {
  if (runtime.running)
    return

  void createBackupNow('manual').then(
    () => {
      runtime.manual = { at: new Date().toISOString() }
    },
    (err: unknown) => {
      const error = toBackupError(err)

      runtime.manual = {
        at: new Date().toISOString(),
        error: { kind: error.kind, params: error.params },
      }
    },
  )
}

export async function deleteBackup(name: string) {
  await rm(await backupPath(name), { force: true })
  filesCache = undefined
  logFor('backups').info({ name }, 'Backup deleted')
}

export function uploadBackup(
  body: Readable,
  options: {
    originalName?: string
    declaredBytes?: number
    firstRun?: boolean
  },
) {
  const { tmpDir, defaultDir } = backupPaths()

  return saveUploadedBackup({ body, tmpDir, defaultDir, ...options })
}

/** Самая новая своя копия в каталоге: загруженная о защите этого сервера не говорит */
function newestOwnBackup(items: { reason: string, createdAt: Date }[]) {
  return items
    .find(item => item.reason !== 'uploaded')
    ?.createdAt
    .toISOString()
}

function latestOf(...values: (string | undefined)[]) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
}

/**
 * Последняя удачная копия — тот же расчёт, что у страницы копий: максимум
 * из состояния и самой новой своей копии в каталоге. После восстановления
 * состояние в базе старше файлов
 */
export async function lastBackupAt(now = Date.now()) {
  const state = getBackupState()

  // База в памяти (тесты): каталога копий нет, читать нечего
  if (config.databasePath === ':memory:')
    return state.lastSuccessAt

  if (!filesCache || now - filesCache.at > FILES_CACHE_MS) {
    const { items } = await listBackups().catch(() => ({ items: [] }))

    filesCache = { at: now, newest: newestOwnBackup(items) }
  }

  return latestOf(state.lastSuccessAt, filesCache.newest)
}

// Удачной копии нет двое суток: так видно сбой, которого не показывает одна
// попытка (сервер выключали, каталог то есть, то нет)
const STALE_AFTER_MS = 48 * 60 * 60 * 1000

/**
 * Проблемы копий для «Требует внимания»: по минутному тику расписания
 * (доступность каталога, последняя попытка) и по давности последней копии.
 * Выключенные копии не тревожат.
 */
export function backupProblems(now = new Date()) {
  const settings = getBackupSettings()
  const state = getBackupState()

  if (!settings.enabled)
    return { dirUnavailable: false, failed: undefined }

  const dirUnavailable = state.dirAvailable === false
  const attempt = state.lastAttempt
  const lastSuccess = state.lastSuccessAt
    ? new Date(state.lastSuccessAt).getTime()
    : 0

  // `busy` — снимок уже шёл (ручной); это не сбой, слот повторится сам
  if (
    attempt?.error
    && attempt.error.kind !== 'busy'
    && new Date(attempt.at).getTime() > lastSuccess
  ) {
    return {
      dirUnavailable,
      failed: errorOf(attempt.error),
    }
  }

  // Свежая установка или только что включённые копии: отсчёт — от начала
  // наблюдения, а не от старта процесса (перезапуски не сбрасывают тревогу)
  const watchSince = state.watchSince
    ? new Date(state.watchSince).getTime()
    : schedulerStartedAt().getTime()
  const since = Math.max(lastSuccess, watchSince)

  if (now.getTime() - since > STALE_AFTER_MS)
    return { dirUnavailable, failed: { kind: 'stale', params: {} } }

  return { dirUnavailable, failed: undefined }
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
 * `firstRun` — восстановление без входа на пустом сервере: копии текущей
 * базы нет (сохранять нечего), а аккаунт, созданный за время проверки,
 * отменяет восстановление — иначе подмена базы стёрла бы его без копии.
 */
export async function requestRestore(
  source: { name: string } | { path: string, backupName: string },
  secret: BackupSecret = {},
  options: { firstRun?: boolean } = {},
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
    preRestore: () =>
      options.firstRun ? Promise.resolve() : createBackupNow('pre-restore'),
    beforePending: options.firstRun
      ? () => {
          if (!needsSetup())
            throw new BackupError('account_created')
        }
      : undefined,
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
 * Восстановление проверяется или ждёт перезапуска (в том числе после
 * команды в контейнере): аккаунт в это время не создаётся
 */
export function restoreInProgress() {
  if (
    runtime.restore?.state === 'checking'
    || runtime.restore?.state === 'pending'
  ) {
    return true
  }

  return readRestoreState(backupPaths().statePath)?.state === 'pending'
}

/**
 * Подготовка восстановления в этом процессе или состояние из `restore.json`:
 * ожидание перезапуска (в том числе после команды в контейнере) и итог
 * прошлого запуска.
 */
export function restoreStatus() {
  if (runtime.restore) {
    const restore = runtime.restore

    if (restore.state === 'failed') {
      return {
        state: restore.state,
        backup: restore.backup,
        reason: restore.error.kind,
        params: errorOf(restore.error).params,
        warnings: [],
      }
    }

    return {
      state: restore.state,
      backup: restore.backup,
      at:
        restore.state === 'checking'
          ? restore.startedAt.toISOString()
          : undefined,
      warnings: [],
    }
  }

  const saved = readRestoreState(backupPaths().statePath)

  if (saved?.state === 'pending') {
    return {
      state: saved.state,
      backup: saved.backup,
      at: saved.requestedAt,
      warnings: [],
    }
  }

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

/**
 * После старта на восстановленной базе. Давность копии считаем заново:
 * в восстановленном состоянии прежние даты, и тревога «копии нет двое
 * суток» была бы ложной, пока расписание не снимет новую
 */
export function finalizeRestoreNow() {
  const paths = backupPaths()
  const restored = readRestoreState(paths.statePath)?.state === 'verified'

  finalizeRestore(paths)

  if (restored)
    updateBackupState({ watchSince: new Date().toISOString() })
}

export function addRestoreWarningsNow(warnings: RestoreWarning[]) {
  addRestoreWarnings(backupPaths().statePath, warnings)
}

/** Чистка до открытия базы: временный каталог и каталог по умолчанию */
export function cleanupBackupTempNow() {
  const { tmpDir, defaultDir } = backupPaths()

  return cleanupBackupTemp({ tmpDir, dirs: [defaultDir] })
}
