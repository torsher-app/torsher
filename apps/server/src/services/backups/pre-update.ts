import type Database from 'better-sqlite3'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../../config.ts'
import {
  fileSecretKey,
  keyMaterialFrom,
  readBackupSettingsFrom,
  writableBackupDir,
} from './context.ts'
import { createBackup } from './create.ts'
import { backupDirOf } from './dir.ts'
import { listBackupsIn } from './list.ts'
import { backupPathsFor } from './paths.ts'
import { selectForDeletion } from './rotation.ts'

/**
 * Копия перед миграциями. Пишется в действующий каталог, а если он
 * недоступен — в каталог по умолчанию. После успеха удаляются старые копии
 * перед обновлением (остаются три последних).
 */
export async function preUpdateBackup(input: {
  db: Database.Database
  dbPath: string
  dataDir: string
}) {
  const paths = backupPathsFor(input.dbPath, input.dataDir)
  const settings = readBackupSettingsFrom(input.db)
  const secretKey = fileSecretKey(paths.keyPath)
  const dir = await writableBackupDir(settings, paths.defaultDir, {
    fallback: true,
  })
  const created = await createBackup({
    dbPath: input.dbPath,
    tmpDir: paths.tmpDir,
    dir: dir.path,
    reason: 'pre-update',
    version: config.version,
    commit: config.commit,
    secretKey,
    keyMaterial: keyMaterialFrom(settings, secretKey),
  })
  const { items } = await listBackupsIn(dir.path, dir.path)
  const old = selectForDeletion(
    items.filter(item => item.reason === 'pre-update'),
    { daily: settings.keepDaily, weekly: settings.keepWeekly },
  )

  for (const name of old)
    await rm(join(dir.path, name), { force: true }).catch(() => {})

  return { ...created, dir: dir.path, dirKind: dir.dirKind }
}

/** Последняя копия перед обновлением — для подсказки `torsher restore <имя>` */
export async function latestPreUpdate(
  db: Database.Database,
  dbPath: string,
  dataDir: string,
) {
  const { defaultDir } = backupPathsFor(dbPath, dataDir)
  const dir = backupDirOf(readBackupSettingsFrom(db), defaultDir)
  const { items } = await listBackupsIn(dir.path, defaultDir)

  return items.find(item => item.reason === 'pre-update')?.name
}
