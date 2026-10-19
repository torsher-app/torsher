import type { Rect } from './geometry.ts'
import { describe, expect, it } from 'vitest'
import { findNext } from './geometry.ts'

function rect(left: number, top: number, width = 100, height = 100): Rect {
  return { left, top, right: left + width, bottom: top + height }
}

// Сетка 3×2 с шагом 150: a b c / d e f
const grid = [
  { item: 'a', rect: rect(0, 0) },
  { item: 'b', rect: rect(150, 0) },
  { item: 'c', rect: rect(300, 0) },
  { item: 'd', rect: rect(0, 150) },
  { item: 'e', rect: rect(150, 150) },
  { item: 'f', rect: rect(300, 150) },
]

function from(item: string) {
  return grid.find(c => c.item === item)!.rect
}

function others(item: string) {
  return grid.filter(c => c.item !== item)
}

describe('findNext', () => {
  it('идёт к ближайшему соседу в ряду', () => {
    expect(findNext(from('a'), others('a'), 'right')).toBe('b')
    expect(findNext(from('c'), others('c'), 'left')).toBe('b')
  })

  it('идёт в соседний ряд по той же колонке', () => {
    expect(findNext(from('b'), others('b'), 'down')).toBe('e')
    expect(findNext(from('f'), others('f'), 'up')).toBe('c')
  })

  it('не уходит в соседний ряд, пока в своём есть элементы', () => {
    const shifted = [
      { item: 'near-other-row', rect: rect(110, 110) },
      { item: 'far-same-row', rect: rect(400, 0) },
    ]

    expect(findNext(rect(0, 0), shifted, 'right')).toBe('far-same-row')
  })

  it('возвращает undefined на краю', () => {
    expect(findNext(from('c'), others('c'), 'right')).toBeUndefined()
    expect(findNext(from('a'), others('a'), 'up')).toBeUndefined()
  })

  it('с широкого элемента вниз выбирает ближайший по центру', () => {
    const input = rect(0, 0, 450, 60)
    const row = [
      { item: 'left', rect: rect(0, 100) },
      { item: 'middle', rect: rect(175, 100) },
      { item: 'right', rect: rect(350, 100) },
    ]

    expect(findNext(input, row, 'down')).toBe('middle')
  })
})
