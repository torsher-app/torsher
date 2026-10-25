import type { TmdbExtras } from './types.ts'
import { describe, expect, it } from 'vitest'
import {
  collection,
  logos,
  movie,
  movieExtras,
  movieList,
  person,
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
  franchiseParts,
  listResultToCard,
  movieToDetails,
  parseCatalogId,
  parsePersonId,
  personToDto,
  pickLogo,
  searchResultsToCards,
  searchResultsToPeople,
  searchResultToCard,
  seasonToDetails,
  toCatalogId,
  toPersonId,
  trimExtras,
  trimPerson,
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
      ratings: [{ provider: 'tmdb', label: 'TMDB', value: 8.2, votes: 26000 }],
      certification: undefined,
      countries: [],
      studios: [],
      creators: [],
      tagline: 'Добро пожаловать в реальный мир',
      status: undefined,
      originalLanguage: undefined,
      releases: [{ type: 'premiere', date: '1999-03-31' }],
      budget: undefined,
      revenue: undefined,
    })
  })

  it('не отдаёт нулевые бюджет и сборы и пустой слоган, переводит статус', () => {
    expect(
      movieToDetails({
        ...movie,
        budget: 0,
        revenue: 465000000,
        tagline: ' ',
        status: 'Post Production',
        original_language: 'en',
      }),
    ).toMatchObject({
      budget: undefined,
      revenue: 465000000,
      tagline: undefined,
      status: 'postProduction',
      originalLanguage: 'en',
    })
  })

  it('снимает со слогана внешние кавычки, но не внутренние', () => {
    expect(
      movieToDetails({ ...movie, tagline: '«Последняя надежда двух миров»' })
        .tagline,
    ).toBe('Последняя надежда двух миров')
    expect(
      movieToDetails({ ...movie, tagline: '«Один» против «всех»' }).tagline,
    ).toBe('«Один» против «всех»')
  })

  it('берёт кинорелиз региона позже премьеры и цифровой релиз, без него — американский', () => {
    const dated = {
      ...movie,
      release_date: '2026-03-15',
      release_dates: {
        results: [
          {
            iso_3166_1: 'US',
            release_dates: [
              {
                certification: '',
                type: 3,
                release_date: '2026-03-15T00:00:00.000Z',
              },
              {
                certification: '',
                type: 4,
                release_date: '2026-05-20T00:00:00.000Z',
              },
              {
                certification: '',
                type: 4,
                release_date: '2026-05-01T00:00:00.000Z',
              },
            ],
          },
          {
            iso_3166_1: 'RU',
            release_dates: [
              {
                certification: '',
                type: 1,
                release_date: '2026-03-01T00:00:00.000Z',
              },
              {
                certification: '',
                type: 3,
                release_date: '2026-03-20T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    }

    expect(movieToDetails(dated, 'ru-RU').releases).toEqual([
      { type: 'premiere', date: '2026-03-15' },
      { type: 'theatrical', date: '2026-03-20', country: 'RU' },
      { type: 'digital', date: '2026-05-01', country: 'US' },
    ])
    // Кинорелиз в день премьеры повтором не считается
    expect(movieToDetails(dated, 'en-US').releases).toEqual([
      { type: 'premiere', date: '2026-03-15' },
      { type: 'digital', date: '2026-05-01', country: 'US' },
    ])
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

  it('срезает пробелы в названиях каналов и пропускает пустые', () => {
    const tv = {
      ...tvOngoing,
      networks: [
        { id: 1, name: 'NTV ' },
        { id: 2, name: ' ' },
        { id: 3, name: 'START' },
      ],
    }

    expect(tvToDetails(tv).studios).toEqual(['NTV', 'START'])
  })

  it('берёт эфир, статус, следующую серию и число серий', () => {
    expect(
      tvToDetails({
        ...tvOngoing,
        number_of_episodes: 26,
        original_language: 'en',
        next_episode_to_air: {
          season_number: 2,
          episode_number: 5,
          air_date: '2026-10-31',
        },
      }),
    ).toMatchObject({
      status: 'returning',
      originalLanguage: 'en',
      firstAirDate: '2008-01-20',
      lastAirDate: '2026-10-17',
      nextEpisode: { season: 2, episode: 5, airDate: '2026-10-31' },
      episodeCount: 26,
    })
    expect(tvToDetails(tv).nextEpisode).toBeUndefined()
  })

  it('длительность серии — из episode_run_time, без неё — по последней серии', () => {
    expect(
      tvToDetails({ ...tvOngoing, episode_run_time: [48, 55] }).episodeRuntime,
    ).toBe(48)
    expect(
      tvToDetails({
        ...tvOngoing,
        episode_run_time: [],
        last_episode_to_air: {
          season_number: 2,
          episode_number: 4,
          runtime: 52,
        },
      }).episodeRuntime,
    ).toBe(52)
    expect(tvToDetails(tvOngoing).episodeRuntime).toBeUndefined()
  })

  it('не показывает рейтинг без голосов и бэкдроп без картинки', () => {
    expect(details.ratings).toEqual([])
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
    expect(
      trimmed.aggregate_credits?.crew?.map(member => [
        member.id,
        member.jobs?.map(item => item.job),
      ]),
    ).toEqual([
      [901, ['Writer']],
      [902, ['Writer']],
      [904, ['Executive Producer']],
    ])
  })

  it('у фильма сохраняет франшизу', () => {
    expect(
      trimExtras({
        ...movieExtras,
        belongs_to_collection: {
          id: 2344,
          name: 'Матрица (Коллекция)',
          poster_path: '/collection.jpg',
        } as TmdbExtras['belongs_to_collection'],
      }).belongs_to_collection,
    ).toEqual({ id: 2344, name: 'Матрица (Коллекция)' })
  })

  it('у фильма оставляет только должности съёмочной группы', () => {
    expect(
      trimExtras(movieExtras).credits?.crew.map(member => member.job),
    ).not.toContain('Key Grip')
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

  it('у сериала в группе — создатели вместо режиссёров, по числу серий', () => {
    const dto = extrasToDto(trimExtras(tvExtras), tvRef, 'ru-RU')

    expect(dto.crew).toEqual([
      {
        id: 'tmdb:person:904',
        name: 'Создатель',
        photo: '/api/img/w185/creator.jpg',
        jobs: ['creator', 'producer'],
      },
      {
        id: 'tmdb:person:902',
        name: 'Главный сценарист',
        photo: undefined,
        jobs: ['writer'],
      },
      {
        id: 'tmdb:person:901',
        name: 'Сценарист',
        photo: undefined,
        jobs: ['writer'],
      },
    ])
  })

  it('у фильма группа по должностям: одна карточка на человека, без фото — только если с фото никого', () => {
    const dto = extrasToDto(trimExtras(movieExtras), movieRef, 'en-US')

    expect(dto.crew.map(member => [member.name, member.jobs])).toEqual([
      ['Lilly Wachowski', ['director', 'writer']],
      ['Lana Wachowski', ['director']],
      ['Composer', ['music']],
      ['Producer D', ['producer']],
    ])
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

  it('теги фильма: студии — company, не больше 6, keywords — до 20', () => {
    const { tags } = extrasToDto(trimExtras(movieExtras), movieRef, 'en-US')

    expect(tags.genres).toEqual([{ id: '878', name: 'Фантастика' }])
    expect(tags.studios).toHaveLength(6)
    expect(tags.studios[0]).toEqual({ id: 'company:100', name: 'Студия 1' })
    expect(tags.keywords).toHaveLength(20)
    expect(tags.keywords[0]).toEqual({ id: '1000', name: 'Keyword 1' })
  })

  it('теги сериала: каналы — network, пустые названия пропускаются', () => {
    const { tags } = extrasToDto(trimExtras(tvExtras), tvRef, 'ru-RU')

    expect(tags).toEqual({
      genres: [
        { id: '18', name: 'Драма' },
        { id: '10765', name: 'НФ и Фэнтези' },
      ],
      studios: [{ id: 'network:49', name: 'HBO' }],
      keywords: [{ id: '9882', name: 'Space' }],
    })
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

describe('franchiseParts', () => {
  const movieRef = { type: 'movie', tmdbId: 604 } as const

  it('по дате выхода, без частей без даты, текущий помечен', () => {
    expect(
      franchiseParts(collection.parts, movieRef).map(part => [
        part.id,
        part.year,
        part.current,
      ]),
    ).toEqual([
      ['tmdb:movie:603', 1999, false],
      ['tmdb:movie:604', 2003, true],
      ['tmdb:movie:605', 2003, false],
      ['tmdb:movie:624860', 2021, false],
    ])
  })

  it('часть без постера остаётся', () => {
    const parts = franchiseParts(collection.parts, movieRef)

    expect(parts.find(part => part.id === 'tmdb:movie:605')?.poster).toBe(
      undefined,
    )
  })

  it('текущий фильм без даты — последним', () => {
    const parts = franchiseParts(collection.parts, {
      type: 'movie',
      tmdbId: 999001,
    })

    expect(parts.at(-1)).toMatchObject({
      id: 'tmdb:movie:999001',
      current: true,
    })
    expect(parts).toHaveLength(5)
  })

  it('одна часть — не франшиза', () => {
    expect(
      franchiseParts(
        collection.parts.filter(part => part.id === 603),
        { type: 'movie', tmdbId: 603 },
      ),
    ).toEqual([])
  })
})

describe('персона', () => {
  it('iD разбирается обратно и не путается с тайтлом', () => {
    expect(parsePersonId(toPersonId(525))).toBe(525)
    expect(parsePersonId('tmdb:movie:525')).toBeUndefined()
  })

  it('люди из поиска — только с фото', () => {
    expect(
      searchResultsToPeople([
        {
          id: 525,
          media_type: 'person',
          name: 'Нолан',
          profile_path: '/n.jpg',
        },
        { id: 1, media_type: 'person', name: 'Без фото', profile_path: null },
        { id: 603, media_type: 'movie', title: 'Матрица' },
      ]),
    ).toEqual([
      { id: 'tmdb:person:525', name: 'Нолан', photo: '/api/img/w185/n.jpg' },
    ])
  })

  it('фильмография по ролям: сначала роль, которой известна персона, внутри — по популярности', () => {
    const dto = personToDto(trimPerson(person))

    expect(
      dto.credits.map(group => [
        group.role,
        group.total,
        group.items.map(item => item.title),
      ]),
    ).toEqual([
      ['directing', 2, ['Интерстеллар', 'Начало']],
      [
        'writing',
        3,
        ['Интерстеллар', 'Начало', 'Тёмный рыцарь: Возрождение легенды'],
      ],
      ['acting', 1, ['Преследование']],
      ['production', 1, ['Мир Дикого Запада']],
    ])
    expect(dto.credits[2]?.items[0]).toEqual({
      id: 'tmdb:movie:11660',
      kind: 'movie',
      title: 'Преследование',
      originalTitle: 'Following',
      year: 1998,
      poster: '/api/img/w342/following.jpg',
      detail: 'Прохожий',
      watched: false,
    })
  })

  it('гостевые серии сериала — после остальных тайтлов роли', () => {
    const dto = personToDto({
      ...person,
      combined_credits: {
        cast: [],
        crew: [
          {
            id: 1431,
            media_type: 'tv',
            name: 'Место преступления',
            poster_path: '/csi.jpg',
            department: 'Directing',
            job: 'Director',
            episode_count: 2,
            popularity: 90,
          },
          {
            id: 680,
            media_type: 'movie',
            title: 'Криминальное чтиво',
            poster_path: '/pulp.jpg',
            department: 'Directing',
            job: 'Director',
            popularity: 30,
          },
        ],
      },
    })

    expect(dto.credits[0]?.items.map(item => item.title)).toEqual([
      'Криминальное чтиво',
      'Место преступления',
    ])
  })

  it('без гостевых появлений, тайтлов без постера и чужих должностей', () => {
    const trimmed = trimPerson(person)
    const ids = [
      ...(trimmed.combined_credits?.cast ?? []),
      ...(trimmed.combined_credits?.crew ?? []),
    ].map(credit => credit.id)

    expect(ids).not.toContain(29751)
    expect(ids).not.toContain(7000)
    expect(ids).not.toContain(1000)
    expect(ids).not.toContain(1001)
  })

  it('собирает шапку: фото крупнее, пустые поля — undefined', () => {
    const dto = personToDto(trimPerson(person))

    expect(dto).toMatchObject({
      id: 'tmdb:person:525',
      name: 'Кристофер Нолан',
      photo: '/api/img/w342/nolan.jpg',
      knownFor: 'directing',
      birthday: '1970-07-30',
      deathday: undefined,
      placeOfBirth: 'London, England, UK',
      biography: '',
    })
  })
})
