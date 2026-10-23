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
})
