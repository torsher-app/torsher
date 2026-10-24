import { join } from 'node:path'
import { MIGRATIONS_DIR } from '../../db/index.ts'

/**
 * Все пути копий и восстановления от каталога данных. Временный снимок и
 * подмена базы — только в каталоге данных: там работает `rename`.
 */
export interface BackupPaths {
  dbPath: string
  dataDir: string
  /** Каталог копий, если владелец не выбрал другой */
  defaultDir: string
  tmpDir: string
  keyPath: string
  /** Проверенная копия, которая заменит базу при следующем старте */
  pendingPath: string
  /** Ключ секретов из копии: отдельным файлом с правами 0600, не в JSON */
  pendingKeyPath: string
  statePath: string
  /** Одно восстановление за раз, в том числе между сервером и командой */
  restoreLockPath: string
  migrationsFolder: string
}

export function backupPathsFor(dbPath: string, dataDir: string): BackupPaths {
  return {
    dbPath,
    dataDir,
    defaultDir: join(dataDir, 'backups'),
    tmpDir: join(dataDir, 'backups-tmp'),
    keyPath: join(dataDir, 'secret.key'),
    pendingPath: join(dataDir, 'restore-pending.db'),
    pendingKeyPath: join(dataDir, 'restore-pending.key'),
    statePath: join(dataDir, 'restore.json'),
    restoreLockPath: join(dataDir, 'restore.lock'),
    migrationsFolder: MIGRATIONS_DIR,
  }
}
