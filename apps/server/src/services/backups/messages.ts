import type { BackupError } from './errors.ts'

export function formatSize(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

/**
 * Причина сбоя копии для человека — в командной строке и журнале контейнера,
 * где панели нет. `ENOSPC` посреди записи приходит без цифр.
 */
export function backupErrorText(err: BackupError, encrypted = false) {
  const { params } = err

  switch (err.kind) {
    case 'no_space':
      return params.need === undefined || params.free === undefined
        ? 'Not enough disk space.'
        : `Not enough disk space: ${formatSize(Number(params.need))} needed, ${formatSize(Number(params.free))} free.`
    case 'integrity':
      return 'The database failed the integrity check, so the backup was not saved.'
    case 'dir_unavailable':
      return `The backups folder ${params.path} is unavailable.`
    case 'busy':
      return 'Another backup or restore is in progress. Try again later.'
    case 'not_found':
      return 'Backup not found. Run "torsher backups" to see the list.'
    case 'not_torsher':
      return 'This file is not a Torsher backup.'
    case 'corrupt':
      return 'The backup file is damaged.'
    case 'wrong_password':
      return encrypted
        ? 'Wrong password for this backup.'
        : 'This backup is encrypted. Pass its password with --password-stdin.'
    case 'key_unavailable':
      return 'The backup password cannot be read with the current secret key. Set the backup password again in Settings > Backups.'
    case 'newer_version':
      return `This backup was made by a newer version of Torsher${params.version ? ` (v${params.version})` : ''}. Update the server, then restore.`
    default:
      return `The operation failed${params.code ? ` (${params.code})` : ''}.`
  }
}
