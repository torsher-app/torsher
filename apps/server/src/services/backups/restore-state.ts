import { readFileSync, rmSync } from 'node:fs'
import { replaceDurable } from './files.ts'

export interface RestoreWarning {
  kind: string
  params?: Record<string, string | number>
}

export type RestoreState
  = | { state: 'pending', backup: string, requestedAt: string }
    | {
      state: 'applying'
      backup: string
      requestedAt: string
      /** Была ли база до подмены: на пустом сервере откатывать нечего */
      hadDb: boolean
      keySwapped?: boolean
      keyHadPrevious?: boolean
    }
    | {
      state: 'verified'
      backup: string
      at: string
      warnings: RestoreWarning[]
    }
    | { state: 'done', backup: string, at: string, warnings: RestoreWarning[] }
    | {
      state: 'failed'
      backup?: string
      at: string
      reason: string
      warnings?: RestoreWarning[]
    }

export function readRestoreState(path: string): RestoreState | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RestoreState
  }
  catch {
    return undefined
  }
}

/** Состояние переживает отключение питания: временный файл, fsync, rename */
export function writeRestoreState(path: string, state: RestoreState) {
  replaceDurable(path, JSON.stringify(state))
}

export function addRestoreWarnings(path: string, warnings: RestoreWarning[]) {
  const current = readRestoreState(path)

  if (
    !current
    || (current.state !== 'done' && current.state !== 'verified')
    || !warnings.length
  ) {
    return
  }

  writeRestoreState(path, {
    ...current,
    warnings: [...current.warnings, ...warnings],
  })
}

/** Итог восстановления виден в панели, пока владелец его не закроет */
export function dismissRestoreState(path: string) {
  const current = readRestoreState(path)

  if (current?.state === 'done' || current?.state === 'failed')
    rmSync(path, { force: true })
}
