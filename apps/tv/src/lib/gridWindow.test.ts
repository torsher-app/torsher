import { describe, expect, it } from 'vitest'
import {
  anchorSpan,
  hasImages,
  needsMore,
  rowAt,
  rowsOf,
  windowOf,
} from './gridWindow.ts'

describe('rowsOf', () => {
  it('режет на строки, последняя может быть неполной', () => {
    expect(rowsOf([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ])
    expect(rowsOf([], 6)).toEqual([])
  })
})

describe('windowOf', () => {
  it('в начале — от первой строки', () => {
    expect(windowOf(0, 20)).toEqual({ start: 0, end: 5 })
  })

  it('в середине — две выше и четыре ниже', () => {
    expect(windowOf(10, 20)).toEqual({ start: 8, end: 15 })
  })

  it('в конце — до последней строки', () => {
    expect(windowOf(19, 20)).toEqual({ start: 17, end: 20 })
  })

  it('опорная за концом (строк стало меньше) — хвост сетки', () => {
    expect(windowOf(30, 4)).toEqual({ start: 3, end: 4 })
  })

  it('без строк — пусто', () => {
    expect(windowOf(0, 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('hasImages', () => {
  it('от одной выше до двух ниже опорной', () => {
    expect([3, 4, 5, 6, 7, 8].map(row => hasImages(row, 5))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ])
  })
})

describe('needsMore', () => {
  it('просит страницу, когда до конца меньше четырёх строк', () => {
    expect(needsMore(0, 4)).toBe(true)
    expect(needsMore(0, 5)).toBe(false)
    expect(needsMore(1, 5)).toBe(true)
  })
})

describe('rowAt', () => {
  it('верхняя видимая строка по прокрутке', () => {
    expect(rowAt(0, 400, 10)).toBe(0)
    expect(rowAt(799, 400, 10)).toBe(1)
    expect(rowAt(99999, 400, 10)).toBe(9)
    expect(rowAt(100, 0, 10)).toBe(0)
  })
})

describe('anchorSpan', () => {
  it('пока прокрутка идёт за фокусом — и верхняя видимая, и фокус', () => {
    expect(anchorSpan(0, 12, true)).toEqual({ first: 0, last: 12 })
    expect(anchorSpan(10, 7, true)).toEqual({ first: 7, last: 10 })
  })

  it('прокрутку увели колесом — только верхняя видимая', () => {
    expect(anchorSpan(40, 2, false)).toEqual({ first: 40, last: 40 })
  })
})
