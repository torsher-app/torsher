import { describe, expect, it } from 'vitest'
import { createTapCounter, describeInput } from './inputLog.ts'

describe('describeInput', () => {
  it('клавиша — код, key и повтор', () => {
    expect(
      describeInput({
        type: 'keydown',
        keyCode: 13,
        key: 'Enter',
        repeat: true,
      }),
    ).toBe('keydown 13 key=Enter repeat')
    expect(describeInput({ type: 'keyup', keyCode: 13, key: '' })).toBe(
      'keyup 13 key=',
    )
  })

  it('мышь — кнопка, detail и элемент под курсором', () => {
    expect(
      describeInput({
        type: 'click',
        button: 0,
        detail: 1,
        target: { tagName: 'BUTTON', className: 'card poster-card' },
      }),
    ).toBe('click button=0 detail=1 button.card')
  })

  it('элемент без строкового className — только тег', () => {
    expect(
      describeInput({
        type: 'mousedown',
        button: 0,
        detail: 1,
        target: { tagName: 'svg', className: {} },
      }),
    ).toBe('mousedown button=0 detail=1 svg')
  })

  it('курсор Magic Remote — видимость из detail', () => {
    expect(
      describeInput({
        type: 'cursorStateChange',
        detail: { visibility: false },
      }),
    ).toBe('cursorStateChange visibility=false')
  })

  it('прочие события — тип и элемент', () => {
    expect(
      describeInput({
        type: 'longpress',
        target: { tagName: 'BUTTON', className: 'card' },
      }),
    ).toBe('longpress button.card')
    expect(describeInput({ type: 'blur' })).toBe('blur')
  })
})

describe('createTapCounter', () => {
  it('срабатывает на пятом нажатии подряд и начинает заново', () => {
    const tap = createTapCounter(5, 2000)

    expect([1, 2, 3, 4].map(at => tap(true, at * 100))).toEqual([
      false,
      false,
      false,
      false,
    ])
    expect(tap(true, 500)).toBe(true)
    expect(tap(true, 600)).toBe(false)
  })

  it('другая клавиша сбрасывает счёт', () => {
    const tap = createTapCounter(3, 2000)

    tap(true, 0)
    tap(true, 100)
    tap(false, 200)

    expect(tap(true, 300)).toBe(false)
  })

  it('нажатия старше окна не считаются', () => {
    const tap = createTapCounter(3, 1000)

    tap(true, 0)
    tap(true, 100)

    expect(tap(true, 1500)).toBe(false)
  })
})
