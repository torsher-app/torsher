import type { BackupState } from './schedule.ts'
import type { BackupErrorKind, BackupErrorParams } from './errors.ts'
import type { BackupReason } from './names.ts'
import { getSetting, setSetting } from '../settings/index.ts'

export const BACKUP_STATE_KEY = 'backupState'

export function getBackupState(): BackupState {
  return getSetting<BackupState>(BACKUP_STATE_KEY) ?? {}
}

export function updateBackupState(patch: Partial<BackupState>) {
  const next = { ...getBackupState(), ...patch }

  setSetting(BACKUP_STATE_KEY, next)

  return next
}

export interface RunningBackup {
  reason: BackupReason
  startedAt: Date
  controller: AbortController
}

export type RestoreRequest
  = | { state: 'checking', backup: string, startedAt: Date }
    | { state: 'pending', backup: string }
    | {
      state: 'failed'
      backup: string
      error: { kind: BackupErrorKind, params: BackupErrorParams }
    }

/** Итог последней ручной копии: панель узнаёт о сбое, когда снимок закончился */
export interface ManualBackupResult {
  at: string
  error?: { kind: BackupErrorKind, params: BackupErrorParams }
}

// Состояние процесса: снимок, который идёт сейчас, итог ручной копии и
// подготовка восстановления
export const runtime: {
  running?: RunningBackup
  manual?: ManualBackupResult
  restore?: RestoreRequest
} = {}
