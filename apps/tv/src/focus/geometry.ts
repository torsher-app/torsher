export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Candidate<T> {
  item: T
  rect: Rect
}

// Доли пикселя от масштабирования и transform не должны выкидывать соседа из выборки
const EPSILON = 1
// Смещение поперёк направления штрафуем сильнее, чем расстояние вдоль него:
// иначе стрелка вправо уводит в соседний ряд
const CROSS_AXIS_WEIGHT = 2

function isAhead(from: Rect, to: Rect, direction: Direction) {
  switch (direction) {
    case 'right':
      return to.left >= from.right - EPSILON
    case 'left':
      return to.right <= from.left + EPSILON
    case 'down':
      return to.top >= from.bottom - EPSILON
    case 'up':
      return to.bottom <= from.top + EPSILON
  }
}

function isInLine(from: Rect, to: Rect, direction: Direction) {
  if (direction === 'left' || direction === 'right')
    return to.top < from.bottom && to.bottom > from.top

  return to.left < from.right && to.right > from.left
}

function score(from: Rect, to: Rect, direction: Direction) {
  const horizontal = direction === 'left' || direction === 'right'

  const along = {
    right: to.left - from.right,
    left: from.left - to.right,
    down: to.top - from.bottom,
    up: from.top - to.bottom,
  }[direction]

  const across = horizontal
    ? Math.abs((to.top + to.bottom) / 2 - (from.top + from.bottom) / 2)
    : Math.abs((to.left + to.right) / 2 - (from.left + from.right) / 2)

  return Math.max(along, 0) + across * CROSS_AXIS_WEIGHT
}

/**
 * Выбирает соседа по геометрии:
 * сначала элементы на одной линии с текущим, затем остальные в том же направлении.
 */
export function findNext<T>(
  from: Rect,
  candidates: Candidate<T>[],
  direction: Direction,
): T | undefined {
  const ahead = candidates.filter(c => isAhead(from, c.rect, direction))
  const inLine = ahead.filter(c => isInLine(from, c.rect, direction))
  const group = inLine.length > 0 ? inLine : ahead

  let best: Candidate<T> | undefined

  for (const candidate of group) {
    if (
      !best
      || score(from, candidate.rect, direction) < score(from, best.rect, direction)
    ) {
      best = candidate
    }
  }

  return best?.item
}

/**
 * Кандидат в той же колонке: ближайший по центру по горизонтали. Так выбирается
 * карточка соседнего ряда «под» или «над» текущей, куда бы ни был пролистан ряд.
 */
export function findInColumn<T>(
  from: Rect,
  candidates: Candidate<T>[],
): T | undefined {
  const center = (from.left + from.right) / 2

  let best: Candidate<T> | undefined
  let bestDistance = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const distance = Math.abs(
      (candidate.rect.left + candidate.rect.right) / 2 - center,
    )

    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }

  return best?.item
}
