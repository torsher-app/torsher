import { describe, expect, it } from 'vitest'
import { captionShift, collapsedAt, fitLevel, lastStep } from './rowFit.ts'

describe('fitLevel', () => {
  it('ряд влез сразу — сжатия нет', () => {
    expect(fitLevel(() => true, lastStep(3))).toBe(0)
  })

  it('берёт первую ступень, на которой ряд влез', () => {
    const tried: number[] = []

    expect(
      fitLevel((step) => {
        tried.push(step)

        return step >= 2
      }, lastStep(3)),
    ).toBe(2)
    expect(tried).toEqual([0, 1, 2])
  })

  it('не влез ни на одной — последняя ступень, её не примеряет', () => {
    const tried: number[] = []

    expect(
      fitLevel((step) => {
        tried.push(step)

        return false
      }, lastStep(2)),
    ).toBe(5)
    expect(tried).toEqual([0, 1, 2, 3, 4])
  })
})

describe('collapsedAt', () => {
  it('на текстовых ступенях значков нет', () => {
    expect([0, 1, 2].map(step => collapsedAt(step, 4))).toEqual([0, 0, 0])
  })

  it('дальше — по одной кнопке за ступень, на последней все', () => {
    expect([3, 4, 5, 6, 7].map(step => collapsedAt(step, 4))).toEqual([
      1,
      2,
      3,
      4,
      4,
    ])
    expect(lastStep(4)).toBe(7)
  })

  it('без кнопок со значком сразу последняя ступень', () => {
    expect(lastStep(0)).toBe(3)
    expect(collapsedAt(3, 0)).toBe(0)
  })
})

describe('captionShift', () => {
  const bounds = { left: 100, width: 1000 }

  it('подпись помещается по центру — без сдвига', () => {
    expect(captionShift({ left: 500, width: 100 }, 300, bounds)).toBe(0)
  })

  it('у левого края окна сдвигает вправо', () => {
    // По центру подпись начиналась бы с 0
    expect(captionShift({ left: 100, width: 100 }, 300, bounds)).toBe(100)
  })

  it('у правого края окна сдвигает влево', () => {
    // По центру подпись кончалась бы на 1200
    expect(captionShift({ left: 1000, width: 100 }, 300, bounds)).toBe(-100)
  })

  it('подпись шире окна прижимает к левому краю', () => {
    expect(captionShift({ left: 500, width: 100 }, 1200, bounds)).toBe(150)
  })
})
