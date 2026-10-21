import { describe, expect, it } from 'vitest'
import { parseRelease } from '../parse.ts'

function numbering(title: string) {
  const { seasons, episodes, absolute, isPack, isOngoing }
    = parseRelease(title)
  return { seasons, episodes, absolute, isPack, isOngoing }
}

describe('сезоны и серии: scene', () => {
  it.each([
    ['Show.S01E02.1080p.WEB-DL', [1], { from: 2, to: 2, unit: 'episode' }],
    ['Show.S01E01-E03.720p', [1], { from: 1, to: 3, unit: 'episode' }],
    ['Show.S01E01-03.720p', [1], { from: 1, to: 3, unit: 'episode' }],
    ['Show.S01E01E02.720p', [1], { from: 1, to: 2, unit: 'episode' }],
    ['Show.S02E05-S02E07.720p', [2], { from: 5, to: 7, unit: 'episode' }],
    ['Show 1x05 HDTV', [1], { from: 5, to: 5, unit: 'episode' }],
    ['Show.S03.1080p.WEB-DL', [3], undefined],
    ['Show.S01-S03.1080p', [1, 2, 3], undefined],
    ['Show S01 - S02 1080p', [1, 2], undefined],
    ['Show.Season.2.Complete.1080p', [2], undefined],
  ] as const)('%s', (title, seasons, episodes) => {
    const result = numbering(title)
    expect(result.seasons).toEqual(seasons)
    expect(result.episodes).toEqual(episodes)
  })
})

describe('сезоны и серии: русские форматы', () => {
  it('точная серия в `[S13E01-20 of 30]`', () => {
    expect(
      numbering(
        'Название (Original) [S13E01-20 of 30] (2025) WEB-DL 1080p | LostFilm',
      ),
    ).toEqual({
      seasons: [13],
      episodes: { from: 1, to: 20, total: 30, unit: 'episode' },
      absolute: undefined,
      isPack: true,
      isOngoing: true,
    })
  })

  it.each([
    ['Название [13x01-19] (2025)', [13], { from: 1, to: 19, unit: 'episode' }],
    ['Название [05x01-05] (2025)', [5], { from: 1, to: 5, unit: 'episode' }],
    ['Название [S01] (2025) WEB-DL', [1], undefined],
    [
      'Название / Original / Сезон: 2 / Серии: 1-8 из 8 [2024]',
      [2],
      { from: 1, to: 8, total: 8, unit: 'episode' },
    ],
    [
      'Название (Серии 1-8 из 8) [2024]',
      [],
      { from: 1, to: 8, total: 8, unit: 'episode' },
    ],
    [
      'Название [01-10 серии из 12] (2025)',
      [],
      { from: 1, to: 10, total: 12, unit: 'episode' },
    ],
    ['Название (Сезон 1-3) [2024]', [1, 2, 3], undefined],
    ['Название (1-3 сезоны) [2024]', [1, 2, 3], undefined],
    [
      'Название [1 сезон 1-8 серия] (2024)',
      [1],
      { from: 1, to: 8, unit: 'episode' },
    ],
    [
      'Название [Сезон 1, серии 1-8 из 10] (2024)',
      [1],
      { from: 1, to: 8, total: 10, unit: 'episode' },
    ],
    ['Название (Сезоны: 1, 2, 4) [2024]', [1, 2, 4], undefined],
    ['Название [первый сезон] (2024)', [1], undefined],
    ['Название [2-й сезон] (2024)', [2], undefined],
    [
      'Название / Сезон: 1 / Серии: 1-24 (из 24) [2024]',
      [1],
      { from: 1, to: 24, total: 24, unit: 'episode' },
    ],
    [
      'Название [S01E01-08 из 10] (2025)',
      [1],
      { from: 1, to: 8, total: 10, unit: 'episode' },
    ],
  ] as const)('%s', (title, seasons, episodes) => {
    const result = numbering(title)
    expect(result.seasons).toEqual(seasons)
    expect(result.episodes).toEqual(episodes)
  })

  it('выпуски вместо серий', () => {
    expect(numbering('Шоу [1 выпуск из 12] (2025) IPTV').episodes).toEqual({
      from: 1,
      to: 1,
      total: 12,
      unit: 'issue',
    })
    expect(numbering('Шоу [Выпуски 1-10 из ??] (2025)').episodes).toEqual({
      from: 1,
      to: 10,
      unit: 'issue',
    })
  })

  it('неизвестное общее число — раздача пополняется', () => {
    expect(numbering('Название [Серии 1-5 из XX] (2025)').isOngoing).toBe(true)
    expect(numbering('Название [S02E01-06 of ??] (2025)').isOngoing).toBe(true)
    expect(numbering('Название [Серии 1-8 из 8] (2025)').isOngoing).toBe(false)
  })
})

describe('аниме', () => {
  it('`[TV-1, 12 из 12]` — сезон и все вышедшие серии', () => {
    expect(
      numbering('Название / Original [TV-1, 12 из 12] [2024, BDRip 1080p]'),
    ).toMatchObject({
      seasons: [1],
      episodes: { from: 1, to: 12, total: 12, unit: 'episode' },
    })
  })

  it('абсолютная нумерация через дефис', () => {
    expect(numbering('[Group] Title - 1071 [1080p]')).toMatchObject({
      seasons: [],
      episodes: undefined,
      absolute: { from: 1071, to: 1071 },
    })
    expect(numbering('[Group] Title - 01-12 [BD 1080p]')).toMatchObject({
      absolute: { from: 1, to: 12 },
      isPack: true,
    })
    expect(numbering('[Group] Title - 05v2 [720p]').absolute).toEqual({
      from: 5,
      to: 5,
    })
  })

  it('при известном сезоне номер через дефис — серия', () => {
    expect(numbering('[Group] Title S2 - 05 [1080p]')).toMatchObject({
      seasons: [2],
      episodes: { from: 5, to: 5 },
    })
  })

  it('диапазон в отдельных скобках', () => {
    expect(numbering('[Group] Title [01-12] [1080p]').absolute).toEqual({
      from: 1,
      to: 12,
    })
  })
})

describe('без ложных срабатываний', () => {
  it.each([
    'Сезон охоты (2006) BDRip 1080p',
    'Девять ярдов (2000) DVDRip',
    '1917 (2019) BDRemux 2160p',
    'Title (2019-2024) WEB-DL 1080p',
    'Космос 2049 (2017) WEB-DL 1080p',
    'Title.1920x1080.mkv',
  ])('%s', (title) => {
    const result = numbering(title)
    expect(result.seasons).toEqual([])
    expect(result.episodes).toBeUndefined()
    expect(result.absolute).toBeUndefined()
  })
})
