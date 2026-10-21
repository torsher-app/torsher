import { randomBytes } from 'node:crypto'
import { stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
  space: { total: number, free: number, status: 'ok' | 'low' | 'critical' }
  sameFilesystem: boolean | null
}

/** Ближайший существующий каталог: сам путь или родитель, где его создадут */
async function existingDir(path: string) {
  let current = path

  for (;;) {
    try {
      const stats = await stat(current)

      return { path: current, dev: stats.dev }
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
    check: {
      path,
      exists: existing?.path === path,
      writable: existing ? await canWrite(existing.path) : false,
    },
    dev: existing?.dev,
  }
}

/**
 * Проверка хранилища для мастера: каталоги данных и загрузок пишутся, места
 * хватает на кэш и запас. Одна файловая система — только информация: она
 * понадобится библиотеке для хардлинков вместо копий.
 */
export async function checkStorage(paths: {
  dataDir: string
  downloadsDir: string
}): Promise<StorageCheck> {
  const [data, downloads] = await Promise.all([
    checkDir(paths.dataDir),
    checkDir(paths.downloadsDir),
  ])
  const disk = await diskUsage(paths.downloadsDir)
  const policy = getPolicy(disk.total)
  const status
    = disk.free < policy.minFree
      ? 'critical'
      : disk.free < policy.minFree + policy.cacheLimit
        ? 'low'
        : 'ok'

  return {
    data: data.check,
    downloads: downloads.check,
    space: { total: disk.total, free: disk.free, status },
    sameFilesystem:
      data.dev === undefined || downloads.dev === undefined
        ? null
        : data.dev === downloads.dev,
  }
}
