import { randomBytes } from 'node:crypto'
import { stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MediaLinkMode } from '../../db/schema.ts'
import { checkLinkMode } from '../library/link.ts'
import { diskUsage } from '../storage/disk.ts'
import { getPolicy } from '../storage/policy.ts'

export interface DirCheck {
  path: string
  exists: boolean
  writable: boolean
}

export interface StorageCheck {
  data: DirCheck
  downloads: DirCheck
  library: DirCheck
  linkMode: MediaLinkMode | null
  space: { total: number, free: number, status: 'ok' | 'low' | 'critical' }
}

/** Ближайший существующий каталог: сам путь или родитель, где его создадут */
async function existingDir(path: string) {
  let current = path

  for (;;) {
    try {
      await stat(current)

      return current
    }
    catch (err) {
      const parent = dirname(current)

      if (
        (err as NodeJS.ErrnoException).code !== 'ENOENT'
        || parent === current
      ) {
        return null
      }

      current = parent
    }
  }
}

// Права и ACL по `access` врут на сетевых и read-only томах, поэтому пишем
// настоящий файл и сразу удаляем
async function canWrite(dir: string) {
  const probe = join(dir, `.torsher-write-${randomBytes(6).toString('hex')}`)

  try {
    await writeFile(probe, '')
    await unlink(probe)

    return true
  }
  catch {
    return false
  }
}

async function checkDir(path: string) {
  const existing = await existingDir(path)

  return {
    path,
    exists: existing === path,
    writable: existing ? await canWrite(existing) : false,
  }
}

/**
 * Проверка хранилища для мастера: каталоги данных, загрузок и библиотеки
 * пишутся, места хватает на кэш и запас, хардлинк из загрузок в библиотеку
 * проходит (иначе «Оставить» копирует файлы).
 */
export async function checkStorage(paths: {
  dataDir: string
  downloadsDir: string
  libraryDir: string
}): Promise<StorageCheck> {
  const [data, downloads, library] = await Promise.all([
    checkDir(paths.dataDir),
    checkDir(paths.downloadsDir),
    checkDir(paths.libraryDir),
  ])
  const linkMode
    = downloads.writable && library.writable
      ? await checkLinkMode(paths.downloadsDir, paths.libraryDir)
      : null
  const disk = await diskUsage(paths.downloadsDir)
  const policy = getPolicy(disk.total)
  const status
    = disk.free < policy.minFree
      ? 'critical'
      : disk.free < policy.minFree + policy.cacheLimit
        ? 'low'
        : 'ok'

  return {
    data,
    downloads,
    library,
    linkMode,
    space: { total: disk.total, free: disk.free, status },
  }
}
