/**
 * Ступени сжатия ряда кнопок, когда он не влез и с пределом ширины кнопки:
 * 1 — кнопки без второй строки уже вдвое; 2 — у вторичных кнопок прячется
 * вторая строка; дальше вторичные кнопки со значком по одной, справа налево,
 * остаются значком — ровно столько, сколько нужно. Последняя ступень — значки
 * все, и сжимается главная кнопка: она держит текст до последнего
 */
export const TEXT_STEPS = 2

/** Номер последней ступени ряда, где `collapsible` кнопок могут стать значком */
export function lastStep(collapsible: number) {
  return TEXT_STEPS + collapsible + 1
}

/** Сколько кнопок справа на этой ступени свёрнуто в значок */
export function collapsedAt(step: number, collapsible: number) {
  return Math.min(Math.max(step - TEXT_STEPS, 0), collapsible)
}

/** Первая ступень, на которой ряд влез; последнюю не примеряет — дальше некуда */
export function fitLevel(fits: (step: number) => boolean, last: number) {
  for (let step = 0; step < last; step++) {
    if (fits(step))
      return step
  }

  return last
}

/** Отрезок по горизонтали: левый край и ширина */
export interface Span {
  left: number
  width: number
}

/**
 * Сдвиг подписи, отцентрованной под кнопкой, чтобы она не вышла за окно.
 * Подпись шире окна прижимается к его левому краю: начало текста важнее конца
 */
export function captionShift(anchor: Span, caption: number, bounds: Span) {
  const left = anchor.left + (anchor.width - caption) / 2
  const right = bounds.left + bounds.width

  if (caption >= bounds.width || left < bounds.left)
    return bounds.left - left

  if (left + caption > right)
    return right - (left + caption)

  return 0
}
