import type { Card, MineDiaryEntry } from '@torsher/api-client'
import { shallowRef, watch } from 'vue'
import { isMineViewer, mineViewer } from './minePersonal.ts'
import { titleActions } from '../titleActions.ts'

interface EditorTitle {
  id: string
  title: string
  kind: Card['kind']
}

type EditRequest
  = | {
    kind: 'log'
    title?: EditorTitle
    episode?: { season: number, episode: number }
  }
  | { kind: 'diaryDate' | 'diaryNote' | 'delete', entry: MineDiaryEntry }
  | { kind: 'titleNote' | 'cycle', title: EditorTitle }

interface EditorSession {
  revision: number
  request: EditRequest
  context: NonNullable<ReturnType<typeof mineViewer>>
  opener?: HTMLElement
}

let revision = 0
export const mineEditor = shallowRef<EditorSession>()
watch(
  () => titleActions.viewer,
  () => {
    mineEditor.value = undefined
  },
  { flush: 'sync' },
)

export function openMineEditor(
  request: EditRequest,
  opener?: HTMLElement | null,
) {
  const context = mineViewer()
  if (!context)
    return
  mineEditor.value = {
    revision: ++revision,
    request,
    context,
    opener: opener ?? undefined,
  }
}

export function isMineEditor(session: EditorSession) {
  return isMineViewer(session.context) && mineEditor.value === session
}
