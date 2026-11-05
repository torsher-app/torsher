import { describe, expect, it } from 'vitest'
import {
  episodeActions,
  initialSeason,
  markedEpisode,
} from './episodeActions.ts'
import { isHold } from '../focus/longPress.ts'

describe('initial season', () => {
  const seasons = [{ number: 1 }, { number: 2 }]
  it('uses resume when available, otherwise the first catalog season', () => {
    expect(initialSeason(seasons, 2)).toBe(2)
    expect(initialSeason(seasons, 9)).toBe(1)
    expect(initialSeason(seasons, null)).toBe(1)
    expect(initialSeason([], 2)).toBeUndefined()
    expect(initialSeason([{ number: 0 }, ...seasons], 0)).toBe(0)
  })
})

describe('episode playback actions', () => {
  it('keeps watched separate from actual position, including a rewatch', () => {
    expect(episodeActions()).toEqual({
      resume: false,
      fromStart: false,
      watched: false,
    })
    expect(
      episodeActions({ watched: true, position: 300, duration: 1800 }),
    ).toEqual({ resume: true, fromStart: true, watched: true })
    const marked = markedEpisode(
      { season: 2, episode: 6, position: 300, duration: 1800, watched: false },
      true,
    )
    expect(episodeActions(marked)).toEqual({
      resume: false,
      fromStart: false,
      watched: true,
    })
  })
  it.each([
    [29, null, false],
    [30, null, true],
    [89, 1800, false],
    [90, 1800, true],
    [1620, 1800, true],
    [1621, 1800, false],
    [60, 120, false],
  ] as const)(
    'resume at %s of %s follows server thresholds',
    (position, duration, expected) => {
      expect(
        episodeActions({ position, duration, watched: false }).resume,
      ).toBe(expected)
      expect(
        episodeActions({ position, duration, watched: false }).fromStart,
      ).toBe(true)
    },
  )
  it('only actual holding toggles the mark; Menu and right click open actions', () => {
    for (const source of ['hold', 'menu', 'contextmenu']) {
      expect(isHold(new CustomEvent('longpress', { detail: { source } }))).toBe(
        source === 'hold',
      )
    }
  })
})
