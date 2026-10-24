import { describe, expect, it, vi } from 'vitest'
import { createLongPress, LONG_PRESS_MS } from './longPress.ts'

function setup() {
  vi.useFakeTimers()

  const click = vi.fn()
  const long = vi.fn()
  const press = createLongPress(
    { click, long },
    {
      set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clear: id => clearTimeout(id),
    },
  )

  return { click, long, press }
}

describe('createLongPress', () => {
  it('элемент без долгого нажатия кликает сразу на keydown', () => {
    const { click, press } = setup()

    press.down('card', false, false)

    expect(click).toHaveBeenCalledWith('card')
  })

  it('короткое нажатие кликает на отпускании', () => {
    const { click, long, press } = setup()

    press.down('card', true, false)
    expect(click).not.toHaveBeenCalled()

    vi.advanceTimersByTime(LONG_PRESS_MS - 100)
    press.up()

    expect(click).toHaveBeenCalledWith('card')
    expect(long).not.toHaveBeenCalled()
  })

  it('удержание даёт долгое нажатие, повторы и отпускание после него не кликают', () => {
    const { click, long, press } = setup()

    press.down('card', true, false)
    press.down('card', true, true)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    press.down('card', true, true)
    press.up()

    expect(long).toHaveBeenCalledTimes(1)
    expect(click).not.toHaveBeenCalled()

    press.down('card', true, false)
    press.up()
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('другая клавиша посреди удержания отменяет нажатие', () => {
    const { click, long, press } = setup()

    press.down('card', true, false)
    press.cancel()
    vi.advanceTimersByTime(LONG_PRESS_MS)
    press.up()

    expect(click).not.toHaveBeenCalled()
    expect(long).not.toHaveBeenCalled()
  })

  it('короткое нажатие мышью не кликает само и не гасит клик браузера', () => {
    const { click, long, press } = setup()

    press.pointerDown('card')
    vi.advanceTimersByTime(LONG_PRESS_MS - 100)
    press.pointerUp()
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(press.takeClick()).toBe(false)
    expect(click).not.toHaveBeenCalled()
    expect(long).not.toHaveBeenCalled()
  })

  it('удержание кнопки мыши даёт долгое нажатие, клик после отпускания гасится один раз', () => {
    const { long, press } = setup()

    press.pointerDown('card')
    vi.advanceTimersByTime(LONG_PRESS_MS)
    press.pointerUp()

    expect(long).toHaveBeenCalledWith('card')
    expect(press.takeClick()).toBe(true)
    expect(press.takeClick()).toBe(false)
  })

  it('мимо элемента с долгим нажатием кнопка мыши ничего не ждёт', () => {
    const { long, press } = setup()

    press.pointerDown(undefined)
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(long).not.toHaveBeenCalled()
  })

  it('курсор ушёл с элемента посреди удержания — нажатие отменяется', () => {
    const { long, press } = setup()

    press.pointerDown('card')
    press.pointerMove('card')
    press.pointerMove('other')
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(long).not.toHaveBeenCalled()
  })

  it('нажатие и клавишей, и мышью сразу даёт одно долгое нажатие и гасит клик', () => {
    const { click, long, press } = setup()

    press.down('card', true, false)
    press.pointerDown('card')
    vi.advanceTimersByTime(LONG_PRESS_MS)
    press.up()
    press.pointerUp()

    expect(long).toHaveBeenCalledTimes(1)
    expect(click).not.toHaveBeenCalled()
    expect(press.takeClick()).toBe(true)
  })

  it('мышь раньше клавиши: отпускание клавиши не кликает, клик за браузером', () => {
    const { click, long, press } = setup()

    press.pointerDown('card')
    press.down('card', true, false)
    press.up()
    press.pointerUp()
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(click).not.toHaveBeenCalled()
    expect(long).not.toHaveBeenCalled()
    expect(press.takeClick()).toBe(false)
  })

  it('долгий OK с пульта не гасит следующий клик мыши', () => {
    const { press } = setup()

    press.down('card', true, false)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    press.up()

    expect(press.takeClick()).toBe(false)
  })
})
