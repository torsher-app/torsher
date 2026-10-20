import type { FocusVia } from '../focus/index.ts'

/** Размеры ряда в пикселях экрана: шаг карточки, её ширина, число карточек, видимая ширина. */
export interface TrackMetrics {
  step: number
  itemWidth: number
  count: number
  viewWidth: number
}

// Стрелки ‹ › под указкой листают на эту долю видимой ширины
const PAGE_SHARE = 0.8
// Пока шаг карточки не измерен, рисуем столько карточек — хватает на экран
const INITIAL_COUNT = 10

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** Упор в конце: последняя карточка встаёт к правому краю, справа нет пустоты. */
export function maxOffset(metrics: TrackMetrics) {
  const { step, itemWidth, count, viewWidth } = metrics

  return Math.max(0, (count - 1) * step + itemWidth - viewWidth)
}

/** Сдвиг, при котором карточка целиком видна; если уже видна — без изменений. */
export function ensureVisible(
  offset: number,
  index: number,
  metrics: TrackMetrics,
) {
  const left = index * metrics.step
  const right = left + metrics.itemWidth
  let next = offset

  if (left < offset)
    next = left
  else if (right > offset + metrics.viewWidth)
    next = right - metrics.viewWidth

  return clamp(next, 0, maxOffset(metrics))
}

/**
 * Куда сдвинуть ряд, когда фокус встал на карточку `index`.
 * - Наведение и колесо ряд не двигают: карточка не уезжает из-под курсора.
 * - Шаг пульта внутри ряда (`from` — прежняя карточка этого ряда): рамка фокуса
 *   стоит на месте, лента сдвигается под ней; у концов ряда — упор.
 * - Вход в ряд пультом (сверху, снизу, из рейла): ряд не двигается, если
 *   карточка видна, иначе — ровно настолько, чтобы она стала видна.
 */
export function offsetOnFocus(
  current: number,
  index: number,
  via: FocusVia,
  metrics: TrackMetrics,
  from?: number,
) {
  if (via !== 'nav')
    return current

  const shifted
    = from === undefined ? current : current + (index - from) * metrics.step

  return ensureVisible(clamp(shifted, 0, maxOffset(metrics)), index, metrics)
}

export function pageOffset(
  current: number,
  direction: 1 | -1,
  metrics: TrackMetrics,
) {
  const next = current + direction * Math.round(metrics.viewWidth * PAGE_SHARE)

  return clamp(next, 0, maxOffset(metrics))
}

export interface RenderWindow {
  start: number
  end: number
}

/**
 * Какие карточки держать в DOM: одну слева (полоска у края ряда) и два экрана
 * от левого края. Далёкие карточки не рендерятся и не держат картинки в памяти ТВ.
 */
export function renderWindow(
  offset: number,
  metrics: TrackMetrics,
): RenderWindow {
  const { step, count, viewWidth } = metrics

  if (step <= 0)
    return { start: 0, end: Math.min(count, INITIAL_COUNT) }

  const first = Math.floor(offset / step)
  const perScreen = Math.ceil(viewWidth / step)

  return {
    start: Math.max(0, first - 1),
    end: Math.min(count, first + perScreen * 2),
  }
}

/**
 * Сдвиг ленты элементов разной ширины (чипы сезонов), при котором элемент
 * целиком в окне: лента едет, только если элемент вышел за край, и не дальше
 * своего конца. `gap` — запас у края под масштаб фокуса.
 */
export function revealOffset(
  offset: number,
  item: { left: number, width: number },
  viewWidth: number,
  contentWidth: number,
  gap = 0,
) {
  let next = offset

  if (item.left - gap < next)
    next = item.left - gap
  else if (item.left + item.width + gap > next + viewWidth)
    next = item.left + item.width + gap - viewWidth

  return Math.max(0, Math.min(next, contentWidth - viewWidth))
}
