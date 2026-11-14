import { describe, expect, it } from 'vitest'
import { createSeries, p90 } from './series.ts'

describe('adaptive HTTP sample statistics', () => {
  it.each([
    [[1, 2, 3], 2.8],
    [[100, 200, 300, 400], 370],
    [[2, 2, 2], 2],
    [[1, 2, Number.NaN, Number.POSITIVE_INFINITY], null],
  ])('interpolates known p90 %j', (values, expected) => {
    expect(p90(values)).toBe(expected)
  })
  it('plans past small RTT-bound responses without ending the measurement', () => {
    const series = createSeries(64 * 1024 * 1024, 200)
    const sizes: number[] = []
    for (let i = 0; i < 20; i++) {
      const size = series.size
      sizes.push(size)
      series.observe(size, 200 + (size / 1_250_000_000) * 1000)
    }
    expect(sizes[1]).toBe(16 * 1024 * 8)
    expect(sizes).toContain(64 * 1024 * 1024)
    expect(series.value).toBeGreaterThan(0)
  })
  it('rejects sub10ms or incomplete singleton series', () => {
    const series = createSeries(67108864, 0)
    expect(series.observe(16384, 1).valid).toBe(false)
    series.observe(131072, 100)
    expect(series.value).toBeNull()
  })
})
