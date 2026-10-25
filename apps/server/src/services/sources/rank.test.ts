import type { TitleMatch } from '@torsher/release-parser'
import type { FoundRelease, RankContext } from './rank.ts'
import { parseRelease } from '@torsher/release-parser'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE } from './profile.ts'
import { coversEpisode, rankReleases, russianVoices, voiceOf } from './rank.ts'

const GB = 1024 ** 3
const high: TitleMatch = { confidence: 'high', issues: [] }

function release(
  id: string,
  title: string,
  seeders: number,
  size: number,
  extra: Partial<FoundRelease> = {},
): FoundRelease {
  return {
    id,
    title,
    indexers: [{ id: 'ix', name: 'Indexer A' }],
    seeders,
    size,
    parsed: parseRelease(title),
    match: high,
    ...extra,
  }
}

const series: RankContext = { kind: 'series', profile: DEFAULT_PROFILE }
const movie: RankContext = { kind: 'movie', profile: DEFAULT_PROFILE }

describe('rankReleases', () => {
  it('лестница качества: 1080p выше 2160p и 720p', () => {
    const { top, ranked } = rankReleases(
      [
        release('a', 'Фонарь (2021) WEB-DL 720p | D', 40, 4 * GB),
        release('b', 'Фонарь (2021) WEB-DL 2160p | D', 40, 20 * GB),
        release('c', 'Фонарь (2021) WEB-DL 1080p | D', 40, 8 * GB),
      ],
      movie,
    )

    expect(ranked.map(item => item.id)).toEqual(['c', 'b', 'a'])
    expect(top[0]).toBe('c')
  })

  it('закреплённая озвучка сильнее профиля и даёт причину', () => {
    const { top, ranked } = rankReleases(
      [
        release(
          'lost',
          'Гавань / Сезон: 2 / Серии: 1-8 из 8 (2024) WEB-DL 720p | LostFilm',
          20,
          4 * GB,
        ),
        release(
          'dub',
          'Гавань / Сезон: 2 / Серии: 1-8 из 8 (2024) WEB-DL 1080p | D',
          20,
          8 * GB,
        ),
      ],
      { ...series, pinned: { studio: 'LostFilm' } },
    )

    expect(top[0]).toBe('lost')
    expect(ranked[0]!.reason).toBe('pinnedVoice')
  })

  it('без сидов, экранная копия и средний матч в тройку не идут', () => {
    const { top } = rankReleases(
      [
        release('dead', 'Фонарь (2021) WEB-DL 1080p | D', 0, 8 * GB),
        release('cam', 'Фонарь (2021) CAMRip 1080p | D', 90, 2 * GB),
        release('medium', 'Фонарь (2021) WEB-DL 1080p | D', 90, 8 * GB, {
          match: { confidence: 'medium', issues: ['year'] },
        }),
        release('ok', 'Фонарь (2021) WEB-DL 720p | MVO', 5, 3 * GB),
      ],
      movie,
    )

    expect(top).toEqual(['ok'])
  })

  it('без русской дорожки — только если других нет', () => {
    const mixed = rankReleases(
      [
        release('eng', 'Lantern.2021.1080p.WEB-DL-GRP', 300, 8 * GB),
        release('rus', 'Фонарь (2021) WEB-DL 720p | MVO', 5, 3 * GB),
      ],
      movie,
    )

    expect(mixed.top).toEqual(['rus'])

    const only = rankReleases(
      [release('eng', 'Lantern.2021.1080p.WEB-DL-GRP', 300, 8 * GB)],
      movie,
    )

    expect(only.top).toEqual(['eng'])
  })

  it('закреплённая студия второй дорожкой делает её основной', () => {
    const { ranked, top } = rankReleases(
      [
        release(
          'both',
          'Гавань / Сезон: 2 / Серии: 1-8 из 8 (2024) WEB-DL 720p | MVO (NewStudio, LostFilm)',
          20,
          4 * GB,
        ),
        release(
          'dub',
          'Гавань / Сезон: 2 / Серии: 1-8 из 8 (2024) WEB-DL 1080p | D',
          20,
          8 * GB,
        ),
      ],
      { ...series, pinned: { studio: 'LostFilm' } },
    )

    expect(top[0]).toBe('both')
    expect(ranked[0]!.voice).toEqual({ type: 'MVO', studio: 'LostFilm' })
    expect(ranked[0]!.reason).toBe('pinnedVoice')
  })

  it('пак сезона без диапазона: размер на серию по числу серий из TMDB', () => {
    const pack = release(
      'pack',
      'Гавань [S01] (2023) WEB-DL 1080p | P',
      20,
      8 * GB,
    )
    const withCount = rankReleases([pack], {
      ...series,
      episodeCounts: { 1: 8 },
    })
    const withoutCount = rankReleases([pack], series)

    expect(withCount.ranked[0]!.episodeSize).toBe(GB)
    expect(withoutCount.ranked[0]!.episodeSize).toBeUndefined()
  })

  it('пак нескольких сезонов: серии всех его сезонов, а без одного из них — не узнать', () => {
    const pack = release(
      'pack',
      'Гавань [S01-03] (2023) WEB-DL 1080p | P',
      20,
      30 * GB,
    )
    const counts = rankReleases([pack], {
      ...series,
      episodeCounts: { 1: 8, 2: 10, 3: 12 },
    })
    const partial = rankReleases([pack], {
      ...series,
      episodeCounts: { 1: 8, 2: 10 },
    })

    expect(counts.ranked[0]!.episodeSize).toBe(GB)
    expect(partial.ranked[0]!.episodeSize).toBeUndefined()
  })

  it('русский оригинал: раздача без дорожек в названии — оригинал, а не «без озвучки»', () => {
    const releases = [
      release('plain', 'Гавань [S01] (2023) WEB-DL 1080p', 20, 8 * GB),
      release('ukr', 'Гавань [S01] (2023) WEB-DL 1080p | Ukr', 20, 8 * GB),
    ]
    const russian = rankReleases(releases, {
      ...series,
      originalLanguage: 'ru',
    })

    expect(russian.top).toEqual(['plain'])
    expect(russian.ranked.find(item => item.id === 'plain')!.voice).toEqual({
      type: 'Original',
      language: 'ru',
    })
    // Указана чужая дорожка — это не русский оригинал
    expect(
      russian.ranked.find(item => item.id === 'ukr')!.voice,
    ).toBeUndefined()

    const foreign = rankReleases(releases, {
      ...series,
      originalLanguage: 'en',
    })

    expect(foreign.ranked.every(item => !item.voice)).toBe(true)
  })

  it('тройка: по профилю, лучшее качество, меньше размер', () => {
    const { ranked, top } = rankReleases(
      [
        release('best', 'Фонарь (2021) WEB-DL 1080p | D', 60, 12 * GB),
        release('uhd', 'Фонарь (2021) WEB-DL 2160p HDR | D', 15, 40 * GB),
        release('light', 'Фонарь (2021) WEB-DLRip 1080p | D', 20, 3 * GB),
        release('other', 'Фонарь (2021) BDRip 1080p | MVO', 30, 10 * GB),
      ],
      movie,
    )
    const reasons = Object.fromEntries(
      ranked.map(item => [item.id, item.reason]),
    )

    expect(top).toEqual(['best', 'uhd', 'light'])
    expect(reasons).toEqual({
      best: 'profile',
      uhd: 'bestQuality',
      light: 'smaller',
      other: undefined,
    })
  })

  it('без различий тройка добирается по счёту без причины', () => {
    const { ranked, top } = rankReleases(
      [
        release('a', 'Фонарь (2021) WEB-DL 1080p | D', 50, 8 * GB),
        release('b', 'Фонарь (2021) WEB-DL 1080p | D', 40, 8 * GB),
        release('c', 'Фонарь (2021) WEB-DL 1080p | D', 30, 8 * GB),
        release('d', 'Фонарь (2021) WEB-DL 1080p | D', 20, 8 * GB),
      ],
      movie,
    )

    expect(top).toEqual(['a', 'b', 'c'])
    expect(ranked.map(item => item.reason)).toEqual([
      'profile',
      undefined,
      undefined,
      undefined,
    ])
  })

  it('размер считается на серию', () => {
    const { ranked } = rankReleases(
      [
        release(
          'pack',
          'Гавань / Сезон: 2 / Серии: 1-10 из 10 (2024) WEB-DL 1080p | D',
          20,
          20 * GB,
        ),
        release(
          'huge',
          'Гавань / Сезон: 2 / Серия: 5 из 10 (2024) WEB-DL 1080p | D',
          20,
          12 * GB,
        ),
      ],
      series,
    )

    expect(ranked.map(item => [item.id, item.episodeSize])).toEqual([
      ['pack', 2 * GB],
      ['huge', 12 * GB],
    ])
  })

  it('ссылка на .torrent при прочих равных выше magnet', () => {
    const { top } = rankReleases(
      [
        release('magnet', 'Фонарь (2021) WEB-DL 1080p | D', 30, 8 * GB, {
          magnet:
            'magnet:?xt=urn:btih:0000000000000000000000000000000000000000',
        }),
        release('file', 'Фонарь (2021) WEB-DL 1080p | D', 30, 8 * GB, {
          link: {
            url: 'https://indexer.example/download/1',
            indexerId: 'ix',
            indexerOrigin: 'https://indexer.example',
          },
        }),
      ],
      movie,
    )

    expect(top[0]).toBe('file')
  })
})

describe('rankReleases: сезон, который смотрят', () => {
  it('тройка — из раздач с этим сезоном, без них — из всех', () => {
    const releases = [
      release('s3', 'Гавань [S03] (2023) WEB-DL 1080p | D', 90, 8 * GB),
      release('s1', 'Гавань [S01] (2023) WEB-DL 720p | MVO', 20, 4 * GB),
      release('all', 'Гавань [S01-03] (2023) WEB-DL 1080p | MVO', 10, 24 * GB),
    ]
    const focused = rankReleases(releases, { ...series, focusSeason: 1 })
    const missing = rankReleases(releases, { ...series, focusSeason: 5 })

    expect(focused.top).not.toContain('s3')
    expect(focused.ranked.find(item => item.id === 'all')!.reason).toBe(
      'profile',
    )
    expect(missing.top[0]).toBe('s3')
  })
})

describe('rankReleases: разрешение', () => {
  it('выведенное разрешение ниже точного той же ступени', () => {
    const { ranked } = rankReleases(
      [
        release('disc', 'Фонарь (2021) Blu-ray | D', 40, 20 * GB),
        release('rip', 'Фонарь (2021) BDRip 1080p | D', 40, 20 * GB),
      ],
      movie,
    )

    expect(ranked.map(item => item.id)).toEqual(['rip', 'disc'])
    expect(ranked[1]!.resolution).toEqual({
      value: '1080p',
      basis: 'source',
      sure: false,
    })
  })

  it('рип без числа — SD с оговоркой, ниже точного SD и неизвестного', () => {
    const { ranked } = rankReleases(
      [
        release('rip', 'Фонарь (2021) BDRip | D', 40, 2 * GB),
        release('web', 'Фонарь (2021) WEB-DL | D', 40, 2 * GB),
        release('dvd', 'Фонарь (2021) DVDRip | D', 40, 2 * GB),
      ],
      movie,
    )

    expect(ranked.map(item => item.id)).toEqual(['dvd', 'web', 'rip'])
    expect(
      ranked.find(item => item.id === 'web')!.resolution,
    ).toBeUndefined()
  })

  it('точное разрешение добавленной раздачи сильнее названия', () => {
    const { ranked } = rankReleases(
      [
        release('rip', 'Фонарь (2021) BDRip | D', 40, 2 * GB),
        release('hd', 'Фонарь (2021) WEB-DL 720p | D', 40, 2 * GB),
      ],
      {
        ...movie,
        known: new Map([
          ['rip', { value: '1080p', basis: 'probe', sure: true }],
        ]),
      },
    )

    expect(ranked[0]).toMatchObject({
      id: 'rip',
      resolution: { value: '1080p', basis: 'probe' },
    })
  })

  it('выведенное разрешение не даёт «Лучшее качество»', () => {
    const { ranked } = rankReleases(
      [
        release('hd', 'Фонарь (2021) WEB-DL 720p | D', 90, 3 * GB),
        release('disc', 'Фонарь (2021) BDRemux | D', 5, 30 * GB),
      ],
      movie,
    )

    expect(ranked.find(item => item.id === 'disc')!.reason).not.toBe(
      'bestQuality',
    )
  })
})

describe('russianVoices и voiceOf', () => {
  const parsed = parseRelease('Фонарь (2021) BDRip 1080p | L, MVO, Original')

  it('все русские дорожки по профилю, без оригинала', () => {
    expect(russianVoices(parsed, movie)).toEqual([
      { type: 'MVO' },
      { type: 'L' },
    ])
  })

  it('основная — лучшая по профилю, а закреплённая сильнее', () => {
    const voices = russianVoices(parsed, movie)

    expect(voiceOf(voices, movie)).toEqual({ type: 'MVO' })
    expect(voiceOf(voices, { ...movie, pinned: { type: 'L' } })).toEqual({
      type: 'L',
    })
  })
})

describe('coversEpisode', () => {
  it('диапазон серий и пак без диапазона', () => {
    const range = parseRelease('Гавань / Сезон: 2 / Серии: 1-4 из 8 (2024)')

    expect(coversEpisode(range, 4)).toBe(true)
    expect(coversEpisode(range, 5)).toBe(false)
    expect(coversEpisode(parseRelease('Гавань [S02] (2024) WEB-DL'), 7)).toBe(
      true,
    )
  })
})
