import type { SeriesSchedule } from './wanted.ts'
import { describe, expect, it } from 'vitest'
import {
  episodeStates,
  firstUnaired,
  localDay,
  scheduledEpisodes,
  wantedEpisodes,
} from './wanted.ts'

// Идёт второй сезон: вышли 4 серии из 10, пятая анонсирована
const airing: SeriesSchedule = {
  seasons: [
    { number: 1, episodeCount: 8, airedEpisodeCount: 8 },
    { number: 2, episodeCount: 10, airedEpisodeCount: 4 },
  ],
  last: { season: 2, episode: 4 },
  next: { season: 2, episode: 5 },
}

// Второй сезон вышел целиком, третьего ещё нет
const between: SeriesSchedule = {
  seasons: [
    { number: 1, episodeCount: 8, airedEpisodeCount: 8 },
    { number: 2, episodeCount: 10, airedEpisodeCount: 10 },
  ],
  last: { season: 2, episode: 10 },
}

describe('firstUnaired', () => {
  it('сезон идёт — анонсированная серия', () => {
    expect(firstUnaired(airing)).toEqual({ season: 2, episode: 5 })
  })

  it('сезон идёт без анонса следующей серии — по числу вышедших', () => {
    expect(firstUnaired({ ...airing, next: undefined })).toEqual({
      season: 2,
      episode: 5,
    })
  })

  it('сезон вышел целиком — первая серия следующего', () => {
    expect(firstUnaired(between)).toEqual({ season: 3, episode: 1 })
  })

  it('сериал ещё не вышел — первая серия', () => {
    const announced = {
      seasons: [{ number: 1, episodeCount: 6, airedEpisodeCount: 0 }],
    }

    expect(firstUnaired(announced)).toEqual({ season: 1, episode: 1 })
  })
})

describe('scheduledEpisodes', () => {
  const loaded = new Map([
    [
      2,
      [
        { number: 4, airDate: '2026-10-24' },
        { number: 5, airDate: '2026-10-25' },
        { number: 6, airDate: '2026-11-01' },
        { number: 7 },
      ],
    ],
  ])

  it('вышла — по дате в поясе сервера; без загруженного сезона — по деталям', () => {
    const episodes = scheduledEpisodes(
      airing,
      loaded,
      { season: 1, episode: 7 },
      '2026-10-25',
    )

    expect(
      episodes.map(item => [item.season, item.episode, item.aired]),
    ).toEqual([
      [1, 7, true],
      [1, 8, true],
      [2, 4, true],
      [2, 5, true],
      [2, 6, false],
      [2, 7, false],
    ])
  })

  it('дата сервера — местная, а не UTC', () => {
    const late = new Date(2026, 9, 25, 23, 30)

    expect(localDay(late)).toBe('2026-10-25')
  })
})

describe('episodeStates', () => {
  const episodes = [1, 2, 3, 4, 5, 6].map(episode => ({
    season: 2,
    episode,
    aired: episode <= 4,
  }))

  it('серии до курсора не нужны, библиотека и закачка — не нужные', () => {
    const states = episodeStates({
      cursor: { season: 2, episode: 2 },
      episodes,
      library: new Set(['2:2']),
      downloading: new Set(['2:3']),
    })

    expect(states.map(item => [item.episode, item.state])).toEqual([
      [2, 'in_library'],
      [3, 'downloading'],
      [4, 'searching'],
      [5, 'upcoming'],
      [6, 'upcoming'],
    ])
    expect(wantedEpisodes(states).map(item => item.episode)).toEqual([4])
  })

  it('невышедшая серия в библиотеке — в библиотеке', () => {
    const states = episodeStates({
      cursor: { season: 2, episode: 5 },
      episodes,
      library: new Set(['2:5']),
      downloading: new Set(),
    })

    expect(states.map(item => item.state)).toEqual([
      'in_library',
      'upcoming',
    ])
  })

  it('выбранная серия «готова» и не нужна; библиотека сильнее выбора', () => {
    const states = episodeStates({
      cursor: { season: 2, episode: 2 },
      episodes,
      library: new Set(['2:2']),
      downloading: new Set(),
      facts: {
        seen: new Set(['2:2', '2:3']),
        grabbing: new Set(),
        picked: new Set(['2:2', '2:3']),
        noSpace: new Set(),
        waitUntil: new Map(),
      },
    })

    expect(states.slice(0, 3).map(item => item.state)).toEqual([
      'in_library',
      'ready',
      'searching',
    ])
    expect(wantedEpisodes(states).map(item => item.episode)).toEqual([4])
  })
})
