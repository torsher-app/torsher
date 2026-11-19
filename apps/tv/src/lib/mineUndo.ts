import type { MineTitlePersonal } from '@torsher/api-client'
import { getErrorStatus } from '@torsher/api-client'
import { shallowRef, watch } from 'vue'
import { api } from '../api.ts'
import { noteTitleProgress, titleActions } from '../titleActions.ts'
import type { mineViewer } from './minePersonal.ts'
import { isMineViewer } from './minePersonal.ts'

type UndoChange
  = | { kind: 'logged', entryId: string, day: string | null }
    | {
      kind: 'paused' | 'hidden'
      before: MineTitlePersonal['continuation']
      after: 'paused' | 'hidden'
    }
    | { kind: 'cyclePaused', cycleId: string, updatedAt: string }

export type MineUndoInput = UndoChange & {
  titleId: string
  title: string
  language: Parameters<typeof api.mine.getMineTitlePersonal>[1]['language']
  context: NonNullable<ReturnType<typeof mineViewer>>
  opener?: HTMLElement
}
export type MineUndo = MineUndoInput & { revision: number }

export const mineUndo = shallowRef<MineUndo>()
let revision = 0
watch(
  () => titleActions.viewer,
  () => {
    mineUndo.value = undefined
  },
  { flush: 'sync' },
)

export function showMineUndo(change: MineUndoInput) {
  if (isMineViewer(change.context))
    mineUndo.value = { ...change, revision: ++revision }
}

export function clearMineUndo(change: MineUndo) {
  if (mineUndo.value === change)
    mineUndo.value = undefined
}

/** Quick user undo; the import subsystem owns its separate atomic version guard. */
export async function applyMineUndo(change: MineUndo, signal?: AbortSignal) {
  const current = () =>
    mineUndo.value === change && isMineViewer(change.context)
  if (!current())
    return
  const query = {
    expectedProfileId: change.context.expectedProfileId,
    language: change.language,
  }
  if (change.kind === 'logged') {
    try {
      await api.mine.deleteMineDiaryEntry(
        change.entryId,
        { expectedProfileId: query.expectedProfileId },
        { signal },
      )
    }
    catch (error) {
      if (getErrorStatus(error) !== 404)
        throw error
    }
  }
  else {
    const fresh = await api.mine.getMineTitlePersonal(change.titleId, query, {
      signal,
    })
    if (!current())
      return
    if (change.kind === 'cyclePaused') {
      if (
        fresh.cycle?.id !== change.cycleId
        || fresh.cycle.state !== 'paused'
        || fresh.cycle.updatedAt !== change.updatedAt
      ) {
        clearMineUndo(change)
        return
      }
      await api.mine.patchMineCycle(
        change.cycleId,
        { ...query, action: 'resume' },
        { signal },
      )
    }
    else {
      if (fresh.continuation !== change.after) {
        clearMineUndo(change)
        return
      }
      await api.mine.patchMineTitlePersonal(
        change.titleId,
        { ...query, continuation: change.before },
        { signal },
      )
    }
  }
  clearMineUndo(change)
  if (isMineViewer(change.context))
    noteTitleProgress(change.context.viewer, change.titleId, false)
}
