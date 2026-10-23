import type { MineSection } from '@torsher/api-client'

export type MineSort = 'added' | 'rating'
export type MineKind = 'all' | 'movie' | 'series'
export type MineRating
  = 'any' | 'rated' | 'unrated' | '9-10' | '7-8' | '5-6' | '1-4'

export interface MineView {
  sort: MineSort
  kind: MineKind
  rating: MineRating
}

export const MINE_SORTS: MineSort[] = ['added', 'rating']
export const MINE_KINDS: MineKind[] = ['all', 'movie', 'series']
export const MINE_RATINGS: MineRating[] = [
  'any',
  'rated',
  '9-10',
  '7-8',
  '5-6',
  '1-4',
  'unrated',
]

export const DEFAULT_MINE_VIEW: MineView = {
  sort: 'added',
  kind: 'all',
  rating: 'any',
}

const PREFIX = 'torsher.mine.'

/** Ключ строки фильтра: «9-10» → «r9to10» — дефис и цифры в начале путают пути i18n */
export function ratingKey(rating: MineRating) {
  return /^\d/.test(rating) ? `r${rating.replace('-', 'to')}` : rating
}

/** Ключ раздела: у подборок — свой у каждой */
export function sectionKey(section: Pick<MineSection, 'id' | 'collectionId'>) {
  return section.collectionId
    ? `collection:${section.collectionId}`
    : section.id
}

export function isFiltered(view: MineView) {
  return (
    view.kind !== DEFAULT_MINE_VIEW.kind
    || view.rating !== DEFAULT_MINE_VIEW.rating
  )
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Сохранённое значение от прошлой версии с другими вариантами откатывается к умолчанию */
export function parseMineView(raw: string | null): MineView {
  let saved: Partial<Record<keyof MineView, unknown>> = {}

  try {
    saved = raw ? JSON.parse(raw) : {}
  }
  catch {
    saved = {}
  }

  return {
    sort: pick(saved.sort, MINE_SORTS, DEFAULT_MINE_VIEW.sort),
    kind: pick(saved.kind, MINE_KINDS, DEFAULT_MINE_VIEW.kind),
    rating: pick(saved.rating, MINE_RATINGS, DEFAULT_MINE_VIEW.rating),
  }
}

/**
 * Сортировка и фильтры раздела «Моё» запоминаются на устройстве.
 * Хранилище недоступно — раздел открывается с умолчаниями.
 */
export function loadMineView(key: string): MineView {
  try {
    return parseMineView(window.localStorage.getItem(PREFIX + key))
  }
  catch {
    return { ...DEFAULT_MINE_VIEW }
  }
}

export function saveMineView(key: string, view: MineView) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(view))
  }
  catch {
    // Не запомнилось — в следующий раз будут умолчания
  }
}

/** Сколько карточек сетки держать в DOM: окно строк вокруг фокусной */
export function gridWindow(
  focused: number,
  total: number,
  columns: number,
  before: number,
  after: number,
) {
  const row = Math.floor(Math.max(0, focused) / columns)
  const from = Math.max(0, row - before) * columns
  const to = Math.min(total, (row + after + 1) * columns)

  return { from, to }
}
