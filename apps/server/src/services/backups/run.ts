import type { CreatedBackup } from './create.ts'
import type { BackupReason } from './names.ts'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../../config.ts'
import { logFor } from '../logs/index.ts'
import { currentSecretKey } from '../secrets/index.ts'
import { writableBackupDir } from './context.ts'
import { createBackup } from './create.ts'
import { backupDirOf } from './dir.ts'
import { BackupError, toBackupError } from './errors.ts'
import { listBackupsIn } from './list.ts'
import { backupPathsFor } from './paths.ts'
import { selectForDeletion } from './rotation.ts'
import { getBackupSettings, keyMaterialOf } from './settings.ts'
import { runtime, updateBackupState } from './state.ts'

/** Пути копий сервера */
export function backupPaths() {
  return backupPathsFor(config.databasePath, config.dataDir)
}

export function currentDir() {
  return backupDirOf(getBackupSettings(), backupPaths().defaultDir)
}

/** Старые копии — только после успешной новой */
async function rotate(dir: string) {
  const settings = getBackupSettings()
  const { items } = await listBackupsIn(dir, dir)
  const old = selectForDeletion(items, {
    daily: settings.keepDaily,
    weekly: settings.keepWeekly,
  })

  for (const name of old)
    await rm(join(dir, name), { force: true }).catch(() => {})

  if (old.length)
    logFor('backups').info({ count: old.length }, 'Old backups removed')
}

/**
 * Копия из процесса сервера. Копии перед восстановлением и импортом при
 * недоступном каталоге пишутся в каталог по умолчанию, плановая и ручная —
 * нет: им нужен выбранный владельцем каталог.
 */
export async function createBackupNow(
  reason: BackupReason,
): Promise<CreatedBackup> {
  // База в памяти (тесты): снимать нечего, и каталог копий не создаётся
  if (config.databasePath === ':memory:')
    throw new BackupError('io', { code: 'MEMORY_DATABASE' })

  if (runtime.running)
    throw new BackupError('busy')

  const controller = new AbortController()

  runtime.running = { reason, startedAt: new Date(), controller }

  try {
    const paths = backupPaths()
    const settings = getBackupSettings()
    const dir = await writableBackupDir(settings, paths.defaultDir, {
      fallback: reason !== 'scheduled' && reason !== 'manual',
    })
    const created = await createBackup({
      dbPath: paths.dbPath,
      tmpDir: paths.tmpDir,
      dir: dir.path,
      reason,
      version: config.version,
      commit: config.commit,
      secretKey: currentSecretKey(),
      keyMaterial: keyMaterialOf(settings),
      signal: controller.signal,
    })

    updateBackupState({ lastSuccessAt: created.createdAt.toISOString() })
    logFor('backups').info(
      { name: created.name, size: created.size, reason },
      'Backup created',
    )
    await rotate(dir.path)

    return created
  }
  catch (err) {
    const error = toBackupError(err)

    // Другой снимок держит замок (команда в контейнере): расписание
    // повторит на следующем тике, журнал этим не засоряем
    if (error.kind === 'busy') {
      logFor('backups').debug(
        { reason },
        'Backup skipped: another one is running',
      )
    }
    else {
      logFor('backups').error(
        { err, kind: error.kind, params: error.params, reason },
        'Backup failed',
      )
    }
    throw error
  }
  finally {
    runtime.running = undefined
  }
}
