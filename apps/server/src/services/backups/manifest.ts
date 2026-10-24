import type { Buffer } from 'node:buffer'
import type { BackupReason } from './names.ts'

export const MANIFEST_TABLE = '_torsher_backup'
export const MANIFEST_FORMAT = '1'

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
