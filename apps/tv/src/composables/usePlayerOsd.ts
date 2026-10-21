import type { Scrub } from '../lib/player.ts'
import { onScopeDispose, ref, shallowRef } from 'vue'
import { holdScrub, pressScrub, SCRUB_COMMIT_MS } from '../lib/player.ts'

// OSD прячется сам, пока видео идёт; на паузе и при открытой панели остаётся
const OSD_HIDE_MS = 4000

interface PlayerOsdOptions {
  /** Можно ли сейчас спрятать OSD по таймеру */
  canAutoHide: () => boolean
  /** Позиция и длительность для расчёта цели перемотки */
  position: () => number
  duration: () => number
  /** OSD появился: экран ставит фокус на таймлайн */
  onShow: () => void
  /** Набранная перемотка уходит в плеер одним переходом */
  onSeek: (target: number) => void
}

/** Видимость OSD с автоскрытием и перемотка стрелками с ускорением при удержании */
export function usePlayerOsd(options: PlayerOsdOptions) {
  const visible = ref(false)
  const scrub = shallowRef<Scrub | null>(null)

  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let commitTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleHide() {
    clearTimeout(hideTimer)

    if (options.canAutoHide() && !scrub.value)
      hideTimer = setTimeout(() => (visible.value = false), OSD_HIDE_MS)
  }

  function show() {
    const wasHidden = !visible.value

    visible.value = true

    if (wasHidden)
      options.onShow()

    scheduleHide()
  }

  function hide() {
    clearTimeout(hideTimer)
    visible.value = false
  }

  /** Держит OSD, пока поверх него открыта панель */
  function hold() {
    clearTimeout(hideTimer)
  }

  function commit() {
    if (scrub.value)
      options.onSeek(scrub.value.target)

    scrub.value = null
    scheduleHide()
  }

  function step(direction: 1 | -1, held: boolean) {
    const current = scrub.value
    const now = Date.now()
    const duration = options.duration()

    scrub.value
      = held && current && current.direction === direction
        ? holdScrub(current, now, duration)
        : pressScrub(current, options.position(), direction, now, duration)

    show()
    clearTimeout(commitTimer)
    commitTimer = setTimeout(commit, SCRUB_COMMIT_MS)
  }

  function dispose() {
    clearTimeout(hideTimer)
    clearTimeout(commitTimer)
  }

  onScopeDispose(dispose)

  return { visible, scrub, show, hide, hold, scheduleHide, step }
}
