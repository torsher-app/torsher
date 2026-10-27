/**
 * Виртуальная сетка постеров: в DOM только строки рядом с опорной (выровненной
 * с пульта, в вебе — верхней видимой), место остальных держат отступы.
 */

// Строк в DOM выше и ниже опорной: шаг пульта всегда находит соседа
export const ROWS_BEFORE = 2
export const ROWS_AFTER = 4
// Картинки грузят строки от одной выше до двух ниже опорной
const IMAGES_BEFORE = 1
const IMAGES_AFTER = 2
// Следующая страница — когда до конца загруженного осталось меньше стольких
// строк: первая страница TMDB — неполные четыре строки, и вторая просится сразу
export const LOAD_AHEAD_ROWS = 4

export function rowsOf<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = []

  for (let index = 0; index < items.length; index += columns)
    rows.push(items.slice(index, index + columns))

  return rows
}

/** Строки `[start, end)` в DOM */
export function windowOf(anchor: number, total: number) {
  const start = Math.max(0, Math.min(anchor - ROWS_BEFORE, total - 1))
  const end = Math.min(total, Math.max(anchor, 0) + ROWS_AFTER + 1)

  return { start: Math.max(0, start), end: Math.max(end, start) }
}

export function hasImages(row: number, anchor: number) {
  return row >= anchor - IMAGES_BEFORE && row <= anchor + IMAGES_AFTER
}

/** Пора ли просить следующую страницу */
export function needsMore(anchor: number, loadedRows: number) {
  return loadedRows - 1 - anchor < LOAD_AHEAD_ROWS
}

/** Верхняя видимая строка при прокрутке `offset` (веб) */
export function rowAt(offset: number, rowHeight: number, total: number) {
  if (rowHeight <= 0 || total === 0)
    return 0

  return Math.min(total - 1, Math.max(0, Math.floor(offset / rowHeight)))
}

/** Опорные строки окна: от `first` до `last` включительно */
export interface AnchorSpan {
  first: number
  last: number
}

/**
 * Опорные строки окна в вебе: верхняя видимая и, пока прокрутка идёт за
 * фокусом, строка с фокусом. Плавная прокрутка отстаёт от быстрых стрелок, и
 * окно от одной верхней видимой убрало бы строку с фокусом из DOM. Колесо
 * уводит прокрутку от фокуса — тогда окно держит только видимое
 */
export function anchorSpan(
  top: number,
  focused: number,
  followsFocus: boolean,
): AnchorSpan {
  return followsFocus
    ? { first: Math.min(top, focused), last: Math.max(top, focused) }
    : { first: top, last: top }
}
