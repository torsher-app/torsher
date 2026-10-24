import type { Buffer } from 'node:buffer'
import type { BackupReason } from './names.ts'
import packageJson from '../../../package.json' with { type: 'json' }

export const MANIFEST_TABLE = '_torsher_backup'
export const MANIFEST_FORMAT = '1'

/** Версия сервера для имени и манифеста копии */
export function appVersion() {
  return packageJson.version
}

/** Строки таблицы манифеста ключ — значение внутри снимка */
export function manifestOf(input: {
  version: string
  commit?: string
  createdAt: Date
  reason: BackupReason
  secretKey: Buffer
}): Record<string, string> {
  return {
    format: MANIFEST_FORMAT,
    version: input.version,
    ...(input.commit ? { commit: input.commit } : {}),
    createdAt: input.createdAt.toISOString(),
    reason: input.reason,
    secretKey: input.secretKey.toString('base64'),
  }
}
