import type { Scrub } from '../lib/player.ts'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import {
  holdScrub,
  PAUSE_DIM_MS,
  pressScrub,
  SCRUB_COMMIT_MS,
} from '../lib/player.ts'

// OSD прячется сам, пока видео идёт; на паузе и при открытой панели остаётся
const OSD_HIDE_MS = 4000

interface PlayerOsdOptions {
  /** Можно ли сейчас спрятать OSD по таймеру */
  canAutoHide: () => boolean
  /** Можно ли затемнить кадр: пауза зрителя без панели и ошибки */
  canDim: () => boolean
  /** Позиция и длительность для расчёта цели перемотки */
  position: () => number
  duration: () => number
  /** OSD появился: экран ставит фокус на таймлайн */
  onShow: () => void
  /** Набранная перемотка уходит в плеер одним переходом */
  onSeek: (target: number) => void
}

/**
 * Видимость OSD с автоскрытием и перемотка стрелками с ускорением при удержании.
 * На паузе без нажатий OSD гаснет и кадр затемняется (`dimmed`), как у Netflix.
 */
export function usePlayerOsd(options: PlayerOsdOptions) {
  const visible = ref(false)
  const dimmed = ref(false)
  const scrub = shallowRef<Scrub | null>(null)

  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let commitTimer: ReturnType<typeof setTimeout> | undefined
  let dimTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleDim() {
    clearTimeout(dimTimer)

    if (!options.canDim())
      return

    dimTimer = setTimeout(() => {
      if (!options.canDim() || scrub.value)
        return

      visible.value = false
      dimmed.value = true
    }, PAUSE_DIM_MS)
  }

  function scheduleHide() {
    clearTimeout(hideTimer)

    if (options.canAutoHide() && !scrub.value)
      hideTimer = setTimeout(() => (visible.value = false), OSD_HIDE_MS)

    scheduleDim()
  }

  // Пауза снята, открыта панель или ошибка — затемнения нет; пауза началась —
  // отсчёт пошёл: событие `pause` приходит уже после show()
  watch(options.canDim, (can) => {
    if (can) {
      scheduleDim()
    }
    else {
      clearTimeout(dimTimer)
      dimmed.value = false
    }
  })

  /** Первое нажатие на затемнённой паузе: OSD возвращается с прежним фокусом */
  function wake() {
    dimmed.value = false
    visible.value = true
    scheduleHide()
  }

  function show() {
    const wasHidden = !visible.value

    dimmed.value = false
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
    clearTimeout(dimTimer)
  }

  onScopeDispose(dispose)

  return { visible, dimmed, scrub, show, wake, hide, hold, scheduleHide, step }
}
