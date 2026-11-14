import { ref } from 'vue'

/**
 * Журнал ввода поверх экрана. В браузере — `?debug=keys` в адресе, на ТВ
 * адрес не поменять: там его включает тайное сочетание на «О программе».
 */
export const inputDebug = ref(
  new URLSearchParams(window.location.search).get('debug') === 'keys',
)

export function toggleInputDebug() {
  inputDebug.value = !inputDebug.value
}

/** Только фиксированные локальные события; никогда не отправляются на сервер. */
export type ScreensaverDebugEvent
  = | {
    kind: 'phase'
    status:
      | 'off'
      | 'waiting'
      | 'player'
      | 'active'
      | 'rest'
      | 'background'
      | 'wake'
    elapsed: number
  }
  | {
    kind: 'video'
    status:
      | 'start'
      | 'progress'
      | 'recovered'
      | 'pause'
      | 'rejected'
      | 'error'
      | 'stall'
      | 'retry'
      | 'release'
    elapsed: number
    code?: number
  }
  | {
    kind: 'luna'
    status:
      | 'unavailable'
      | 'register-sent'
      | 'registered'
      | 'register-failed'
      | 'malformed'
      | 'response-sent'
      | 'response-ok'
      | 'response-failed'
      | 'release'
    code?: number
  }

export const SCREENSAVER_DEBUG_EVENT = 'torsher:screensaver-debug'
export const SCREENSAVER_DEBUG_REQUEST = 'torsher:screensaver-debug-request'
export function reportScreensaverDebug(event: ScreensaverDebugEvent) {
  if (inputDebug.value) {
    window.dispatchEvent(
      new CustomEvent(SCREENSAVER_DEBUG_EVENT, { detail: event }),
    )
  }
}
