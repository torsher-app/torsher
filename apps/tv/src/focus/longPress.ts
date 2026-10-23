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
 * OK у элемента с долгим нажатием: `keyup` раньше 500 мс — клик, удержание —
 * долгое нажатие, а `keyup` после него и повторы `keydown` ничего не делают.
 * Элемент без долгого нажатия кликает сразу на `keydown`, как раньше.
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
  let pending: { target: T, timer: number } | undefined
  // OK держат после долгого нажатия: его повторы и отпускание пропускаем
  let holding = false

  function cancel() {
    if (pending)
      timers.clear(pending.timer)

    pending = undefined
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

      pending = {
        target,
        timer: timers.set(() => {
          pending = undefined
          holding = true
          handlers.long(target)
        }, LONG_PRESS_MS),
      }
    },
    up() {
      if (holding) {
        holding = false

        return
      }

      const target = pending?.target

      cancel()

      if (target !== undefined)
        handlers.click(target)
    },
    // Другая клавиша посреди удержания отменяет и клик, и долгое нажатие
    cancel() {
      cancel()
      holding = false
    },
  }
}
