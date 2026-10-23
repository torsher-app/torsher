import type { TitleState } from './index.ts'
import { describe, expect, it } from 'vitest'
import { nextAired, pickNewEpisodes } from './newEpisodes.ts'

const now = new Date('2026-10-23T12:00:00Z')

function state(
  overrides: Partial<TitleState> & { lastAirDate?: string },
): TitleState {
  const { lastAirDate = '2026-10-20', ...rest } = overrides

  return {
    titleId: 'tmdb:tv:1',
    kind: 'series',
    status: 'watching',
    lastAt: new Date('2026-10-10T20:00:00Z'),
    progress: [
      {
        season: 1,
        episode: 1,
        position: 1,
        duration: 1,
        updatedAt: new Date('2026-10-10T20:00:00Z'),
      },
      {
        season: 1,
        episode: 2,
        position: 1,
        duration: 1,
        updatedAt: new Date('2026-10-10T20:00:00Z'),
      },
    ],
    summary: {
      details: {
        id: 'tmdb:tv:1',
        kind: 'series',
        title: 'Сериал',
        originalTitle: 'Show',
        overview: '',
        genres: [],
        ratings: [],
        countries: [],
        studios: [],
        creators: [],
        seasons: [
          { number: 1, name: 'S1', episodeCount: 8, airedEpisodeCount: 4 },
        ],
      },
      airing: {
        last: { season: 1, episode: 4, airDate: lastAirDate },
        next: undefined,
      },
    },
    ...rest,
  }
}

describe('nextAired', () => {
  it('берёт серию после самой дальней просмотренной и считает вышедшие после неё', () => {
    const seasons = [
      { number: 1, airedEpisodeCount: 3 },
      { number: 2, airedEpisodeCount: 2 },
    ]

    expect(nextAired(seasons, new Set(['1:3']))).toEqual({
      season: 2,
      episode: 1,
      newCount: 2,
    })
    expect(nextAired(seasons, new Set(['2:2']))).toBeUndefined()
  })
})

describe('pickNewEpisodes', () => {
  it('отдаёт серию, вышедшую после последнего просмотра', () => {
    expect(pickNewEpisodes([state({})], now)).toMatchObject([
      { season: 1, episode: 3, newCount: 2, airDate: '2026-10-20' },
    ])
  })

  it('пропускает старые, будущие, брошенные и уже просмотренные', () => {
    expect(
      pickNewEpisodes([state({ lastAirDate: '2026-09-01' })], now),
    ).toEqual([])
    expect(
      pickNewEpisodes([state({ lastAirDate: '2026-10-30' })], now),
    ).toEqual([])
    expect(
      pickNewEpisodes([state({ lastAirDate: '2026-10-05' })], now),
    ).toEqual([])
    expect(pickNewEpisodes([state({ status: 'dropped' })], now)).toEqual([])
    expect(pickNewEpisodes([state({ status: 'watched' })], now)).toEqual([])
  })
})
