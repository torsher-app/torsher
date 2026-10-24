// Дольше — OK кажется зависшим, короче — меню открывается от обычного нажатия
export const LONG_PRESS_MS = 500

/** Элемент с долгим нажатием: OK кликает на отпускании, удержание открывает меню */
export const LONG_PRESS_ATTRIBUTE = 'data-long-press'
export const LONG_PRESS_EVENT = 'longpress'

export interface LongPressTimers {
  set: (fn: () => void, ms: number) => number
  clear: (id: number) => void
}

/**
 * Долгое нажатие с пульта и с мыши.
 *
 * OK у элемента с долгим нажатием: `keyup` раньше 500 мс — клик, удержание —
 * долгое нажатие, а `keyup` после него и повторы `keydown` ничего не делают.
 * Элемент без долгого нажатия кликает сразу на `keydown`, как раньше.
 *
 * Кнопка мыши: OK Magic Remote под курсором приходит как кнопка мыши, а не
 * Enter. Короткое нажатие кликает само, удержание — долгое нажатие, и клик
 * после отпускания гасится (`takeClick`). Одно нажатие может прийти и клавишей,
 * и мышью сразу: долгое нажатие срабатывает один раз.
 */
export function createLongPress<T>(
  handlers: {
    click: (target: T) => void
    long: (target: T) => void
  },
  timers: LongPressTimers = {
    set: (fn, ms) => window.setTimeout(fn, ms),
    clear: id => window.clearTimeout(id),
  },
) {
  let pending:
    { target: T, timer: number, source: 'key' | 'pointer' } | undefined
  // OK или кнопку держат после долгого нажатия: повторы и отпускание пропускаем
  let holding = false
  let pointerPressed = false
  // Долгое нажатие сработало под зажатой кнопкой мыши: её клик не открывает элемент
  let swallowClick = false

  function cancel() {
    if (pending)
      timers.clear(pending.timer)

    pending = undefined
  }

  function start(target: T, source: 'key' | 'pointer') {
    pending = {
      target,
      source,
      timer: timers.set(() => {
        pending = undefined
        holding = true
        swallowClick = pointerPressed
        handlers.long(target)
      }, LONG_PRESS_MS),
    }
  }

  return {
    down(target: T | undefined, hasLongPress: boolean, repeat: boolean) {
      if (repeat || pending || holding)
        return

      if (!target)
        return

      if (!hasLongPress) {
        handlers.click(target)

        return
      }

      start(target, 'key')
    },
    up() {
      if (holding) {
        holding = false

        return
      }

      // Нажатие мышью кликает само, отпускание клавиши его не трогает
      if (pending?.source !== 'key')
        return

      const target = pending.target

      cancel()
      handlers.click(target)
    },
    /** Кнопка мыши нажата; `target` — элемент с долгим нажатием под курсором */
    pointerDown(target: T | undefined) {
      pointerPressed = true
      swallowClick = false

      if (target !== undefined && !pending && !holding)
        start(target, 'pointer')
    },
    pointerUp() {
      pointerPressed = false
      holding = false

      if (pending?.source === 'pointer')
        cancel()
    },
    // Курсор ушёл с элемента посреди удержания — нажатие отменяется
    pointerMove(target: T | undefined) {
      if (pending?.source === 'pointer' && pending.target !== target)
        cancel()
    },
    /** `true` — этот клик мыши завершает долгое нажатие, и его надо погасить */
    takeClick() {
      const swallow = swallowClick

      swallowClick = false

      return swallow
    },
    // Другая клавиша посреди удержания отменяет и клик, и долгое нажатие
    cancel() {
      cancel()
      holding = false
    },
  }
}
