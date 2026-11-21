import type { PlaybackTitle } from './sources.ts'

const STORAGE_KEY = 'torsher-viewing-restart'

export interface ViewingRestart {
  requestId: string
  scope: string
  historyEntry?: string
  sourceKey?: string
  expectedGeneration?: number
  consumed?: boolean
}

export function playbackIdentity() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export function restartScope(
  profileId: string,
  title: PlaybackTitle,
  cycleId?: string,
) {
  return JSON.stringify([
    profileId,
    title.id,
    title.season ?? 0,
    title.episode ?? 0,
    cycleId ?? null,
  ])
}

let memory: ViewingRestart | undefined

function readRestart() {
  if (memory)
    return memory
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw)
      return undefined
    const value = JSON.parse(raw) as ViewingRestart
    // A new runtime can only replay an intent whose original CAS was pinned.
    // An older draft may remain in storage if persisting that CAS failed.
    if (
      typeof value?.requestId === 'string'
      && typeof value.scope === 'string'
      && typeof value.sourceKey === 'string'
      && typeof value.expectedGeneration === 'number'
      && Number.isSafeInteger(value.expectedGeneration)
      && value.expectedGeneration >= 0
    ) {
      return value
    }
  }
  catch {
    return undefined
  }
}

export function saveRestart(value: ViewingRestart) {
  memory = value
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  }
  catch {
    // The live player can retry with the pinned CAS in memory. Remove any
    // older draft if possible. A failed removal still cannot make it replayable.
    if (value.expectedGeneration !== undefined && !value.consumed) {
      try {
        sessionStorage.removeItem(STORAGE_KEY)
      }
      catch {}
    }
  }
  return value
}

export function stageViewingRestart(scope: string, historyEntry?: string) {
  return saveRestart({ requestId: playbackIdentity(), scope, historyEntry })
}

export function viewingRestartFor(
  scope: string,
  requestId?: string,
  historyEntry?: string,
) {
  const value = readRestart()
  if (value?.scope !== scope)
    return undefined

  // The OSD can stage a newer restart while the address still carries the
  // previous route intent. Replay it only in the history entry that staged it.
  if (value.historyEntry !== undefined)
    return value.historyEntry === historyEntry ? value : undefined
  return value.requestId === requestId ? value : undefined
}
