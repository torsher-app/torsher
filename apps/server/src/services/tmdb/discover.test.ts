import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { catalogDiscoverQuery } from '../../dto/catalog.ts'
import { migrateDb } from '../../db/index.ts'
import {
  dateOf,
  discoverRequest,
  discoverTitles,
  getGenres,
  MAX_PAGES,
  MIN_VOTES,
} from './discover.ts'
import { discoverPage, movieGenres } from './fixtures/index.ts'

const TODAY = '2026-10-23'

describe('discoverRequest', () => {
  it.each([
    ['movies', '/discover/movie', {}],
    ['series', '/discover/tv', {}],
    ['cartoons', '/discover/movie', { with_genres: '16' }],
    ['cartoonSeries', '/discover/tv', { with_genres: '16' }],
    [
      'anime',
      '/discover/tv',
      { with_genres: '16', with_original_language: 'ja' },
    ],
  ] as const)('тип %s', (type, path, params) => {
    expect(discoverRequest({ type }, TODAY)).toEqual({
      path,
      media: path.endsWith('movie') ? 'movie' : 'tv',
      params: { sort_by: 'popularity.desc', ...params },
    })
  })

  it('жанр добавляется к жанру типа через И, без повтора', () => {
    expect(
      discoverRequest({ type: 'cartoons', genre: '35' }, TODAY)?.params.with_genres,
    ).toBe('16,35')
    expect(
      discoverRequest({ type: 'cartoons', genre: '16' }, TODAY)?.params.with_genres,
    ).toBe('16')
  })

  it('язык аниме задан типом', () => {
    expect(
      discoverRequest({ type: 'anime', originalLanguage: 'ko' }, TODAY)?.params.with_original_language,
    ).toBe('ja')
  })

  it('год и десятилетие — по дате фильма или первого эфира', () => {
    expect(
      discoverRequest({ type: 'movies', year: 2024 }, TODAY)?.params,
    ).toMatchObject({ primary_release_year: '2024' })
    expect(
      discoverRequest({ type: 'series', decade: 1990 }, TODAY)?.params,
    ).toMatchObject({
      'first_air_date.gte': '1990-01-01',
      'first_air_date.lte': '1999-12-31',
    })
  })

  it('рейтинг и сортировка по оценке — с порогом голосов', () => {
    expect(
      discoverRequest({ type: 'movies', rating: 7 }, TODAY)?.params,
    ).toMatchObject({
      'vote_average.gte': '7',
      'vote_count.gte': String(MIN_VOTES),
      'sort_by': 'popularity.desc',
    })
    expect(
      discoverRequest({ type: 'series', sort: 'rating' }, TODAY)?.params,
    ).toMatchObject({
      'sort_by': 'vote_average.desc',
      'vote_count.gte': String(MIN_VOTES),
    })
  })

  it('«новые» — не позже сегодня, десятилетие в прошлом не расширяется', () => {
    expect(
      discoverRequest({ type: 'movies', sort: 'date' }, TODAY)?.params,
    ).toMatchObject({
      'sort_by': 'primary_release_date.desc',
      'primary_release_date.lte': TODAY,
    })
    expect(
      discoverRequest({ type: 'movies', sort: 'date', decade: 1980 }, TODAY)
        ?.params['primary_release_date.lte'],
    ).toBe('1989-12-31')
  })

  it('страна, keyword и студия', () => {
    expect(
      discoverRequest(
        {
          type: 'movies',
          country: 'KR',
          keyword: '9882',
          studio: 'company:41077',
        },
        TODAY,
      )?.params,
    ).toMatchObject({
      with_origin_country: 'KR',
      with_keywords: '9882',
      with_companies: '41077',
    })
    expect(
      discoverRequest({ type: 'series', studio: 'network:49' }, TODAY)?.params,
    ).toMatchObject({ with_networks: '49' })
  })

  it('канал у фильма — не запрос', () => {
    expect(
      discoverRequest({ type: 'cartoons', studio: 'network:49' }, TODAY),
    ).toBeUndefined()
  })
})

describe('catalogDiscoverQuery', () => {
  it('год и десятилетие вместе — ошибка', () => {
    expect(
      catalogDiscoverQuery.safeParse({ year: '2020', decade: '2020' }).success,
    ).toBe(false)
  })

  it.each([
    { decade: '1995' },
    { page: '501' },
    { studio: '49' },
    { country: 'ru' },
  ])('отклоняет %o', (query) => {
    expect(catalogDiscoverQuery.safeParse(query).success).toBe(false)
  })
})

describe('discoverTitles и getGenres', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeAll(async () => {
    await migrateDb()
  })

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('отдаёт страницу, страниц не больше предела, кэширует', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(discoverPage), { status: 200 }),
    )

    const query = catalogDiscoverQuery.parse({
      type: 'movies',
      genre: '878',
      page: '2',
      language: 'ru-RU',
    })
    const page = await discoverTitles(query)

    expect(page).toMatchObject({
      page: 2,
      totalPages: MAX_PAGES,
      total: 24000,
    })
    expect(page?.items.map(item => item.id)).toEqual([
      'tmdb:movie:603',
      'tmdb:movie:604',
    ])

    const url = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(url.pathname).toBe('/3/discover/movie')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      with_genres: '878',
      page: '2',
      language: 'ru-RU',
      include_adult: 'false',
    })

    await discoverTitles(query)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('дата в запросе «новых» — сегодняшняя', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(discoverPage), { status: 200 }),
    )

    const now = new Date('2026-10-23T22:00:00Z')

    await discoverTitles(
      catalogDiscoverQuery.parse({ type: 'series', sort: 'date' }),
      now,
    )

    const url = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(url.searchParams.get('first_air_date.lte')).toBe(dateOf(now))
  })

  it('жанры по алфавиту с заглавной, без жанра типа', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(movieGenres), { status: 200 }),
    )

    expect(await getGenres('movies', 'xx-RU')).toEqual([
      { id: '28', name: 'Боевик' },
      { id: '35', name: 'Комедия' },
      { id: '16', name: 'Мультфильм' },
    ])
    expect(await getGenres('cartoons', 'xx-RU')).toEqual([
      { id: '28', name: 'Боевик' },
      { id: '35', name: 'Комедия' },
    ])
    expect(new URL(String(fetchMock.mock.calls[0]![0])).pathname).toBe(
      '/3/genre/movie/list',
    )
  })
})
