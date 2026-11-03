import type { TitleTarget } from './match.ts'
import { describe, expect, it } from 'vitest'
import { matchTitle } from './match.ts'
import { parseRelease } from './parse.ts'

const harbor: TitleTarget = {
  kind: 'series',
  aliases: ['Тихая гавань', 'Quiet Harbor', 'Tikhaya gavan'],
  year: 2023,
  season: 2,
}

const lantern: TitleTarget = {
  kind: 'movie',
  aliases: ['Бумажный фонарь', 'The Paper Lantern'],
  year: 2021,
}

function match(title: string, target: TitleTarget) {
  return matchTitle(parseRelease(title), target)
}

describe('matchTitle', () => {
  it.each([
    'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-8 из 8 (2024) WEB-DL 1080p | LostFilm',
    'Quiet.Harbor.S02E05.1080p.WEB-DL.H.264-GRP',
    'Tikhaya gavan [S02E01-04 из 08] (2024) WEBRip 720p',
    'Тихая гавань [S01-02] (2023-2024) WEB-DL 1080p',
  ])('сериал: %s → high', (title) => {
    expect(match(title, harbor)).toEqual({ confidence: 'high', issues: [] })
  })

  it('чужое название → low', () => {
    expect(
      match('Тёмная гавань / Dark Harbor / Сезон: 2 (2024) WEB-DL', harbor),
    ).toEqual({ confidence: 'low', issues: ['title'] })
  })

  it('другой сезон → low', () => {
    expect(match('Quiet.Harbor.S03E01.1080p.WEB-DL-GRP', harbor)).toEqual({
      confidence: 'low',
      issues: ['season'],
    })
  })

  it('продолжение с подзаголовком → medium', () => {
    expect(
      match('Тихая гавань Возвращение / Сезон: 2 (2024) WEB-DL 1080p', harbor),
    ).toEqual({ confidence: 'medium', issues: ['partialTitle'] })
  })

  it.each([
    'Тихая гавань Зеро / Harbor Zero (2018) BDRip 1080p | P',
    'Тихая гавань X (2023) WEB-DL 1080p | L1',
  ])('похожее начало без сезона: %s → low', (title) => {
    expect(match(title, harbor).confidence).toBe('low')
  })

  it('без сезона и не первый сезон → medium', () => {
    expect(match('Тихая гавань (2023-2025) WEB-DL 1080p', harbor)).toEqual({
      confidence: 'medium',
      issues: ['noSeason'],
    })
  })

  it('без сезона с сериями подходит первому сезону', () => {
    expect(
      match('Тихая гавань [01-08 из 08] (2023) WEB-DL 1080p', {
        ...harbor,
        season: 1,
      }).confidence,
    ).toBe('high')
  })

  it('год до начала сериала → medium', () => {
    expect(
      match('Тихая гавань / Сезон: 2 (2015) WEB-DL 1080p', harbor),
    ).toEqual({ confidence: 'medium', issues: ['year'] })
  })

  it.each([
    'Бумажный фонарь / The Paper Lantern (2021) BDRip 1080p | D',
    'The.Paper.Lantern.2022.2160p.WEB-DL.HDR-GRP',
    'Бумажный фонарь (2021) WEB-DL 720p',
  ])('фильм: %s → high', (title) => {
    expect(match(title, lantern).confidence).toBe('high')
  })

  it('омоним фильма другого года → medium', () => {
    expect(match('The Paper Lantern (1987) DVDRip', lantern)).toEqual({
      confidence: 'medium',
      issues: ['year'],
    })
  })

  it('фильм с похожим началом и чужим годом → low', () => {
    expect(match('Бумажный фонарь 2 (2024) WEB-DL 1080p', lantern)).toEqual({
      confidence: 'low',
      issues: ['partialTitle', 'year'],
    })
  })

  it('сериал с названием фильма → low', () => {
    expect(
      match('Бумажный фонарь / Сезон: 1 / Серии: 1-6 из 6 (2021)', lantern),
    ).toEqual({ confidence: 'low', issues: ['kind'] })
  })

  // Цель без сезона: так сверяет лента «Следить»
  const quiet: TitleTarget = {
    kind: 'series',
    aliases: ['Quiet Harbor'],
    year: 2020,
    seasonYears: { 1: 2020, 2: 2021, 3: 2022, 4: 2023 },
  }

  it('первый сезон с годом не того сериала → medium', () => {
    expect(match('Quiet Harbor (2024) S01E01 1080p WEB-DL', quiet)).toEqual({
      confidence: 'medium',
      issues: ['year'],
    })
  })

  it('пак с первого сезона с годом последнего → high', () => {
    expect(match('Quiet.Harbor.S01-S03.2022.1080p.WEB-DL-GRP', quiet)).toEqual({
      confidence: 'high',
      issues: [],
    })
  })

  it('поздний сезон с годом своего эфира → high', () => {
    expect(match('Quiet Harbor (2023) S04E01 1080p WEB-DL', quiet)).toEqual({
      confidence: 'high',
      issues: [],
    })
  })

  it('совпадение только по ключу написания без года → medium', () => {
    expect(
      match('Мат / Сезон: 1 / Серии: 1-8 из 8 WEB-DL 1080p', {
        kind: 'series',
        aliases: ['Мать'],
        year: 2020,
      }),
    ).toEqual({ confidence: 'medium', issues: ['similarTitle'] })
  })

  it('совпадение по ключу написания с совпавшим годом → high', () => {
    expect(
      match('Брать / Сезон: 1 / Серии: 1-8 из 8 (2020) WEB-DL 1080p', {
        kind: 'series',
        aliases: ['Брат'],
        year: 2020,
      }),
    ).toEqual({ confidence: 'high', issues: [] })
  })

  it('транслит другой письменностью — точное совпадение', () => {
    expect(
      match('Odnazhdy v derevne / Сезон: 1 / Серии: 1-8 из 8 WEB-DL', {
        kind: 'series',
        aliases: ['Однажды в деревне'],
        year: 2020,
      }),
    ).toEqual({ confidence: 'high', issues: [] })
  })
})

describe('сопутствующий контент', () => {
  it.each([
    'Бумажный фонарь / The Paper Lantern: The Video Game (2021) PC | RePack-DEMO',
    'The Paper Lantern (2021) [PC] RePack',
    'The Paper Lantern (2021) PC',
    'The Paper Lantern: The Video Game / Бумажный фонарь (2021) PC-Лицензия',
    'The Paper Lantern (2021) OST FLAC',
    'The Paper Lantern (2020) WEBRip 2160p | 4K-Трейлер',
    'The Paper Lantern (Trailer) (2020) WEBRip',
  ])('%s не является полнометражным видео', (title) => {
    expect(match(title, lantern)).toEqual({
      confidence: 'low',
      issues: ['content'],
    })
  })

  it.each(['Game', 'Trailer', 'Soundtrack', 'PC Game', 'The Trailer Park'])(
    'слова в названии %s не запрещены',
    (name) => {
      expect(
        match(`${name} (2021) WEB-DL 1080p`, { ...lantern, aliases: [name] })
          .confidence,
      ).toBe('high')
    },
  )
})

describe('годы сезонов', () => {
  const target: TitleTarget = {
    kind: 'series',
    aliases: ['Ocean Journey'],
    year: 1999,
    seasonYears: { 1: 1999, 2: 2001, 3: 2004, 20: 2023 },
  }

  it.each(['S02', 'S01-S02'])(
    'поздний год чужой экранизации для %s',
    (seasons) => {
      expect(match(`Ocean Journey ${seasons} (2023) WEB-DL`, target)).toEqual({
        confidence: 'medium',
        issues: ['year'],
      })
    },
  )
  it.each([
    'S02 (2003)',
    'S01-S02 (2003)',
    'S20 (2024)',
    'S02 (2000)',
    'S20 (1999)',
  ])('известный сезонный интервал: %s', (suffix) => {
    expect(match(`Ocean Journey ${suffix} WEB-DL`, target).confidence).toBe(
      'high',
    )
  })
  it('пак не использует интервал сезона, которого в нём нет', () => {
    const parsed = parseRelease('Ocean Journey S01 (2023) WEB-DL')
    parsed.seasons = [1, 3]
    expect(
      matchTitle(parsed, {
        ...target,
        seasonYears: { 1: 1999, 2: 2001, 3: 2004, 4: 2006 },
      }).confidence,
    ).toBe('medium')
  })
  it('без даты сезона поздний год остаётся сомнением', () => {
    expect(
      match('Ocean Journey S02 (2023) WEB-DL', {
        ...target,
        seasonYears: undefined,
      }).confidence,
    ).toBe('medium')
  })
  it('начало длительного сезона не считается его концом', () => {
    expect(match('Ocean Journey S02 (2003) WEB-DL', target).confidence).toBe(
      'high',
    )
  })
  it('абсолютная нумерация не привязана к первому году', () => {
    const parsed = parseRelease('Ocean Journey (2023) WEB-DL')
    parsed.absolute = { from: 1000, to: 1005 }
    expect(matchTitle(parsed, target).confidence).toBe('high')
  })
})

it.each([
  '[DEMO] Trailer Park (2021) WEB-DL 1080p',
  '[DEMO] Game Windows (2021) WEB-DL 1080p',
  'Soundtrack (2021) BluRay 1080p FLAC',
])('теги до названия и слова самого названия не дают content: %s', (title) => {
  const parsed = parseRelease(title)
  expect(
    matchTitle(parsed, {
      kind: 'movie',
      aliases: [parsed.titles.orig!],
      year: 2021,
    }).confidence,
  ).toBe('high')
})
it('префикс OST с форматом аудио — сопутствующий контент', () => {
  expect(
    match(
      'OST - Бумажный фонарь / The Paper Lantern [by Demo Composer] (2021) FLAC',
      lantern,
    ),
  ).toEqual({ confidence: 'low', issues: ['content'] })
})
it('пропущенные даты сезонов не доказывают длительный интервал', () => {
  expect(
    match('Ocean Journey S02 (2023) WEB-DL', {
      kind: 'series',
      aliases: ['Ocean Journey'],
      year: 1999,
      seasonYears: { 1: 1999, 2: 2001, 20: 2023 },
    }).confidence,
  ).toBe('medium')
})

it('год завершения сериала не подтверждает поздний год первого сезона без дат', () => {
  expect(
    match('Quiet Harbor S01 (2024) WEB-DL', {
      kind: 'series',
      aliases: ['Quiet Harbor'],
      year: 1999,
      endYear: 2024,
    }),
  ).toEqual({ confidence: 'medium', issues: ['year'] })
})
it.each([2022, 2023, 2024])(
  'последний сезон завершённого сериала допускает начало ±1: %s',
  (year) => {
    expect(
      match(`Quiet Harbor S20 (${year}) WEB-DL`, {
        kind: 'series',
        aliases: ['Quiet Harbor'],
        year: 1999,
        endYear: 2025,
        seasonYears: { 1: 1999, 20: 2023 },
      }).confidence,
    ).toBe('high')
  },
)

describe('структурный префикс названия', () => {
  const target: TitleTarget = {
    kind: 'series',
    aliases: ['Quiet Harbor'],
    year: 2023,
  }
  it.each(['Channel:', 'Studio.', 'Publisher -', 'Documentary:'])(
    '%s даёт только medium',
    (prefix) => {
      expect(match(`${prefix} Quiet Harbor (2023) WEBRip`, target)).toEqual({
        confidence: 'medium',
        issues: ['prefixedTitle'],
      })
    },
  )
  it('внутреннее двоеточие остаётся частью полного алиаса', () => {
    expect(
      match('Publisher: Quiet Harbor: Return (2023) WEBRip', {
        ...target,
        aliases: ['Quiet Harbor: Return'],
      }),
    ).toEqual({ confidence: 'medium', issues: ['prefixedTitle'] })
  })
  it.each([
    'Publisher Quiet Harbor',
    'Publisher: Studio: Quiet Harbor',
    'Publisher: Quiet Harbor: Return',
  ])('%s не снимает произвольную последовательность слов', (name) => {
    expect(match(`${name} (2023) WEBRip`, target).confidence).toBe('low')
  })
  it.each(['Making Of', 'Behind the Scenes', 'Фильм о фильме', 'За кадром'])(
    '%s — отдельный контент',
    (prefix) => {
      expect(match(`${prefix}: Quiet Harbor (2023) WEBRip`, target)).toEqual({
        confidence: 'low',
        issues: ['content'],
      })
      expect(
        match(`${prefix}: Quiet Harbor / Quiet Harbor (2023) WEBRip`, target),
      ).toEqual({ confidence: 'low', issues: ['content'] })
      expect(
        match(`${prefix}: Quiet Harbor (2023) WEBRip`, {
          ...target,
          aliases: [`${prefix}: Quiet Harbor`],
        }).confidence,
      ).toBe('high')
    },
  )
  it('совпадение без префикса остаётся high', () => {
    expect(match('Quiet Harbor (2023) WEBRip', target).confidence).toBe('high')
  })
  it.each([
    ['Publisher: Quiet Harbor (2010) WEBRip', {}],
    ['Publisher: Quiet Harbor (2023) WEBRip', { season: 2 }],
    ['Publisher: Quiet Harbor S03 (2023) WEBRip', { season: 2 }],
    ['Publisher: Quiet Harbor S01 (2023) WEBRip', { kind: 'movie' as const }],
  ])('префикс с другим сомнением: %s', (title, override) => {
    expect(match(title, { ...target, ...override }).confidence).toBe('low')
  })
})

it('служебный pipe не восстанавливает название за границей парсера', () => {
  expect(
    match('Publisher | Quiet Harbor (2023) WEBRip', {
      kind: 'series',
      aliases: ['Quiet Harbor'],
      year: 2023,
    }).confidence,
  ).toBe('low')
})

it('достаточно полного алиаса дополнительного фильма на одном языке', () => {
  const title
    = 'Фильм о фильме: Тихая гавань / Making Of: Quiet Harbor (2023) WEBRip'
  expect(
    match(title, {
      kind: 'movie',
      aliases: ['Making Of: Quiet Harbor'],
      year: 2023,
    }),
  ).toEqual({ confidence: 'high', issues: [] })
  expect(
    match(title, {
      kind: 'movie',
      aliases: ['Quiet Harbor', 'Тихая гавань'],
      year: 2023,
    }),
  ).toEqual({ confidence: 'low', issues: ['content'] })
})
it('полный алиас дополнительного фильма использует правила транслитерации', () => {
  expect(
    match(
      'Фильм о фильме: Тихая гавань / Making Of: Quiet Harbor (2023) WEBRip',
      {
        kind: 'movie',
        aliases: ['Film o filme: Tikhaya gavan'],
        year: 2023,
      },
    ),
  ).toEqual({ confidence: 'high', issues: [] })
})
