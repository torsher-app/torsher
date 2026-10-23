import type { Card, TitleMine } from '@torsher/api-client'
import { reactive, readonly } from 'vue'

/** Тайтл, для которого открыто меню действий */
export interface ActionTarget {
  id: string
  title: string
  kind: Card['kind']
}

export type ActionStep = 'main' | 'rating' | 'collections'

const state = reactive({
  target: undefined as ActionTarget | undefined,
  // С какого шага открыть: кнопка «Оценить» карточки сразу ведёт к оценке
  step: 'main' as ActionStep,
  // Последнее известное состояние тайтлов: карточка тайтла и значки постеров
  // видят правку сразу, не дожидаясь перезагрузки экрана
  known: new Map<string, TitleMine>(),
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
