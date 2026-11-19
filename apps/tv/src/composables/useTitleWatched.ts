import type { MineTitlePersonal } from '@torsher/api-client'
import { api } from '../api.ts'
import { mineViewer } from '../lib/minePersonal.ts'
import {
  isTitleViewer,
  noteTitleMineRefresh,
  noteTitleProgress,
  rememberTitleMine,
  titleMineRevision,
} from '../titleActions.ts'

/** Успешный PUT остаётся успешным, даже если последующее чтение недоступно. */
export async function saveTitleWatched(
  id: string,
  watched: boolean,
  language: string,
  viewer: number,
  onSaved?: (personal: MineTitlePersonal) => void,
) {
  const context = mineViewer()
  if (!context || context.viewer !== viewer)
    return
  const personal = await api.mine.putMineSeen(id, {
    expectedProfileId: context.expectedProfileId,
    language,
    season: 0,
    episode: 0,
    watched,
  })
  noteTitleProgress(viewer, id, false)
  if (!isTitleViewer(viewer))
    return
  onSaved?.(personal)

  const revision = titleMineRevision(id)
  try {
    const fresh = await api.titles.getTitleMine(id, { language })
    if (!isTitleViewer(viewer))
      return
    rememberTitleMine(id, fresh, viewer, revision)
    return fresh
  }
  catch {
    noteTitleMineRefresh(viewer, id)
  }
}
