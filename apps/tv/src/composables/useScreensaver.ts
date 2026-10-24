import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  idleDue,
  loadScreensaverMinutes,
  saveScreensaverMinutes,
  screensaverRests,
} from '../lib/screensaver.ts'

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
  let activeSince = 0
  let lastInputAt = Date.now()
  let pointer: { x: number, y: number } | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  function wake(event: Event) {
    lastInputAt = Date.now()

    if (!active.value)
      return

    event.preventDefault()
    event.stopImmediatePropagation()
    active.value = false
    resting.value = false
  }

  // Chrome шлёт mousemove и без движения, когда контент сдвинулся под курсором
  function onMousemove(event: MouseEvent) {
    const moved
      = !pointer || pointer.x !== event.screenX || pointer.y !== event.screenY

    pointer = { x: event.screenX, y: event.screenY }

    if (moved)
      wake(event)
  }

  function onVisibility() {
    if (!document.hidden)
      lastInputAt = Date.now()
  }

  function check() {
    const now = Date.now()

    if (active.value) {
      resting.value = screensaverRests(activeSince, now)
      return
    }

    if (
      !document.hidden
      && enabled()
      && idleDue(lastInputAt, now, screensaverMinutes.value)
    ) {
      active.value = true
      activeSince = now
    }
  }

  const capture = { capture: true }
  const blocking = { capture: true, passive: false }

  onMounted(() => {
    window.addEventListener('keydown', wake, capture)
    window.addEventListener('mousemove', onMousemove, capture)
    window.addEventListener('mousedown', wake, capture)
    window.addEventListener('wheel', wake, blocking)
    window.addEventListener('touchstart', wake, blocking)
    document.addEventListener('visibilitychange', onVisibility)
    timer = setInterval(check, CHECK_MS)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', wake, capture)
    window.removeEventListener('mousemove', onMousemove, capture)
    window.removeEventListener('mousedown', wake, capture)
    window.removeEventListener('wheel', wake, capture)
    window.removeEventListener('touchstart', wake, capture)
    document.removeEventListener('visibilitychange', onVisibility)
    clearInterval(timer)
  })

  return { active, resting }
}
