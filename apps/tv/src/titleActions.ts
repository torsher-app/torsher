import type {
  Card,
  MineCycle,
  TitleDownload,
  TitleMine,
} from '@torsher/api-client'
import type { ContinueState } from './lib/minePersonal.ts'
import { reactive, readonly } from 'vue'

/** Тайтл, для которого открыто меню действий */
export interface ActionTarget {
  id: string
  title: string
  kind: Card['kind']
  // Карточка с быстрым запуском просмотра: отдельный переход к тайтлу
  canOpenTitle?: boolean
  continuation?: {
    state: ContinueState
    cycleId?: string
    cycleState?: MineCycle['state']
  }
  // С карточки, где всё уже в библиотеке: пункт «Скачать другую раздачу»
  // (у сериала — выбранного сезона)
  redownload?: { season?: number }
}

export type ActionStep = 'main' | 'rating' | 'collections'

const state = reactive({
  target: undefined as ActionTarget | undefined,
  // С какого шага открыть: кнопка «Оценить» карточки сразу ведёт к оценке
  step: 'main' as ActionStep,
  menuRevision: 0,
  // Последнее известное состояние тайтлов: карточка тайтла и значки постеров
  // видят правку сразу, не дожидаясь перезагрузки экрана
  known: new Map<string, TitleMine>(),
  mineRevisions: new Map<string, number>(),
  writing: new Set<string>(),
  // Загрузка тайтла после «Скачать» и «Оставить»: значок постера — сразу
  downloads: new Map<string, TitleDownload>(),
  // «Следить» после кнопки в карточке: значок постера — сразу
  follows: new Map<string, boolean>(),
  // Растёт с каждой правкой: экраны со списками перечитывают их при возврате
  version: 0,
  viewer: 0,
  progress: new Map<string, number>(),
  progressWildcard: 0,
  mineProgress: new Map<string, number>(),
  mineWildcard: 0,
})

export const titleActions = readonly(state)

let viewerId: string | undefined

/** Один активный зритель; возврат к прежнему ID создаёт новое поколение. */
export function setTitleViewer(id: string | undefined) {
  if (id === viewerId)
    return

  viewerId = id
  state.viewer++
  state.target = undefined
  state.known.clear()
  state.mineRevisions.clear()
  state.writing.clear()
  state.downloads.clear()
  state.follows.clear()
  state.progress.clear()
  state.mineProgress.clear()
  state.mineWildcard++
  state.progressWildcard++
  state.version++
}

export function captureTitleViewer() {
  return state.viewer
}

export function titleViewerId() {
  return viewerId
}

export function isTitleViewer(viewer: number) {
  return viewer === state.viewer
}

export function titleProgressVersion(id: string) {
  return `${state.viewer}:${state.progressWildcard}:${state.progress.get(id) ?? 0}`
}

/** Только подтверждённая запись прогресса; без ID сервер сам сопоставляет файл. */
export function noteTitleProgress(
  viewer: number,
  id: string | undefined,
  refreshMine = true,
) {
  if (!isTitleViewer(viewer))
    return

  if (id) {
    state.mineRevisions.set(id, titleMineRevision(id) + 1)
    state.progress.set(id, (state.progress.get(id) ?? 0) + 1)
  }
  else {
    state.progressWildcard++
  }
  if (refreshMine)
    noteTitleMineRefresh(viewer, id)
  state.version++
}

/** Повторить только чтение mine, не публикуя вторую успешную мутацию. */
export function noteTitleMineRefresh(viewer: number, id: string | undefined) {
  if (!isTitleViewer(viewer))
    return
  if (id) {
    state.mineRevisions.set(id, titleMineRevision(id) + 1)
    state.mineProgress.set(id, (state.mineProgress.get(id) ?? 0) + 1)
  }
  else {
    state.mineWildcard++
  }
}

export function titleMineProgressVersion(id: string) {
  return `${state.viewer}:${state.mineWildcard}:${state.mineProgress.get(id) ?? 0}`
}

export function openTitleActions(
  target: ActionTarget,
  step: ActionStep = 'main',
) {
  state.menuRevision++
  state.step = step
  state.target = target
}

/** Штатное закрытие не скрывает результат записи; новое меню уже другой контекст. */
export function isTitleActionCurrent(viewer: number, menuRevision: number) {
  return isTitleViewer(viewer) && state.menuRevision === menuRevision
}

export function closeTitleActions() {
  state.target = undefined
}

/** Последнее известное состояние тайтла; реактивно, как и всё хранилище */
export function knownTitleMine(id: string): TitleMine | undefined {
  return state.known.get(id)
}

export function titleMineRevision(id: string) {
  return state.mineRevisions.get(id) ?? 0
}

export function setTitleMineWriting(
  id: string,
  writing: boolean,
  viewer: number,
) {
  if (!isTitleViewer(viewer))
    return
  state.mineRevisions.set(id, titleMineRevision(id) + 1)
  if (writing)
    state.writing.add(id)
  else state.writing.delete(id)
}

export function rememberTitleMine(
  id: string,
  mine: TitleMine,
  viewer: number,
  revision?: number,
) {
  if (!isTitleViewer(viewer))
    return

  if (
    revision !== undefined
    && (revision !== titleMineRevision(id) || state.writing.has(id))
  ) {
    return
  }
  state.mineRevisions.set(id, titleMineRevision(id) + 1)
  state.known.set(id, mine)
}

/** Правка из меню или карточки: запомнить и сообщить экранам со списками */
export function noteTitleMine(id: string, mine: TitleMine, viewer: number) {
  if (!isTitleViewer(viewer))
    return

  rememberTitleMine(id, mine, viewer)
  state.version++
}

/**
 * Своя оценка на постере: поставленная только что важнее той, что пришла
 * с карточкой. Видна всегда, настройка профиля выбирает только сервис.
 */
export function ownRatingOf(card: Card): number | undefined {
  const known = knownTitleMine(card.id)

  return known ? (known.rating ?? undefined) : card.ownRating
}

/** «Скачать» или «Оставить»: запомнить и сообщить экранам со списками */
export function noteTitleDownload(
  id: string,
  download: TitleDownload,
  viewer: number,
) {
  if (!isTitleViewer(viewer))
    return

  state.downloads.set(id, download)
  state.version++
}

export function knownTitleDownload(id: string): TitleDownload | undefined {
  return state.downloads.get(id)
}

/**
 * Значок загрузки на постере: из карточки, а если в ней его нет — известное
 * после «Скачать» или «Оставить» на витрине (карточки экрана пришли раньше).
 */
export function downloadOf(card: Card) {
  if (card.availability)
    return { state: card.availability, progress: card.downloadProgress ?? 0 }

  const known = knownTitleDownload(card.id)

  return known?.state
    ? { state: known.state, progress: known.progress }
    : undefined
}

/** «Следить» на карточке: запомнить и сообщить экранам со списками */
export function noteTitleFollow(id: string, followed: boolean, viewer: number) {
  if (!isTitleViewer(viewer))
    return

  if (state.follows.get(id) === followed)
    return

  state.follows.set(id, followed)
  state.version++
}

/**
 * Значок «слежу» на постере: включённое или выключенное на витрине важнее
 * карточки, пришедшей раньше. Новые серии — только из карточки.
 */
export function followOf(card: Card) {
  const known = state.follows.get(card.id)
  const followed = known ?? !!card.followed

  return followed ? { newCount: card.followNew ?? 0 } : undefined
}
