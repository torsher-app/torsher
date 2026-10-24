export const BACKUP_ERROR_KINDS = [
  'no_space',
  'io',
  'integrity',
  'dir_unavailable',
  'busy',
  'not_found',
  'not_torsher',
  'corrupt',
  'wrong_password',
  'newer_version',
  'key_unavailable',
  'too_large',
  'account_created',
] as const

export type BackupErrorKind = (typeof BACKUP_ERROR_KINDS)[number]

export type BackupErrorParams = Record<string, string | number>

/** Сбой копии или восстановления: вид причины и цифры для текста в панели */
export class BackupError extends Error {
  readonly kind: BackupErrorKind
  readonly params: BackupErrorParams

  constructor(
    kind: BackupErrorKind,
    params: BackupErrorParams = {},
    options?: ErrorOptions,
  ) {
    super(`Backup failed: ${kind}`, options)
    this.name = 'BackupError'
    this.kind = kind
    this.params = params
  }
}

function codeOf(err: unknown) {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String(err.code)
    : undefined
}

/** Нет места на любом этапе (запись файла или SQLite) — `no_space`, прочее — `io` */
export function toBackupError(err: unknown): BackupError {
  if (err instanceof BackupError)
    return err

  const code = codeOf(err)

  if (code === 'ENOSPC' || code === 'SQLITE_FULL')
    return new BackupError('no_space', {}, { cause: err })

  return new BackupError('io', code ? { code } : {}, { cause: err })
}
