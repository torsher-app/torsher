import type { Buffer } from 'node:buffer'
import type Database from 'better-sqlite3'
import type { BackupDir } from './dir.ts'
import type { BackupSettings } from './settings.ts'
import { config } from '../../config.ts'
import { decryptWith, loadSecretKey } from '../secrets/index.ts'
import { backupDirOf, ensureBackupDir } from './dir.ts'
import {
  BACKUP_SETTINGS_KEY,
  keyMaterialOf,
  parseBackupSettings,
} from './settings.ts'

/**
 * Окружение копии вне обычной работы сервера — перед миграциями и в
 * командах: база открыта своим соединением (или не открывается вовсе),
 * ключ секретов — из окружения или файла каталога данных.
 */
export function readBackupSettingsFrom(db: Database.Database): BackupSettings {
  try {
    const row = db
      .prepare('SELECT value FROM server_settings WHERE key = ?')
      .get(BACKUP_SETTINGS_KEY) as { value: string } | undefined

    return parseBackupSettings(row ? JSON.parse(row.value) : undefined)
  }
  catch {
    return parseBackupSettings(undefined)
  }
}

export function fileSecretKey(keyPath: string) {
  return loadSecretKey({ secret: config.torsherSecret, filePath: keyPath })
}

/**
 * Каталог для копии. С `fallback` недоступный выбранный каталог заменяется
 * каталогом по умолчанию: копия перед миграцией или восстановлением важнее
 * места хранения.
 */
export async function writableBackupDir(
  settings: BackupSettings,
  defaultDir: string,
  options: { fallback: boolean },
): Promise<BackupDir & { dirKind: 'main' | 'fallback' }> {
  const main = backupDirOf(settings, defaultDir)

  try {
    await ensureBackupDir(main)

    return { ...main, dirKind: 'main' }
  }
  catch (err) {
    if (!options.fallback || main.source === 'default')
      throw err
  }

  const fallback = backupDirOf({}, defaultDir)

  await ensureBackupDir(fallback)

  return { ...fallback, dirKind: 'fallback' }
}

export function keyMaterialFrom(settings: BackupSettings, secretKey: Buffer) {
  return keyMaterialOf(settings, ciphertext =>
    decryptWith(secretKey, ciphertext))
}
