import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface DiskUsage {
  total: number
  /** Доступно непривилегированному процессу — столько и получит движок */
  free: number
}

/**
 * Объём и свободное место тома, на котором лежит каталог. Каталога ещё нет
 * (движок не запускался) — том ближайшего существующего родителя.
 */
export async function diskUsage(path: string): Promise<DiskUsage> {
  let current = path

  for (;;) {
    try {
      const stats = await statfs(current)

      return {
        total: stats.blocks * stats.bsize,
        free: stats.bavail * stats.bsize,
      }
    }
    catch (err) {
      const parent = dirname(current)

      if (
        (err as NodeJS.ErrnoException).code !== 'ENOENT'
        || parent === current
      ) {
        throw err
      }

      current = parent
    }
  }
}
