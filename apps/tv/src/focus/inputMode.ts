import type { Direction } from './geometry.ts'

/**
 * `remote` — 5-way пульт или клавиатура, `pointer` — курсор Magic Remote или мышь.
 * Под указкой наведение только подсвечивает элемент: ряды и страница не едут,
 * иначе карточка уезжает из-под курсора.
 */
export type InputMode = 'remote' | 'pointer'

/**
 * Откуда пришёл фокус: `nav` — стрелки, открытие экрана (экран подстраивается
 * под элемент), `pointer` — наведение (экран стоит на месте), `wheel` — колесо
 * (ряды переключаются по вертикали, но лента ряда не листается).
 */
export type FocusVia = 'nav' | 'pointer' | 'wheel'

/**
 * Фокус, поставленный не человеком (открытие экрана, возврат по Back, панель),
 * под указкой «тихий»: движок помнит элемент, но DOM-фокус не ставит. Иначе
 * мышь открывает экран, а на кнопке, к которой не подходили, уже подсветка.
 * Поле ввода — исключение: без DOM-фокуса нет каретки, и печатать нельзя.
 */
export function isQuietFocus(mode: InputMode, via: FocusVia, editable = false) {
  return mode === 'pointer' && via === 'nav' && !editable
}

export interface InputModeTracker {
  readonly mode: InputMode
  /** `true`, если курсор действительно сдвинулся и режим теперь `pointer`. */
  pointerMove: (x: number, y: number) => boolean
  /** Стрелка возвращает режим пульта. */
  arrow: () => void
  /** Курсор спрятался сам (webOS прячет его через несколько секунд покоя). */
  pointerHidden: () => void
}

export function createInputModeTracker(
  onChange: (mode: InputMode) => void = () => {},
): InputModeTracker {
  let mode: InputMode = 'remote'
  let lastX: number | undefined
  let lastY: number | undefined

  function set(next: InputMode) {
    if (mode === next)
      return

    mode = next
    onChange(next)
  }

  return {
    get mode() {
      return mode
    },
    pointerMove(x, y) {
      // Chrome шлёт mousemove и без движения, когда содержимое сдвинулось под курсором
      if (x === lastX && y === lastY)
        return false

      lastX = x
      lastY = y
      set('pointer')

      return true
    },
    arrow() {
      set('remote')
    },
    pointerHidden() {
      // Курсор появится там же, где спрятался: первый mousemove после этого —
      // уже движение, даже с прежними координатами
      lastX = undefined
      lastY = undefined
      set('remote')
    },
  }
}

// Один «щелчок» колеса на тачпаде — это серия событий: шаг фокуса — не чаще раза в интервал
export const WHEEL_INTERVAL_MS = 200

/** Колесо переключает ряды: только вертикальная прокрутка, с прореживанием. */
export function createWheelStepper(intervalMs = WHEEL_INTERVAL_MS) {
  let lastStep = Number.NEGATIVE_INFINITY

  return function step(deltaY: number, now: number): Direction | undefined {
    if (deltaY === 0 || now - lastStep < intervalMs)
      return undefined

    lastStep = now

    return deltaY > 0 ? 'down' : 'up'
  }
}
