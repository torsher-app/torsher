import type { SourceCandidate, TitleSources } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import {
  allIndexersFailed,
  arrangeCandidates,
  bitrateOf,
  coverageLabel,
  formatBitrate,
  formatSize,
  hdrLabels,
  isQuality,
  leechersOf,
  minutesSince,
  qualityOptions,
  resolutionBadge,
  seasonOptions,
  sourceKindOf,
  titleRefOf,
} from './sources.ts'

function candidate(
  id: string,
  extra: Partial<SourceCandidate> = {},
): SourceCandidate {
  const voice
    = extra.voice === undefined
      ? { studio: 'LostFilm', type: 'MVO' as const }
      : extra.voice
  const quality = extra.quality === undefined ? '1080p' : extra.quality

  return {
    id,
    title: `Release ${id}`,
    indexers: ['Indexer A'],
    size: 1000,
    episodeSize: null,
    seeders: 10,
    peers: null,
    quality,
    // Как на сервере для разрешения из названия
    resolution: quality
      ? {
          value: quality === '2160p' || quality === '720p' ? quality : '1080p',
          basis: 'title',
          sure: true,
        }
      : null,
    source: 'WEB-DL',
    codec: null,
    hdr: [],
    audio: [],
    channels: null,
    subs: [],
    voice,
    // Как на сервере: основная дорожка среди ключей озвучек раздачи
    voiceKeys: voice
      ? [voice.studio ? `studio:${voice.studio}` : `type:${voice.type}`]
      : [],
    seasons: [1],
    episodes: null,
    isPack: true,
    confidence: 'high',
    pickReason: null,
    publishedAt: null,
    lastWatched: false,
    ...extra,
  }
}

const sources: TitleSources = {
  season: 1,
  episode: 1,
  updatedAt: '2026-10-21T10:00:00Z',
  profile: { qualities: ['1080p', '2160p', '720p'], voiceTypes: ['D'] },
  pinnedVoice: null,
  seasonCandidate: null,
  query: { current: null, suggestions: [] },
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

describe('arrangeCandidates', () => {
  const ids = (list: SourceCandidate[]) => list.map(item => item.id)

  it('порядок сервера и фильтры озвучки и качества', () => {
    expect(
      ids(arrangeCandidates(sources.candidates, { sort: 'best' })),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(
      ids(
        arrangeCandidates(sources.candidates, {
          sort: 'best',
          voice: 'type:D',
        }),
      ),
    ).toEqual(['c', 'e', 'f'])
    expect(
      ids(
        arrangeCandidates(sources.candidates, {
          sort: 'best',
          quality: '720p',
        }),
      ),
    ).toEqual(['c', 'd'])
  })

  it('по сезонам: свежий сезон и больше серий выше, дальше по сидам', () => {
    const list = [
      candidate('s1', { seasons: [1], seeders: 90 }),
      candidate('s2part', {
        seasons: [2],
        episodes: { from: 1, to: 4 },
        seeders: 5,
      }),
      candidate('s2full', {
        seasons: [2],
        episodes: { from: 1, to: 8 },
        seeders: 1,
      }),
    ]

    expect(ids(arrangeCandidates(list, { sort: 'seasons' }))).toEqual([
      's2full',
      's2part',
      's1',
    ])
    expect(
      ids(arrangeCandidates(list, { sort: 'seasons', season: 1 })),
    ).toEqual(['s1'])
    expect(seasonOptions(list)).toEqual([1, 2])
  })

  it('по размеру — весь размер раздачи, как на плашке', () => {
    const list = [
      candidate('season', { size: 10 * 1024 ** 3, episodeSize: 1024 ** 3 }),
      candidate('movie', { size: 4 * 1024 ** 3, episodeSize: null }),
    ]

    expect(ids(arrangeCandidates(list, { sort: 'size' }))).toEqual([
      'season',
      'movie',
    ])
  })

  it('раздача последнего просмотра — первой', () => {
    const list = [
      candidate('x', { seeders: 50 }),
      candidate('y', { seeders: 5, lastWatched: true }),
      candidate('z', { seeders: 9 }),
    ]

    expect(ids(arrangeCandidates(list, { sort: 'seeders' }))).toEqual([
      'y',
      'x',
      'z',
    ])
  })

  it('раздача с несколькими озвучками есть в фильтре каждой', () => {
    const multi = candidate('m', {
      voice: { type: 'D' },
      voiceKeys: ['type:D', 'type:L'],
    })

    expect(
      ids(
        arrangeCandidates([...sources.candidates, multi], {
          sort: 'best',
          voice: 'type:L',
        }),
      ),
    ).toEqual(['m'])
  })
})

describe('подписи', () => {
  it('качества по убыванию', () => {
    expect(qualityOptions(sources.candidates)).toEqual([
      '2160p',
      '1080p',
      '720p',
    ])
  })

  it('выведенное разрешение — в своём классе, неизвестное — «не указано»', () => {
    const list = [
      candidate('rip', {
        quality: null,
        source: 'BDRip',
        resolution: { value: 'SD', basis: 'source', sure: false },
      }),
      candidate('web', { quality: null, resolution: null }),
      candidate('hd'),
    ]

    expect(qualityOptions(list)).toEqual(['1080p', 'SD', 'unknown'])
    expect(
      arrangeCandidates(list, { sort: 'best', quality: 'SD' }).map(
        item => item.id,
      ),
    ).toEqual(['rip'])
    expect(
      arrangeCandidates(list, { sort: 'best', quality: 'unknown' }).map(
        item => item.id,
      ),
    ).toEqual(['web'])
  })

  it('старое значение фильтра из хранилища — не качество', () => {
    expect(isQuality('SD')).toBe(true)
    expect(isQuality('unknown')).toBe(true)
    expect(isQuality('1080i')).toBe(false)
    expect(isQuality('480p')).toBe(false)
  })

  it('бейдж разрешения', () => {
    expect(
      resolutionBadge({ value: '2160p', basis: 'title', sure: true }),
    ).toBe('4K')
    expect(resolutionBadge({ value: 'SD', basis: 'source', sure: false })).toBe(
      'SD?',
    )
    expect(resolutionBadge(null)).toBe('?')
  })

  it('источник понятным словом, HDRip без бейджа', () => {
    expect(sourceKindOf('BDRemux')).toBe('remux')
    expect(sourceKindOf('BDRip')).toBe('bluray')
    expect(sourceKindOf('WEB-DLRip')).toBe('web')
    expect(sourceKindOf('SATRip')).toBe('tv')
    expect(sourceKindOf('TS')).toBe('cam')
    expect(sourceKindOf('HDRip')).toBeUndefined()
    expect(sourceKindOf(null)).toBeUndefined()
  })

  it('dolby Vision первым и полным названием', () => {
    expect(hdrLabels(['HDR10', 'DV'])).toEqual(['Dolby Vision', 'HDR'])
    expect(hdrLabels(['HDR10+', 'HLG'])).toEqual(['HDR10+', 'HLG'])
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

  it('все индексаторы не ответили — отдельный случай пустого списка', () => {
    const failed = { name: 'Indexer A', kind: 'timeout' as const }

    expect(allIndexersFailed(sources)).toBe(false)
    expect(
      allIndexersFailed({
        ...sources,
        indexers: { total: 1, failed: [failed] },
      }),
    ).toBe(true)
    expect(
      allIndexersFailed({
        ...sources,
        indexers: { total: 2, failed: [failed] },
      }),
    ).toBe(false)
    expect(
      allIndexersFailed({ ...sources, indexers: { total: 0, failed: [] } }),
    ).toBe(false)
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

describe('строка раздачи', () => {
  it('покрытие: диапазон, одна серия, пак без диапазона, несколько сезонов, фильм', () => {
    expect(coverageLabel({ seasons: [1], episodes: { from: 1, to: 8 } })).toBe(
      'S1 · 1–8',
    )
    expect(coverageLabel({ seasons: [2], episodes: { from: 5, to: 5 } })).toBe(
      'S2 · E5',
    )
    expect(coverageLabel({ seasons: [1], episodes: null })).toBe('S1')
    expect(coverageLabel({ seasons: [3, 1, 2], episodes: null })).toBe('S1–3')
    expect(coverageLabel({ seasons: [], episodes: null })).toBe('')
  })

  it('битрейт по размеру на серию и длительности', () => {
    // 1,8 ГБ за 52 мин ≈ 5 Мбит/с
    expect(bitrateOf({ episodeSize: 1.8 * 1024 ** 3 }, 52)).toBeCloseTo(
      4.96,
      1,
    )
    expect(bitrateOf({ episodeSize: null }, 52)).toBeUndefined()
    expect(bitrateOf({ episodeSize: 1024 ** 3 }, undefined)).toBeUndefined()
    expect(formatBitrate(4.96, 'ru_RU')).toBe('5,0')
    expect(formatBitrate(37.25, 'ru_RU')).toBe('37')
  })

  it('качают: пиры без сидов, без пиров или с перекосом — ничего', () => {
    expect(leechersOf({ peers: 70, seeders: 58 })).toBe(12)
    expect(leechersOf({ peers: null, seeders: 58 })).toBeUndefined()
    expect(leechersOf({ peers: 10, seeders: 58 })).toBeUndefined()
  })
})
