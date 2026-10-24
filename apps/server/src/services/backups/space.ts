import { createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { diskUsage } from '../storage/disk.ts'
import { BackupError } from './errors.ts'

// Запас сверх оценки: служебные страницы снимка и манифест
export const SPACE_MARGIN = 64 * 1024 * 1024

/** Подмена диска и записи в тестах: нехватка места и `ENOSPC` посреди записи */
export const backupDeps = {
  diskUsage,
  createWriteStream,
}

async function sizeOf(path: string) {
  try {
    return (await stat(path)).size
  }
  catch {
    return 0
  }
}

async function deviceOf(path: string) {
  return (await stat(path)).dev
}

/**
 * Хватит ли места до начала копии. Снимок не больше базы с журналом, сжатая
 * копия не больше снимка; если временный каталог и каталог копий на одном
 * томе, нужно и то и другое сразу.
 */
export async function checkBackupSpace(input: {
  dbPath: string
  tmpDir: string
  dir: string
}) {
  const need
    = (await sizeOf(input.dbPath)) + (await sizeOf(`${input.dbPath}-wal`))
  const [tmp, target] = await Promise.all([
    backupDeps.diskUsage(input.tmpDir),
    backupDeps.diskUsage(input.dir),
  ])
  const shared = (await deviceOf(input.tmpDir)) === (await deviceOf(input.dir))

  if (shared) {
    if (tmp.free < 2 * need + SPACE_MARGIN) {
      throw new BackupError('no_space', {
        need: 2 * need + SPACE_MARGIN,
        free: tmp.free,
      })
    }

    return
  }

  if (tmp.free < need + SPACE_MARGIN) {
    throw new BackupError('no_space', {
      need: need + SPACE_MARGIN,
      free: tmp.free,
    })
  }

  if (target.free < need + SPACE_MARGIN) {
    throw new BackupError('no_space', {
      need: need + SPACE_MARGIN,
      free: target.free,
    })
  }
}
