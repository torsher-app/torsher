import type { Card, PosterRating, TitleMine } from '@torsher/api-client'
import { reactive, readonly } from 'vue'
import { session } from './session.ts'

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
 * Оценка на постере: своя, поставленная только что, важнее той, что пришла
 * с карточкой, — если профиль показывает свои оценки.
 */
export function posterRatingOf(card: Card): PosterRating | undefined {
  const known = knownTitleMine(card.id)

  if (!known || (session.profile?.posterRating ?? 'own') !== 'own')
    return card.posterRating

  return known.rating ? { source: 'own', value: known.rating } : undefined
}
