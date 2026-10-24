import { describe, expect, it } from 'vitest'
import {
  LOADER_DELAY_MS,
  LOADER_MIN_VISIBLE_MS,
  loaderHoldMs,
  STAGE_MIN_VISIBLE_MS,
} from './loader.ts'

describe('loaderHoldMs', () => {
  it('drops a loader that never showed up', () => {
    expect(loaderHoldMs(0, 120)).toBe(0)
    expect(loaderHoldMs(0, LOADER_DELAY_MS)).toBe(0)
  })

  it('drops a loader that only started to fade in', () => {
    expect(loaderHoldMs(0, LOADER_DELAY_MS + 40)).toBe(0)
  })

  it('keeps a loader that just appeared for the minimum time', () => {
    expect(loaderHoldMs(1000, 1000 + LOADER_DELAY_MS + 100)).toBe(
      LOADER_MIN_VISIBLE_MS - 100,
    )
  })

  it('lets a loader that was visible long enough go at once', () => {
    expect(loaderHoldMs(0, 3000)).toBe(0)
  })
})

describe('loaderHoldMs on the player stage', () => {
  const stage = { minVisible: STAGE_MIN_VISIBLE_MS }

  it('skips the lamp on a fast start', () => {
    expect(loaderHoldMs(0, 300, stage)).toBe(0)
  })

  it('keeps a lamp that has just appeared for the stage minimum', () => {
    expect(loaderHoldMs(0, LOADER_DELAY_MS + 200, stage)).toBe(
      STAGE_MIN_VISIBLE_MS - 200,
    )
  })

  it('holds a lamp shown without delay from its first frame', () => {
    expect(loaderHoldMs(0, 30, { delay: 0, ...stage })).toBe(
      STAGE_MIN_VISIBLE_MS - 30,
    )
  })
})
