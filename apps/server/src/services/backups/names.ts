export const BACKUP_REASONS = [
  'scheduled',
  'manual',
  'pre-update',
  'pre-restore',
  'pre-import',
  'uploaded',
] as const

export type BackupReason = (typeof BACKUP_REASONS)[number]

export interface BackupName {
  name: string
  createdAt: Date
  reason: BackupReason
  version: string
  encrypted: boolean
}

// Имя целиком по шаблону: всё остальное в каталоге — не копия, а `/` и `..`
// в имя не пройдут, поэтому имя из запроса не выведет за пределы каталога
const NAME_RE = new RegExp(
  `^torsher-backup-(\\d{8}T\\d{6}Z)-(${BACKUP_REASONS.join('|')})-v([0-9A-Za-z][0-9A-Za-z.+-]*?)\\.db\\.gz(\\.enc)?$`,
)

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0')
}

/** Время в имени — UTC: перевод часов не даёт двух одинаковых имён */
function stamp(date: Date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

export function formatBackupName(input: {
  createdAt: Date
  reason: BackupReason
  version: string
  encrypted: boolean
}) {
  const version = input.version.replace(/[^0-9A-Z.+-]/gi, '-') || '0'

  return `torsher-backup-${stamp(input.createdAt)}-${input.reason}-v${version}.db.gz${input.encrypted ? '.enc' : ''}`
}

export function parseBackupName(name: string): BackupName | undefined {
  const match = NAME_RE.exec(name)

  if (!match)
    return undefined

  const [, time, reason, version, enc] = match
  const t = time!
  const createdAt = new Date(
    Date.UTC(
      Number(t.slice(0, 4)),
      Number(t.slice(4, 6)) - 1,
      Number(t.slice(6, 8)),
      Number(t.slice(9, 11)),
      Number(t.slice(11, 13)),
      Number(t.slice(13, 15)),
    ),
  )

  if (Number.isNaN(createdAt.getTime()))
    return undefined

  return {
    name,
    createdAt,
    reason: reason as BackupReason,
    version: version!,
    encrypted: Boolean(enc),
  }
}
