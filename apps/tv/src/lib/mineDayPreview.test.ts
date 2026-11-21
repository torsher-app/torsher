import { describe, expect, it } from 'vitest'
import { dayPreviewRows } from './mineDayPreview.ts'

describe('dayPreviewRows', () => {
  it('uses the available height and reserves a short overflow line', () => {
    expect(dayPreviewRows(12, 566, 96, 48)).toBe(5)
  })

  it('does not reserve a caption when all entries fit, including the exact boundary', () => {
    expect(dayPreviewRows(5, 480, 96, 48)).toBe(5)
    expect(dayPreviewRows(6, 480, 96, 48)).toBe(4)
  })

  it('keeps the count at different display scales and fractional sizes', () => {
    for (const scale of [0.64, 1, 1.25, 2]) {
      expect(dayPreviewRows(10, 566 * scale, 96 * scale, 48 * scale)).toBe(5)
    }
  })

  it('fits fewer rows into a shorter panel', () => {
    expect(dayPreviewRows(10, 350, 96, 48)).toBe(3)
  })

  it('handles empty days and hidden panels', () => {
    expect(dayPreviewRows(0, 566, 96, 48)).toBe(0)
    expect(dayPreviewRows(12, 0, 0, 0)).toBe(0)
  })
})
