import { api } from '../api.ts'
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
) {
  await api.titles.putTitleWatched(id, { watched }, { language })
  noteTitleProgress(viewer, id, false)
  if (!isTitleViewer(viewer))
    return

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
