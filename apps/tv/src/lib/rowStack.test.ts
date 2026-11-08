import { describe, expect, it } from 'vitest'
import { firstVisibleRow, lastRowPadding, stackOffset } from './rowStack.ts'

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

// Высота ряда не включает нижний margin. Оба контейнера включают его
// вместе с padding: scrollHeight нативного окна и offsetHeight ТВ.
function measureStack(
  rowHeights: number[],
  viewHeight: number,
  marginBottom: number,
) {
  let extent = 0
  const rowTops = rowHeights.map((rowHeight) => {
    const top = extent
    extent += rowHeight + marginBottom
    return top
  })
  const lastHeight = rowHeights[rowHeights.length - 1]
  const padding
    = lastHeight === undefined
      ? 0
      : lastRowPadding(viewHeight, lastHeight, marginBottom)
  const contentHeight = extent + padding

  return { rowTops, padding, contentHeight }
}

describe('compact home row alignment', () => {
  it.each([1, 2])(
    'puts the last and penultimate rows at the same top anchor at %sx scale',
    (scale) => {
      const viewHeight = 660 * scale
      const margin = 52 * scale
      const { rowTops, padding, contentHeight } = measureStack(
        [398, 398, 500].map(height => height * scale),
        viewHeight,
        margin,
      )
      const lastTop = rowTops[2]!

      expect(stackOffset(lastTop, contentHeight - padding, viewHeight)).toBe(
        792 * scale,
      )
      expect(padding).toBe(108 * scale)
      expect(stackOffset(lastTop, contentHeight, viewHeight)).toBe(900 * scale)
      expect(stackOffset(rowTops[1]!, contentHeight, viewHeight)).toBe(
        rowTops[1],
      )
      expect(firstVisibleRow(rowTops, lastTop)).toBe(2)
    },
  )

  it.each([
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
    { width: 1280, height: 900 },
    { width: 2560, height: 1080 },
    { width: 1024, height: 1200 },
    { width: 1920, height: 720 },
  ])(
    'uses the available window at $width × $height in native and TV layouts',
    ({ width, height }) => {
      const scale = width / 1920
      const containerTop = 420 * scale
      const clientHeight = height - containerTop
      const { rowTops, contentHeight } = measureStack(
        [360, 500, 360].map(height => height * scale),
        clientHeight,
        52 * scale,
      )
      const lastTop = rowTops[2]!
      // Нативное окно сохраняет свою высоту даже с коротким содержимым.
      const scrollHeight = Math.max(clientHeight, contentHeight)
      const nativeOffset = stackOffset(lastTop, scrollHeight, clientHeight)
      const tvOffset = stackOffset(
        lastTop,
        contentHeight,
        height - containerTop,
      )

      expect(nativeOffset).toBeCloseTo(lastTop)
      expect(tvOffset).toBeCloseTo(lastTop)
      expect(scrollHeight - clientHeight).toBeGreaterThanOrEqual(
        lastTop - 0.001,
      )
    },
  )

  it('keeps a single row at the top and an empty stack unpadded', () => {
    const single = measureStack([500], 660, 52)
    expect(single.padding).toBe(108)
    expect(stackOffset(0, single.contentHeight, 660)).toBe(0)
    const empty = measureStack([], 660, 52)
    expect(empty.padding).toBe(0)
    expect(stackOffset(0, empty.contentHeight, 660)).toBe(0)
  })

  it('does not add space when the last row already fills the viewport', () => {
    for (const height of [608, 660, 800]) {
      const measured = measureStack([398, height], 660, 52)
      expect(measured.padding).toBe(0)
      expect(
        stackOffset(measured.rowTops[1]!, measured.contentHeight, 660),
      ).toBe(measured.rowTops[1])
    }
  })

  it('replaces the trailing space after a row change, deletion or resize without accumulating it', () => {
    const first = measureStack([398, 500], 660, 52)
    expect(first.padding).toBe(108)
    expect(measureStack([398, 500], 660, 52)).toEqual(first)
    expect(measureStack([398, 360], 660, 52).padding).toBe(248)
    expect(measureStack([398], 660, 52).padding).toBe(210)
    expect(measureStack([398], 900, 52).padding).toBe(450)
    expect(measureStack([], 900, 52).padding).toBe(0)
  })

  it('keeps the existing end clamp when a mode does not opt into trailing space', () => {
    expect(stackOffset(900, 900 + 500 + 52, 660)).toBe(792)
  })
})
