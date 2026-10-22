/**
 * Когда лоадер виден. Он проявляется через задержку (`--loader-delay` в
 * `@torsher/tokens`, держим значения вместе), а показавшись, держится не меньше
 * минимального времени: иначе ответ чуть позже задержки даёт ту же вспышку —
 * лоадер появился и тут же исчез.
 */
export const LOADER_DELAY_MS = 400
export const LOADER_MIN_VISIBLE_MS = 400

// Появление длится --motion-fast (160 мс); до середины его не видно
const NOTICEABLE_AFTER_MS = 80

/** Сколько ещё держать лоадер после ответа: 0 — убрать сразу */
export function loaderHoldMs(startedAt: number, now: number): number {
  const visibleAt = startedAt + LOADER_DELAY_MS

  if (now < visibleAt + NOTICEABLE_AFTER_MS)
    return 0

  return Math.max(0, visibleAt + LOADER_MIN_VISIBLE_MS - now)
}
