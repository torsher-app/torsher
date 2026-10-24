import { describe, expect, it } from 'vitest'
import { misaligned, railAxisOffsets } from './railAxis.ts'

interface FakeBox {
  left: number
  top: number
  width: number
  height: number
}

interface FakeNode {
  textContent: string
  getBoundingClientRect: () => FakeBox
  querySelector: (selector: string) => FakeNode | null
}

function node(box: FakeBox, children: Record<string, FakeNode> = {}, text = ''): FakeNode {
  return {
    textContent: text,
    getBoundingClientRect: () => box,
    querySelector: (selector: string) =>
      selector.split(', ').map(part => children[part]).find(Boolean) ?? null,
  }
}

// Пункт 64×64 от x = 28, иконка 32 с отступом `pad`
function item(top: number, pad: number, text: string, size = 64) {
  return node(
    { left: 28, top, width: size, height: 64 },
    { '.icon': node({ left: 28 + pad, top: top + 16, width: 32, height: 32 }) },
    text,
  )
}

function rail(items: FakeNode[], brandPad?: number) {
  const brand
    = brandPad === undefined
      ? null
      : node(
          { left: 28, top: 0, width: 92, height: 64 },
          { '.icon': node({ left: 28 + brandPad, top: 12, width: 40, height: 40 }) },
        )

  return {
    querySelector: (selector: string) =>
      selector === '.rail__brand' ? brand : null,
    querySelectorAll: () => items,
  }
}

describe('railAxisOffsets', () => {
  it('finds no offset when marks sit in the middle of their circles', () => {
    const offsets = railAxisOffsets(
      rail([item(100, 16, 'Search'), item(174, 16, 'Home')], 12),
      1,
    )

    expect(offsets).toEqual([
      { name: 'brand', dx: 0, dy: 0, column: 0 },
      { name: 'Search', dx: 0, dy: 0, column: 0 },
      { name: 'Home', dx: 0, dy: 0, column: 0 },
    ])
    expect(misaligned(offsets)).toEqual([])
  })

  it('reports an icon padded past the middle of a 64 px circle', () => {
    const offsets = railAxisOffsets(rail([item(100, 18, 'Home')], 16), 1)

    expect(misaligned(offsets)).toEqual([
      { name: 'brand', dx: 4, dy: 0, column: 0 },
      { name: 'Home', dx: 2, dy: 0, column: 0 },
    ])
  })

  it('measures an open item against its rounded left end', () => {
    const offsets = railAxisOffsets(rail([item(100, 16, 'Home', 340)]), 1)

    expect(misaligned(offsets)).toEqual([])
  })

  it('converts screen pixels to layout pixels', () => {
    const offsets = railAxisOffsets(rail([item(100, 18, 'Home')]), 0.5)

    expect(offsets[0]?.dx).toBe(4)
  })
})
