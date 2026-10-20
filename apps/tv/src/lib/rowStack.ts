/**
 * Вертикальная прокрутка рядов главной в пикселях экрана. Фокусный ряд встаёт
 * наверх области рядов, но с упором: последний ряд не уезжает выше низа экрана,
 * и под ним не остаётся пустоты.
 */
export function stackOffset(
  rowTop: number,
  contentHeight: number,
  viewHeight: number,
) {
  return Math.max(0, Math.min(rowTop, contentHeight - viewHeight))
}

// Доли пикселя от масштаба --u не должны прятать ряд, стоящий ровно на границе
const EPSILON = 1

/** Первый ряд, не заехавший под hero: ряды выше него гаснут. */
export function firstVisibleRow(rowTops: number[], offset: number) {
  const index = rowTops.findIndex(top => top >= offset - EPSILON)

  return index === -1 ? rowTops.length : index
}
