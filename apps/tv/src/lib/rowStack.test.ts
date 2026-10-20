import { describe, expect, it } from 'vitest'
import { firstVisibleRow, stackOffset } from './rowStack.ts'

// Ряды по 470 px, область рядов — 460 px
const tops = [0, 470, 940, 1410]
const height = 1880

describe('stackOffset', () => {
  it('ставит фокусный ряд наверх области', () => {
    expect(stackOffset(tops[1]!, height, 460)).toBe(470)
  })

  it('упирается: последний ряд не уезжает выше низа экрана', () => {
    expect(stackOffset(tops[3]!, height, 800)).toBe(1080)
  })

  it('короткая лента рядов не двигается', () => {
    expect(stackOffset(470, 900, 1000)).toBe(0)
  })
})

describe('firstVisibleRow', () => {
  it('гасит ряды выше смещения', () => {
    expect(firstVisibleRow(tops, 940)).toBe(2)
  })

  it('на упоре показывает ряды над фокусным', () => {
    expect(firstVisibleRow(tops, 1080)).toBe(3)
    expect(firstVisibleRow(tops, 900)).toBe(2)
  })

  it('ряд ровно на границе остаётся видимым', () => {
    expect(firstVisibleRow(tops, 470.4)).toBe(1)
  })
})
