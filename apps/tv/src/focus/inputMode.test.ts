import { describe, expect, it, vi } from 'vitest'
import { createInputModeTracker, createWheelStepper } from './inputMode.ts'

describe('createInputModeTracker', () => {
  it('стартует в режиме пульта', () => {
    expect(createInputModeTracker().mode).toBe('remote')
  })

  it('движение курсора включает указку', () => {
    const onChange = vi.fn()
    const tracker = createInputModeTracker(onChange)

    expect(tracker.pointerMove(10, 20)).toBe(true)
    expect(tracker.mode).toBe('pointer')
    expect(onChange).toHaveBeenCalledWith('pointer')
  })

  it('mousemove без сдвига курсора не считается движением', () => {
    const tracker = createInputModeTracker()

    tracker.pointerMove(10, 20)
    tracker.arrow()

    expect(tracker.pointerMove(10, 20)).toBe(false)
    expect(tracker.mode).toBe('remote')
  })

  it('стрелка возвращает пульт', () => {
    const onChange = vi.fn()
    const tracker = createInputModeTracker(onChange)

    tracker.pointerMove(10, 20)
    tracker.arrow()

    expect(tracker.mode).toBe('remote')
    expect(onChange).toHaveBeenLastCalledWith('remote')
  })

  it('не сообщает о смене режима, если он не менялся', () => {
    const onChange = vi.fn()
    const tracker = createInputModeTracker(onChange)

    tracker.arrow()
    tracker.pointerMove(1, 1)
    tracker.pointerMove(2, 2)

    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('createWheelStepper', () => {
  it('вниз и вверх по знаку прокрутки', () => {
    const step = createWheelStepper(200)

    expect(step(120, 0)).toBe('down')
    expect(step(-120, 1000)).toBe('up')
  })

  it('серия событий одного жеста даёт один шаг', () => {
    const step = createWheelStepper(200)

    expect(step(4, 0)).toBe('down')
    expect(step(8, 50)).toBeUndefined()
    expect(step(8, 199)).toBeUndefined()
    expect(step(8, 200)).toBe('down')
  })

  it('горизонтальная прокрутка не двигает фокус', () => {
    expect(createWheelStepper()(0, 0)).toBeUndefined()
  })
})
