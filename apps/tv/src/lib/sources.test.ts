import type {
  SourceCandidate,
  TitleSeason,
  TitleSources,
} from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import {
  bestCandidate,
  filteredCount,
  formatSize,
  minutesSince,
  qualityOptions,
  titleRefOf,
  visibleCandidates,
  voiceKeyOf,
  watchTarget,
} from './sources.ts'

function candidate(
  id: string,
  extra: Partial<SourceCandidate> = {},
): SourceCandidate {
  return {
    id,
    title: `Release ${id}`,
    indexers: ['Indexer A'],
    size: 1000,
    episodeSize: null,
    seeders: 10,
    peers: null,
    quality: '1080p',
    source: 'WEB-DL',
    codec: null,
    hdr: [],
    audio: [],
    voice: { studio: 'LostFilm', type: 'MVO' },
    seasons: [1],
    episodes: null,
    isPack: true,
    confidence: 'high',
    pickReason: null,
    publishedAt: null,
    ...extra,
  }
}

const sources: TitleSources = {
  season: 1,
  episode: 1,
  updatedAt: '2026-10-21T10:00:00Z',
  profile: { qualities: ['1080p', '2160p', '720p'], voiceTypes: ['D'] },
  pinnedVoice: null,
  top: ['b', 'a'],
  candidates: [
    candidate('a', { pickReason: 'bestQuality', quality: '2160p' }),
    candidate('b', { pickReason: 'profile' }),
    candidate('c', { voice: { type: 'D' }, quality: '720p' }),
    candidate('d', { voice: null, quality: '720p' }),
    candidate('e', { voice: { type: 'D' }, seeders: 0 }),
    candidate('f', { voice: { type: 'D' }, confidence: 'medium' }),
  ],
  voices: [],
  indexers: { total: 1, failed: [] },
}

describe('visibleCandidates', () => {
  it('без фильтров — тройка сервера по порядку', () => {
    expect(
      visibleCandidates(sources, {}, false).map(item => item.id),
    ).toEqual(['b', 'a'])
  })

  it('с фильтром — уверенные с сидами, не больше трёх', () => {
    expect(
      visibleCandidates(sources, { voice: 'type:D' }, false).map(
        item => item.id,
      ),
    ).toEqual(['c'])
    expect(
      visibleCandidates(sources, { quality: '720p' }, false).map(
        item => item.id,
      ),
    ).toEqual(['c', 'd'])
  })

  it('«Показать все» — всё с учётом фильтров', () => {
    expect(visibleCandidates(sources, {}, true)).toHaveLength(6)
    expect(
      visibleCandidates(sources, { voice: 'type:D' }, true).map(
        item => item.id,
      ),
    ).toEqual(['c', 'e', 'f'])
    expect(filteredCount(sources, { voice: 'type:D' })).toBe(3)
  })
})

describe('подписи', () => {
  it('ключ озвучки и качества по убыванию', () => {
    expect(voiceKeyOf({ studio: 'LostFilm', type: 'MVO' })).toBe(
      'studio:LostFilm',
    )
    expect(voiceKeyOf({ type: 'D' })).toBe('type:D')
    expect(qualityOptions(sources.candidates)).toEqual([
      '2160p',
      '1080p',
      '720p',
    ])
  })

  it('размер в гигабайтах и мегабайтах', () => {
    expect(formatSize(2.15 * 1024 ** 3, 'xx')).toEqual({
      amount: '2.1',
      unit: 'gb',
    })
    expect(formatSize(700 * 1024 ** 2, 'xx')).toEqual({
      amount: '700',
      unit: 'mb',
    })
  })

  it('минуты с поиска', () => {
    expect(
      minutesSince('2026-10-21T10:00:00Z', new Date('2026-10-21T10:12:40Z')),
    ).toBe(12)
    expect(minutesSince('bad', new Date())).toBe(0)
  })

  it('лучший кандидат — первый в тройке', () => {
    expect(bestCandidate(sources)?.id).toBe('b')
    expect(bestCandidate(undefined)).toBeUndefined()
  })
})

describe('watchTarget', () => {
  const seasons: TitleSeason[] = [
    { number: 1, name: 'Сезон 1', episodeCount: 8, airedEpisodeCount: 8 },
    { number: 2, name: 'Сезон 2', episodeCount: 8, airedEpisodeCount: 3 },
    { number: 3, name: 'Сезон 3', episodeCount: 8, airedEpisodeCount: 0 },
  ]

  function last(
    season: number,
    episode: number,
    position: number,
    watched = false,
  ) {
    return {
      season,
      episode,
      position,
      duration: 2700,
      watched,
      updatedAt: '',
    }
  }

  it('без прогресса — первая серия', () => {
    expect(watchTarget('series', seasons, null)).toEqual({
      season: 1,
      episode: 1,
      resume: false,
    })
  })

  it('начатая серия — продолжить', () => {
    expect(watchTarget('series', seasons, last(1, 4, 600))).toEqual({
      season: 1,
      episode: 4,
      resume: true,
      remaining: 2100,
    })
  })

  it('досмотренная — следующая, в конце сезона — следующий вышедший', () => {
    expect(
      watchTarget('series', seasons, last(1, 4, 2690, true)),
    ).toMatchObject({ season: 1, episode: 5 })
    expect(
      watchTarget('series', seasons, last(1, 8, 2690, true)),
    ).toMatchObject({ season: 2, episode: 1 })
    expect(
      watchTarget('series', seasons, last(2, 3, 2690, true)),
    ).toMatchObject({
      season: 2,
      episode: 3,
      resume: false,
    })
  })

  it('фильм: продолжить только начатый', () => {
    expect(
      watchTarget('movie', [], {
        ...last(0, 0, 900),
        season: null,
        episode: null,
      }),
    ).toEqual({
      resume: true,
      remaining: 1800,
    })
    expect(
      watchTarget('movie', [], {
        ...last(0, 0, 10),
        season: null,
        episode: null,
      }),
    ).toEqual({
      resume: false,
    })
  })
})

describe('titleRefOf', () => {
  it('контекст тайтла из query плеера', () => {
    expect(titleRefOf('tmdb:tv:1', '2', '5')).toEqual({
      id: 'tmdb:tv:1',
      season: 2,
      episode: 5,
    })
    expect(titleRefOf('tmdb:movie:1', undefined, 'x')).toEqual({
      id: 'tmdb:movie:1',
      season: undefined,
      episode: undefined,
    })
    expect(titleRefOf(undefined, '1', '1')).toBeUndefined()
  })
})
