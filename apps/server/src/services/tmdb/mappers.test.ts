import { describe, expect, it } from 'vitest'
import {
  logos,
  movie,
  movieExtras,
  movieList,
  searchResponse,
  searchWithPerson,
  season,
  trendingAll,
  tv,
  tvExtras,
  tvOngoing,
} from './fixtures/index.ts'
import {
  extrasToDto,
  listResultToCard,
  movieToDetails,
  parseCatalogId,
  pickLogo,
  searchResultsToCards,
  searchResultToCard,
  seasonToDetails,
  toCatalogId,
  trimExtras,
  tvToDetails,
} from './mappers.ts'

describe('каталожный ID', () => {
  it('разбирается обратно', () => {
    expect(parseCatalogId(toCatalogId('tv', 1396))).toEqual({
      type: 'tv',
      tmdbId: 1396,
    })
  })

  it.each(['603', 'tmdb:person:1', 'tmdb:movie:', 'tmdb:movie:1x'])(
    'отвергает %s',
    (id) => {
      expect(parseCatalogId(id)).toBeUndefined()
    },
  )
})

describe('searchResultToCard', () => {
  const cards = searchResponse.results.map(searchResultToCard)

  it('собирает карточку фильма', () => {
    expect(cards[0]).toEqual({
      id: 'tmdb:movie:603',
      kind: 'movie',
      title: 'Матрица',
      originalTitle: 'The Matrix',
      year: 1999,
      poster: '/api/img/w342/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
    })
  })

  it('собирает карточку сериала без постера', () => {
    expect(cards[1]).toEqual({
      id: 'tmdb:tv:1396',
      kind: 'series',
      title: 'Во все тяжкие',
      originalTitle: 'Breaking Bad',
      year: 2008,
      poster: undefined,
    })
  })

  it('отбрасывает персоны', () => {
    expect(cards[2]).toBeUndefined()
  })

  it('оставляет год пустым без даты выхода', () => {
    expect(cards[3]?.year).toBeUndefined()
  })
})

describe('listResultToCard', () => {
  it('берёт тип из media_type в трендах', () => {
    expect(listResultToCard(trendingAll.results[1]!)?.id).toBe('tmdb:tv:1396')
    expect(listResultToCard(trendingAll.results[2]!)).toBeUndefined()
  })

  it('берёт тип списка, если media_type нет', () => {
    expect(listResultToCard(movieList.results[0]!, 'movie')).toMatchObject({
      id: 'tmdb:movie:100',
      kind: 'movie',
      title: 'Фильм 1',
    })
    expect(listResultToCard(movieList.results[0]!)).toBeUndefined()
  })
})

describe('pickLogo', () => {
  it('предпочитает логотип на языке интерфейса с лучшей оценкой, только PNG', () => {
    expect(pickLogo(logos, 'ru-RU')).toBe('/api/img/w500/ruLogo.png')
  })

  it('без перевода берёт логотип без текста, затем английский', () => {
    expect(pickLogo(logos, 'de-DE')).toBe('/api/img/w500/neutralLogo.png')
    expect(
      pickLogo(
        logos.filter(logo => logo.iso_639_1 !== null),
        'de-DE',
      ),
    ).toBe('/api/img/w500/enLogo.png')
  })

  it('без логотипов — undefined', () => {
    expect(pickLogo(undefined, 'en-US')).toBeUndefined()
    expect(pickLogo([], 'en-US')).toBeUndefined()
  })
})

describe('movieToDetails', () => {
  it('собирает карточку фильма', () => {
    expect(movieToDetails(movie)).toEqual({
      id: 'tmdb:movie:603',
      kind: 'movie',
      title: 'Матрица',
      originalTitle: 'The Matrix',
      year: 1999,
      poster: '/api/img/w342/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
      backdrop: '/api/img/w1280/tlm8UkiQsitc8rSuIAscQDCnP8d.jpg',
      overview: 'Хакер Нео узнаёт правду о реальности.',
      genres: ['боевик', 'фантастика'],
      runtime: 136,
      rating: 8.2,
      certification: undefined,
      countries: [],
      studios: [],
      creators: [],
    })
  })

  it('берёт возраст региона языка, иначе американский, пропуская пустые', () => {
    const rated = {
      ...movie,
      release_dates: {
        results: [
          { iso_3166_1: 'US', release_dates: [{ certification: 'R' }] },
          {
            iso_3166_1: 'RU',
            release_dates: [{ certification: '' }, { certification: '18+' }],
          },
        ],
      },
    }

    expect(movieToDetails(rated, 'ru-RU').certification).toBe('18+')
    expect(movieToDetails(rated, 'de-DE').certification).toBe('R')
  })
})

describe('логотип в деталях', () => {
  it('выбирается по языку запроса', () => {
    expect(movieToDetails({ ...movie, images: { logos } }, 'ru-RU').logo).toBe(
      '/api/img/w500/ruLogo.png',
    )
    expect(tvToDetails({ ...tv, images: { logos } }, 'en-US').logo).toBe(
      '/api/img/w500/enLogo.png',
    )
  })
})

describe('tvToDetails', () => {
  const details = tvToDetails(tv)

  it('пропускает спецвыпуски и берёт год сезона из даты', () => {
    expect(details.seasons).toEqual([
      {
        number: 1,
        name: 'Сезон 1',
        episodeCount: 7,
        airedEpisodeCount: 7,
        year: 2008,
      },
      {
        number: 2,
        name: 'Сезон 2',
        episodeCount: 13,
        airedEpisodeCount: 0,
        year: undefined,
      },
    ])
  })

  it('считает вышедшие серии по последней вышедшей', () => {
    const ongoing = tvToDetails(tvOngoing, 'ru-RU')

    expect(
      ongoing.seasons?.map(item => [item.number, item.airedEpisodeCount]),
    ).toEqual([
      [1, 8],
      [2, 4],
      [3, 0],
    ])
  })

  it('без последней вышедшей серии смотрит на дату начала сезона', () => {
    const now = new Date('2026-10-20')
    const upcoming = tvToDetails(
      {
        ...tvOngoing,
        last_episode_to_air: null,
        seasons: [
          {
            season_number: 1,
            name: '1',
            episode_count: 6,
            air_date: '2026-10-01',
          },
          {
            season_number: 2,
            name: '2',
            episode_count: 6,
            air_date: '2027-01-01',
          },
        ],
      },
      'en-US',
      now,
    )

    expect(upcoming.seasons?.map(item => item.airedEpisodeCount)).toEqual([
      6,
      0,
    ])
  })

  it('идущий сериал без года окончания, завершённый — с ним', () => {
    expect(tvToDetails(tvOngoing)).toMatchObject({ ongoing: true })
    expect(tvToDetails(tvOngoing).endYear).toBeUndefined()
    expect(
      tvToDetails({
        ...tvOngoing,
        status: 'Ended',
        last_air_date: '2022-05-01',
      }),
    ).toMatchObject({ ongoing: false, endYear: 2022 })
  })

  it('берёт факты, каналы до трёх и возраст с откатом на US', () => {
    expect(tvToDetails(tvOngoing, 'ru-RU')).toMatchObject({
      countries: ['US', 'GB'],
      studios: ['Канал 1', 'Канал 2', 'Канал 3'],
      creators: ['Анна Автор'],
      certification: 'TV-MA',
    })
    expect(tvToDetails(tvOngoing, 'de-DE').certification).toBe('16')
  })

  it('не показывает рейтинг без голосов и бэкдроп без картинки', () => {
    expect(details.rating).toBeUndefined()
    expect(details.backdrop).toBeUndefined()
    expect(details.runtime).toBeUndefined()
  })
})

describe('searchResultsToCards', () => {
  it('добавляет известные тайтлы персон после прямых совпадений без повторов', () => {
    expect(
      searchResultsToCards(searchWithPerson.results).map(card => card.id),
    ).toEqual(['tmdb:movie:603', 'tmdb:movie:245891'])
  })
})

describe('seasonToDetails', () => {
  it('собирает серии со стиллами и пустыми полями без данных', () => {
    expect(seasonToDetails(season).episodes.slice(0, 2)).toEqual([
      {
        number: 1,
        title: 'Пробуждение',
        overview: 'Экипаж просыпается.',
        airDate: '2026-09-26',
        runtime: 52,
        still: '/api/img/w300/still1.jpg',
      },
      {
        number: 2,
        title: 'Эпизод 2',
        overview: '',
        airDate: '2026-10-03',
        runtime: undefined,
        still: undefined,
      },
    ])
  })
})

describe('extras', () => {
  const tvRef = { type: 'tv', tmdbId: 2000 } as const
  const movieRef = { type: 'movie', tmdbId: 603 } as const

  it('урезает актёров до 20 по порядку титров и выкидывает лишнее', () => {
    const trimmed = trimExtras(tvExtras)

    expect(trimmed.aggregate_credits?.cast).toHaveLength(20)
    expect(trimmed.aggregate_credits?.cast[0]?.name).toBe('Актёр 25')
    expect(trimmed).not.toHaveProperty('overview')
    expect(trimmed.aggregate_credits).not.toHaveProperty('crew')
  })

  it('у сериала роль — персонаж с наибольшим числом серий', () => {
    const dto = extrasToDto(trimExtras(tvExtras), tvRef, 'ru-RU')

    expect(dto.cast[0]).toEqual({
      id: 'tmdb:person:524',
      name: 'Актёр 25',
      role: 'Герой 25',
      photo: undefined,
    })
    expect(dto.cast.at(-1)?.photo).toBeUndefined()
    expect(dto.directors).toEqual([])
  })

  it('похожее — с постером и без самого тайтла', () => {
    expect(
      extrasToDto(tvExtras, tvRef, 'ru-RU').similar.map(card => card.id),
    ).toEqual(['tmdb:tv:1396'])
  })

  it('другие названия: сначала региона языка, без названий тайтла и повторов', () => {
    expect(extrasToDto(tvExtras, tvRef, 'ru-RU').aka).toEqual([
      'Орбита',
      'The Long Orbit',
    ])
  })

  it('у фильма роль из credits, режиссёры из съёмочной группы', () => {
    const dto = extrasToDto(trimExtras(movieExtras), movieRef, 'en-US')

    expect(dto.cast).toEqual([
      {
        id: 'tmdb:person:6384',
        name: 'Keanu Reeves',
        role: 'Neo',
        photo: '/api/img/w185/keanu.jpg',
      },
      {
        id: 'tmdb:person:2975',
        name: 'Laurence Fishburne',
        role: undefined,
        photo: undefined,
      },
    ])
    expect(dto.directors).toEqual(['Lilly Wachowski', 'Lana Wachowski'])
    expect(dto.aka).toEqual(['Matrix'])
  })

  it('другие названия — только латиницей и кириллицей', () => {
    const dto = extrasToDto(
      {
        ...movieExtras,
        alternative_titles: {
          titles: [
            { iso_3166_1: 'KR', title: '매트릭스' },
            { iso_3166_1: 'GR', title: 'Μάτριξ' },
            { iso_3166_1: 'RU', title: 'Матрица: Перезагрузка 1' },
            { iso_3166_1: 'FR', title: 'Matrix (1999)' },
          ],
        },
      },
      movieRef,
      'en-US',
    )

    expect(dto.aka).toEqual(['Матрица: Перезагрузка 1', 'Matrix (1999)'])
  })
})
