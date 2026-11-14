import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  idleDue,
  loadScreensaverMinutes,
  saveScreensaverMinutes,
  screensaverRests,
} from '../lib/screensaver.ts'
import {
  reportScreensaverDebug,
  SCREENSAVER_DEBUG_REQUEST,
} from '../inputDebug.ts'

// Простой сверяем раз в несколько секунд: таймер не перезапускается на каждое нажатие
const CHECK_MS = 5000

/** Время заставки этого устройства: строка на «О программе» меняет его сразу. */
export const screensaverMinutes = ref(loadScreensaverMinutes())

export function setScreensaverMinutes(minutes: number) {
  screensaverMinutes.value = minutes
  saveScreensaverMinutes(minutes)
}

/**
 * Заставка при простое. Первое нажатие, движение указки или колесо при видимой
 * заставке только гасят её: событие перехватывается на захвате `window` раньше
 * движка фокуса, поэтому OK ничего не открывает, Back не уходит назад, стрелка
 * не шагает, а курсор не переносит подсветку.
 *
 * `resting` — заставка шла дольше предела и погасла в чёрный экран.
 */
export function useScreensaver(enabled: () => boolean) {
  const active = ref(false)
  const resting = ref(false)
  const visible = ref(!document.hidden)
  let activeSince = 0
  let lastInputAt = Date.now()
  let pointer: { x: number, y: number } | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  function wake(event: Event) {
    const elapsed = Date.now() - activeSince
    lastInputAt = Date.now()

    if (!active.value)
      return

    event.preventDefault()
    event.stopImmediatePropagation()
    active.value = false
    resting.value = false
    reportScreensaverDebug({ kind: 'phase', status: 'wake', elapsed })
  }

  // Chrome шлёт mousemove и без движения, когда контент сдвинулся под курсором
  function onMousemove(event: MouseEvent) {
    const moved
      = !pointer || pointer.x !== event.screenX || pointer.y !== event.screenY

    pointer = { x: event.screenX, y: event.screenY }

    if (moved)
      wake(event)
  }

  function phase(
    status: 'off' | 'waiting' | 'player' | 'active' | 'rest' | 'background',
  ) {
    reportScreensaverDebug({
      kind: 'phase',
      status,
      elapsed: Date.now() - (active.value ? activeSince : lastInputAt),
    })
  }

  function reportCurrentPhase() {
    phase(
      !visible.value
        ? 'background'
        : active.value
          ? resting.value
            ? 'rest'
            : 'active'
          : !enabled()
              ? 'player'
              : screensaverMinutes.value === 0
                ? 'off'
                : 'waiting',
    )
  }

  function updateRest(now: number) {
    if (!resting.value && screensaverRests(activeSince, now)) {
      resting.value = true
      phase('rest')
    }
  }

  function onVisibility() {
    if (document.hidden) {
      visible.value = false
      phase('background')
      return
    }
    // Сначала часовой предел, потом mount: фоновое время не продлевает hold.
    if (active.value)
      updateRest(Date.now())
    else lastInputAt = Date.now()
    visible.value = true
    phase(
      active.value
        ? resting.value
          ? 'rest'
          : 'active'
        : !enabled()
            ? 'player'
            : screensaverMinutes.value === 0
              ? 'off'
              : 'waiting',
    )
  }

  // Синхронно с маршрутом: decoder освобождается до mounted основного плеера.
  watch(
    [enabled, screensaverMinutes],
    () => {
      active.value = false
      resting.value = false
      lastInputAt = Date.now()
      phase(
        !enabled()
          ? 'player'
          : screensaverMinutes.value === 0
            ? 'off'
            : 'waiting',
      )
    },
    { flush: 'sync' },
  )

  function check() {
    const now = Date.now()
    if (active.value) {
      updateRest(now)
      return
    }
    if (
      visible.value
      && enabled()
      && idleDue(lastInputAt, now, screensaverMinutes.value)
    ) {
      activeSince = now
      active.value = true
      phase('active')
    }
  }

  const capture = { capture: true }
  const blocking = { capture: true, passive: false }

  onMounted(() => {
    phase(
      !enabled()
        ? 'player'
        : screensaverMinutes.value === 0
          ? 'off'
          : 'waiting',
    )
    window.addEventListener(SCREENSAVER_DEBUG_REQUEST, reportCurrentPhase)
    window.addEventListener('keydown', wake, capture)
    window.addEventListener('mousemove', onMousemove, capture)
    window.addEventListener('mousedown', wake, capture)
    window.addEventListener('wheel', wake, blocking)
    window.addEventListener('touchstart', wake, blocking)
    document.addEventListener('visibilitychange', onVisibility)
    timer = setInterval(check, CHECK_MS)
  })

  onBeforeUnmount(() => {
    window.removeEventListener(SCREENSAVER_DEBUG_REQUEST, reportCurrentPhase)
    window.removeEventListener('keydown', wake, capture)
    window.removeEventListener('mousemove', onMousemove, capture)
    window.removeEventListener('mousedown', wake, capture)
    window.removeEventListener('wheel', wake, capture)
    window.removeEventListener('touchstart', wake, capture)
    document.removeEventListener('visibilitychange', onVisibility)
    clearInterval(timer)
  })

  return { active, resting, visible }
}
