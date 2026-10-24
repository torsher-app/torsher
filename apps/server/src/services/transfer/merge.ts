import type { ProfileTitle } from '../../db/schema.ts'

export type ConflictPolicy = 'keep' | 'replace' | 'newer'

/**
 * Что пришло о тайтле из файла: оценка с датой и отметка «Позже»; из
 * экспорта Torsher — ещё «Избранное» и «Брошено»
 */
export interface IncomingMine {
  kind: 'movie' | 'series'
  rating?: number
  ratedAt?: Date
  // null — в списке, но без даты
  watchlistAt?: Date | null
  favoriteAt?: Date
  droppedAt?: Date
}

export type RatingOutcome = 'none' | 'new' | 'same' | 'conflict'

export type MineValues = Pick<
  ProfileTitle,
  'watchlistAt' | 'favoriteAt' | 'rating' | 'ratedAt' | 'droppedAt'
>

export function ratingOutcome(
  current: MineValues | undefined,
  incoming: IncomingMine,
): RatingOutcome {
  if (!incoming.rating)
    return 'none'

  if (!current?.rating)
    return 'new'

  return current.rating === incoming.rating ? 'same' : 'conflict'
}

function takesIncoming(
  current: MineValues | undefined,
  incoming: IncomingMine,
  policy: ConflictPolicy,
) {
  const outcome = ratingOutcome(current, incoming)

  if (outcome === 'new')
    return true

  if (outcome !== 'conflict')
    return false

  if (policy === 'replace')
    return true

  // «Более поздняя» без даты в файле оставляет свою: сравнивать не с чем
  return (
    policy === 'newer'
    && !!incoming.ratedAt
    && (!current?.ratedAt || incoming.ratedAt > current.ratedAt)
  )
}

/**
 * Слияние своей строки «Моё» с пришедшей из файла. Оценка — по политике
 * конфликта; «Позже» и «Избранное» — объединение, время своей отметки
 * остаётся; «Брошено» — более позднее. Как и при ручной оценке, оценённый
 * фильм в «Позже» не остаётся. `undefined` — менять нечего.
 */
export function mergeMine(
  current: MineValues | undefined,
  incoming: IncomingMine,
  policy: ConflictPolicy,
  now: Date,
): MineValues | undefined {
  const next: MineValues = {
    watchlistAt: current?.watchlistAt ?? null,
    favoriteAt: current?.favoriteAt ?? null,
    rating: current?.rating ?? null,
    ratedAt: current?.ratedAt ?? null,
    droppedAt: current?.droppedAt ?? null,
  }
  let changed = false
  const rated = takesIncoming(current, incoming, policy)

  if (rated) {
    next.rating = incoming.rating!
    next.ratedAt = incoming.ratedAt ?? now
    changed = true
  }

  const movieRated = incoming.kind === 'movie' && next.rating !== null

  if (rated && movieRated && next.watchlistAt) {
    next.watchlistAt = null
  }
  else if (
    incoming.watchlistAt !== undefined
    && !next.watchlistAt
    && !movieRated
  ) {
    next.watchlistAt = incoming.watchlistAt ?? now
    changed = true
  }

  if (incoming.favoriteAt && !next.favoriteAt) {
    next.favoriteAt = incoming.favoriteAt
    changed = true
  }

  if (
    incoming.droppedAt
    && (!next.droppedAt || incoming.droppedAt > next.droppedAt)
  ) {
    next.droppedAt = incoming.droppedAt
    changed = true
  }

  return changed ? next : undefined
}
