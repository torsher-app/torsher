import { describe, expect, it, vi } from 'vitest'
import {
  createInputModeTracker,
  createWheelStepper,
  isQuietFocus,
} from './inputMode.ts'

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

  it('спрятанный курсор возвращает пульт, а появившийся — указку', () => {
    const tracker = createInputModeTracker()

    tracker.pointerMove(10, 20)
    tracker.pointerHidden()
    expect(tracker.mode).toBe('remote')

    expect(tracker.pointerMove(10, 20)).toBe(true)
    expect(tracker.mode).toBe('pointer')
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

describe('isQuietFocus', () => {
  it('под указкой фокус не от человека тихий, наведение и колесо — нет', () => {
    expect(isQuietFocus('pointer', 'nav')).toBe(true)
    expect(isQuietFocus('pointer', 'pointer')).toBe(false)
    expect(isQuietFocus('pointer', 'wheel')).toBe(false)
  })

  it('поле ввода получает фокус и под указкой: иначе нет каретки', () => {
    expect(isQuietFocus('pointer', 'nav', true)).toBe(false)
  })

  it('под пультом фокус всегда виден', () => {
    expect(isQuietFocus('remote', 'nav')).toBe(false)
  })
})
