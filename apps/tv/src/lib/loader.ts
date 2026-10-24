/**
 * Когда лоадер виден. Он проявляется через задержку (`--loader-delay` в
 * `@torsher/tokens`, держим значения вместе), а показавшись, держится не меньше
 * минимального времени: иначе ответ чуть позже задержки даёт ту же вспышку —
 * лоадер появился и тут же исчез.
 */
export const LOADER_DELAY_MS = 400
export const LOADER_MIN_VISIBLE_MS = 400

/**
 * Торшер на сцене плеера держится дольше: после него экран растворяется в
 * видео, и короткий показ читается как сбой, а не как подготовка
 */
export const STAGE_MIN_VISIBLE_MS = 800

// Появление длится --motion-fast (160 мс); до середины его не видно
const NOTICEABLE_AFTER_MS = 80

/**
 * Сколько ещё держать лоадер после ответа: 0 — убрать сразу. `delay` 0 —
 * лоадер встал без задержки (после повтора он уже был на экране).
 */
export function loaderHoldMs(
  startedAt: number,
  now: number,
  { delay = LOADER_DELAY_MS, minVisible = LOADER_MIN_VISIBLE_MS } = {},
): number {
  const visibleAt = startedAt + delay

  if (delay > 0 && now < visibleAt + NOTICEABLE_AFTER_MS)
    return 0

  return Math.max(0, visibleAt + minVisible - now)
}
