import type { StatsFs } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface DiskUsage {
  total: number
  /** Доступно непривилегированному процессу — столько и получит движок */
  free: number
}

/** Счётчики statfs выражены в frsize, а bsize — оптимальный размер передачи. */
export function diskUsageFromStats(
  stats: Pick<StatsFs, 'bsize' | 'blocks' | 'bavail'> & { frsize?: number },
): DiskUsage {
  const blockSize
    = stats.frsize && stats.frsize > 0 ? stats.frsize : stats.bsize
  return {
    total: stats.blocks * blockSize,
    free: stats.bavail * blockSize,
  }
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

      return diskUsageFromStats(stats)
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
