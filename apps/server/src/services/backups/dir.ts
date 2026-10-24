import type { BackupSettings } from './settings.ts'
import { mkdir, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { canWrite } from '../setup/storage.ts'
import { BackupError } from './errors.ts'

export interface BackupDir {
  path: string
  source: 'default' | 'panel'
}

/** Действующий каталог копий: выбранный в панели или `<данные>/backups` */
export function backupDirOf(
  settings: Pick<BackupSettings, 'dir'>,
  defaultDir: string,
): BackupDir {
  return settings.dir
    ? { path: settings.dir, source: 'panel' }
    : { path: defaultDir, source: 'default' }
}

/**
 * Каталог готов к записи. Сам создаётся только каталог по умолчанию:
 * выбранный в панели пропал — значит, не смонтирован диск, и писать на
 * место точки монтирования нельзя.
 */
export async function ensureBackupDir(dir: BackupDir) {
  try {
    // В копиях история и ключ секретов: каталог только для владельца
    if (dir.source === 'default')
      await mkdir(dir.path, { recursive: true, mode: 0o700 })

    const info = await stat(dir.path)

    if (!info.isDirectory())
      throw new Error('not a directory')
  }
  catch (err) {
    throw new BackupError(
      'dir_unavailable',
      { path: dir.path },
      { cause: err },
    )
  }

  if (!(await canWrite(dir.path)))
    throw new BackupError('dir_unavailable', { path: dir.path })
}

export async function isBackupDirAvailable(dir: BackupDir) {
  try {
    await ensureBackupDir(dir)

    return true
  }
  catch {
    return false
  }
}

export type BackupDirProblem
  = 'not_absolute' | 'missing' | 'not_directory' | 'denied' | 'overlaps_storage'

/**
 * Проверка каталога, выбранного владельцем. Внутри загрузок, своей
 * библиотеки и подключённых папок копиям не место: их чистят и сканируют
 * свои правила. Каталог данных можно — там лежит каталог по умолчанию.
 */
export async function backupDirProblem(
  path: string,
  storagePaths: string[],
  overlaps: (a: string, b: string) => boolean,
): Promise<BackupDirProblem | null> {
  if (!isAbsolute(path))
    return 'not_absolute'

  const target = resolve(path)

  if (storagePaths.some(item => overlaps(target, resolve(item))))
    return 'overlaps_storage'

  const info = await stat(target).catch(() => undefined)

  if (!info)
    return 'missing'

  if (!info.isDirectory())
    return 'not_directory'

  return (await canWrite(target)) ? null : 'denied'
}
