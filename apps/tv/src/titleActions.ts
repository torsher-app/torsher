import type { Card, TitleDownload, TitleMine } from '@torsher/api-client'
import { reactive, readonly } from 'vue'

/** Тайтл, для которого открыто меню действий */
export interface ActionTarget {
  id: string
  title: string
  kind: Card['kind']
  // С карточки, где всё уже в библиотеке: пункт «Скачать другую раздачу»
  // (у сериала — выбранного сезона)
  redownload?: { season?: number }
}

export type ActionStep = 'main' | 'rating' | 'collections'

const state = reactive({
  target: undefined as ActionTarget | undefined,
  // С какого шага открыть: кнопка «Оценить» карточки сразу ведёт к оценке
  step: 'main' as ActionStep,
  // Последнее известное состояние тайтлов: карточка тайтла и значки постеров
  // видят правку сразу, не дожидаясь перезагрузки экрана
  known: new Map<string, TitleMine>(),
  // Загрузка тайтла после «Скачать» и «Оставить»: значок постера — сразу
  downloads: new Map<string, TitleDownload>(),
  // «Следить» после кнопки в карточке: значок постера — сразу
  follows: new Map<string, boolean>(),
  // Растёт с каждой правкой: экраны со списками перечитывают их при возврате
  version: 0,
})

export const titleActions = readonly(state)

export function openTitleActions(
  target: ActionTarget,
  step: ActionStep = 'main',
) {
  state.step = step
  state.target = target
}

export function closeTitleActions() {
  state.target = undefined
}

/** Последнее известное состояние тайтла; реактивно, как и всё хранилище */
export function knownTitleMine(id: string): TitleMine | undefined {
  return state.known.get(id)
}

export function rememberTitleMine(id: string, mine: TitleMine) {
  state.known.set(id, mine)
}

/** Правка из меню или карточки: запомнить и сообщить экранам со списками */
export function noteTitleMine(id: string, mine: TitleMine) {
  state.known.set(id, mine)
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
export function noteTitleDownload(id: string, download: TitleDownload) {
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
export function noteTitleFollow(id: string, followed: boolean) {
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
