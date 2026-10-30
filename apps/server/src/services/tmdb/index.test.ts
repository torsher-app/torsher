import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { migrateDb } from '../../db/index.ts'
import { knownImdbIds } from '../ratings/externalIds.ts'
import {
  collection,
  movie,
  movieExtras,
  person,
  searchResponse,
  season,
  seasonEnglish,
  trendingAll,
  tv,
  tvExtras,
} from './fixtures/index.ts'
import {
  getPerson,
  getSeason,
  getTitle,
  getTitleExtras,
  getTrending,
  searchCatalog,
  TmdbError,
  yoVariants,
} from './index.ts'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

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

describe('searchCatalog', () => {
  it('ходит в search/multi с токеном и языком', async () => {
    fetchMock.mockResolvedValue(json(searchResponse))

    const { items, people } = await searchCatalog('Matrix', 'ru-RU')

    const [url, init] = fetchMock.mock.calls[0]!
    const requested = new URL(String(url))

    expect(requested.pathname).toBe('/3/search/multi')
    expect(requested.searchParams.get('query')).toBe('matrix')
    expect(requested.searchParams.get('language')).toBe('ru-RU')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer test-token',
    )
    expect(items.map(item => item.id)).toEqual([
      'tmdb:movie:603',
      'tmdb:tv:1396',
      'tmdb:movie:1000001',
    ])
    // У персоны в ответе нет фото: в ряд «Люди» она не попадает
    expect(people).toEqual([])
  })

  it('повторный запрос отдаёт из кэша без сети', async () => {
    fetchMock.mockResolvedValue(json(searchResponse))

    await searchCatalog('Cached query', 'en-US')
    await searchCatalog('cached query ', 'en-US')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('без токена отвечает ошибкой конфигурации', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')

    await expect(searchCatalog('no token', 'en-US')).rejects.toMatchObject({
      kind: 'config',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ищет и через «е», и через «ё»', async () => {
    const jungle = {
      id: 250001,
      media_type: 'tv',
      name: 'Звёзды в джунглях',
      first_air_date: '2024-09-01',
    }
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(String(url)).searchParams.get('query')

      return json({ results: query === 'звёзды в джунглях' ? [jungle] : [] })
    })

    const { items } = await searchCatalog('Звезды в джунглях', 'ru-RU')

    expect(items.map(item => item.id)).toEqual(['tmdb:tv:250001'])
    expect(
      fetchMock.mock.calls.map(([url]) =>
        new URL(String(url)).searchParams.get('query'),
      ),
    ).toEqual(['звезды в джунглях', 'звёзды в джунглях'])
  })

  it('варианты идут вперемешку без повторов, исходный первым', async () => {
    const result = (id: number) => ({
      id,
      media_type: 'movie',
      title: String(id),
    })
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(String(url)).searchParams.get('query')

      return json({
        results:
          query === 'ёлки' ? [result(1), result(2)] : [result(3), result(1)],
      })
    })

    const { items } = await searchCatalog('Ёлки', 'ru-RU')

    expect(items.map(item => item.id)).toEqual([
      'tmdb:movie:1',
      'tmdb:movie:3',
      'tmdb:movie:2',
    ])
  })

  it('ошибка догадки не роняет поиск', async () => {
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(String(url)).searchParams.get('query')

      return query === 'зеленая'
        ? json(searchResponse)
        : json({ status_message: 'boom' }, 500)
    })

    const { items } = await searchCatalog('зеленая', 'ru-RU')

    expect(items).toHaveLength(3)
  })

  it('сетевая ошибка без кэша — unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const error = await searchCatalog('offline', 'en-US').catch(err => err)

    expect(error).toBeInstanceOf(TmdbError)
    expect(error.kind).toBe('unavailable')
  })
})

describe('yoVariants', () => {
  it('запрос с «ё» дополняет вариантом через «е»', () => {
    expect(yoVariants('зелёная ёлка')).toEqual([
      'зелёная ёлка',
      'зеленая елка',
    ])
  })

  it('пробует «ё» на месте каждой из первых трёх «е»', () => {
    expect(yoVariants('зеленая')).toEqual(['зеленая', 'зёленая', 'зелёная'])
    expect(yoVariants('еееее')).toEqual(['еееее', 'ёееее', 'еёеее', 'ееёее'])
  })

  it('без «е» и «ё» запрос один', () => {
    expect(yoVariants('matrix')).toEqual(['matrix'])
  })
})

describe('getTitle', () => {
  it('не ходит в сеть с чужим ID', async () => {
    expect(await getTitle('603', 'en-US')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отдаёт фильм', async () => {
    fetchMock.mockResolvedValue(json(movie))

    const details = await getTitle('tmdb:movie:603', 'ru-RU')

    const requested = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(requested.pathname).toBe('/3/movie/603')
    expect(requested.searchParams.get('append_to_response')).toBe(
      'images,release_dates',
    )
    expect(requested.searchParams.get('include_image_language')).toBe(
      'ru,null,en',
    )
    expect(details?.title).toBe('Матрица')
  })

  it('у сериала просит IMDb ID вместе с деталями и запоминает его', async () => {
    fetchMock.mockResolvedValue(
      json({
        ...tv,
        id: 1397,
        vote_average: 8.86,
        vote_count: 100,
        external_ids: { imdb_id: 'tt0000303' },
      }),
    )

    const details = await getTitle('tmdb:tv:1397', 'en-US')
    const requested = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(requested.searchParams.get('append_to_response')).toBe(
      'images,content_ratings,external_ids',
    )
    expect(knownImdbIds([{ type: 'tv', tmdbId: 1397 }]).get('tv:1397')).toBe(
      'tt0000303',
    )
    expect(details?.ratings).toEqual([
      { provider: 'tmdb', label: 'TMDB', value: 8.9, votes: 100 },
    ])
  })

  it('берёт описание с en-US, если перевода нет', async () => {
    fetchMock
      .mockResolvedValueOnce(json(tv))
      .mockResolvedValueOnce(json({ ...tv, overview: 'A chemistry teacher.' }))

    const details = await getTitle('tmdb:tv:1396', 'ru-RU')

    expect(details?.overview).toBe('A chemistry teacher.')
    expect(
      new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get('language'),
    ).toBe('en-US')
  })

  it('404 из TMDB — not_found', async () => {
    fetchMock.mockResolvedValue(json({ status_code: 34 }, 404))

    await expect(getTitle('tmdb:movie:999999', 'en-US')).rejects.toMatchObject({
      kind: 'not_found',
    })
  })
})

describe('getSeason', () => {
  it('не ходит в сеть с ID фильма', async () => {
    expect(await getSeason('tmdb:movie:603', 1, 'en-US')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('добирает пустые описания серий с en-US', async () => {
    fetchMock
      .mockResolvedValueOnce(json(season))
      .mockResolvedValueOnce(json(seasonEnglish))

    const result = await getSeason('tmdb:tv:2000', 2, 'ru-RU')

    expect(new URL(String(fetchMock.mock.calls[0]![0])).pathname).toBe(
      '/3/tv/2000/season/2',
    )
    expect(result?.episodes.map(episode => episode.overview)).toEqual([
      'Экипаж просыпается.',
      'Episode 2 in English.',
      'Episode 5 in English.',
    ])
  })

  it('без английской версии отдаёт серии как есть', async () => {
    fetchMock
      .mockResolvedValueOnce(json(season))
      .mockRejectedValueOnce(new TypeError('fetch failed'))

    const result = await getSeason('tmdb:tv:2001', 2, 'ru-RU')

    expect(result?.episodes[1]?.overview).toBe('')
  })
})

describe('getTitleExtras', () => {
  const noneWatched = () => new Set<string>()
  const franchiseExtras = {
    ...movieExtras,
    belongs_to_collection: { id: 2344, name: 'Матрица (Коллекция)' },
  }

  it('просит актёров, рекомендации и названия одним запросом и кэширует урезанное', async () => {
    fetchMock.mockResolvedValue(json(tvExtras))

    const extras = await getTitleExtras('tmdb:tv:2000', 'ru-RU', noneWatched)
    const again = await getTitleExtras('tmdb:tv:2000', 'ru-RU', noneWatched)

    const requested = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(requested.pathname).toBe('/3/tv/2000')
    expect(requested.searchParams.get('append_to_response')).toBe(
      'aggregate_credits,recommendations,alternative_titles,keywords',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(extras?.cast).toHaveLength(20)
    expect(again).toEqual(extras)
  })

  it('без рекомендаций берёт похожие', async () => {
    fetchMock
      .mockResolvedValueOnce(json(movieExtras))
      .mockResolvedValueOnce(json(trendingAll))

    const extras = await getTitleExtras('tmdb:movie:603', 'en-US', noneWatched)

    expect(new URL(String(fetchMock.mock.calls[1]![0])).pathname).toBe(
      '/3/movie/603/similar',
    )
    expect(extras?.similar.map(card => card.id)).toEqual(['tmdb:tv:1396'])
  })

  it('части франшизы фильма — одним запросом коллекции, с отметками и кэшем', async () => {
    fetchMock.mockImplementation(async url =>
      new URL(String(url)).pathname === '/3/collection/2344'
        ? json(collection)
        : json(franchiseExtras),
    )

    const watched = vi.fn(() => new Set(['tmdb:movie:603']))
    const extras = await getTitleExtras('tmdb:movie:604', 'ru-RU', watched)

    await getTitleExtras('tmdb:movie:605', 'ru-RU', watched)

    const collectionCalls = fetchMock.mock.calls.filter(
      ([url]) => new URL(String(url)).pathname === '/3/collection/2344',
    )

    expect(collectionCalls).toHaveLength(1)
    expect(
      new URL(String(collectionCalls[0]![0])).searchParams.get('language'),
    ).toBe('ru-RU')
    expect(
      extras?.franchise.map(part => [part.id, part.current, part.watched]),
    ).toEqual([
      ['tmdb:movie:603', false, true],
      ['tmdb:movie:604', true, false],
      ['tmdb:movie:605', false, false],
      ['tmdb:movie:624860', false, false],
    ])
    expect(extras?.franchise[0]?.ratings?.[0]?.provider).toBe('tmdb')
  })

  it('части франшизы не повторяются в «Похожем»', async () => {
    fetchMock.mockImplementation(async url =>
      new URL(String(url)).pathname === '/3/collection/2346'
        ? json({ ...collection, id: 2346 })
        : json({
            ...franchiseExtras,
            belongs_to_collection: { id: 2346, name: 'Матрица' },
            recommendations: {
              results: [
                ...collection.parts.slice(0, 2),
                ...trendingAll.results,
              ],
            },
          }),
    )

    const extras = await getTitleExtras('tmdb:movie:604', 'en-US', noneWatched)
    const parts = new Set(extras?.franchise.map(part => part.id))

    expect(extras?.similar.length).toBeGreaterThan(0)
    expect(extras?.similar.some(card => parts.has(card.id))).toBe(false)
  })

  it('сбой коллекции — карточка без франшизы', async () => {
    // Своя коллекция: ответ 2344 уже лежит в кэше от прошлого теста
    fetchMock.mockImplementation(async url =>
      new URL(String(url)).pathname === '/3/collection/2345'
        ? json({ status_message: 'boom' }, 500)
        : json({
            ...franchiseExtras,
            belongs_to_collection: { id: 2345, name: 'Другая' },
          }),
    )

    const extras = await getTitleExtras('tmdb:movie:606', 'ru-RU', noneWatched)

    expect(extras?.franchise).toEqual([])
    expect(extras?.cast.length).toBeGreaterThan(0)
  })

  it('у сериала франшизу не запрашивает', async () => {
    fetchMock.mockResolvedValue(
      json({ ...tvExtras, belongs_to_collection: { id: 1, name: 'x' } }),
    )

    const extras = await getTitleExtras('tmdb:tv:2001', 'ru-RU', noneWatched)

    expect(extras?.franchise).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('getPerson', () => {
  it('один запрос с фильмографией, пустая биография — с en-US, отметки — от вызывающего', async () => {
    fetchMock.mockImplementation(async (url) => {
      const requested = new URL(String(url))

      return requested.searchParams.get('language') === 'en-US'
        ? json({ ...person, biography: ' Director. ' })
        : json(person)
    })

    const watched = vi.fn(() => new Set(['tmdb:movie:27205']))
    const dto = await getPerson('tmdb:person:525', 'ru-RU', watched)
    const first = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(first.pathname).toBe('/3/person/525')
    expect(first.searchParams.get('append_to_response')).toBe(
      'combined_credits',
    )
    expect(
      new URL(String(fetchMock.mock.calls[1]![0])).searchParams.has(
        'append_to_response',
      ),
    ).toBe(false)
    expect(dto?.biography).toBe('Director.')
    expect(watched).toHaveBeenCalledWith(
      expect.arrayContaining(['tmdb:movie:27205', 'tmdb:tv:60625']),
    )
    expect(
      dto?.credits[0]?.items.map(item => [item.title, item.watched]),
    ).toEqual([
      ['Интерстеллар', false],
      ['Начало', true],
    ])

    await getPerson('tmdb:person:525', 'ru-RU', watched)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('не персона — undefined без запроса', async () => {
    expect(
      await getPerson('tmdb:movie:603', 'ru-RU', () => new Set()),
    ).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('getTrending', () => {
  it('берёт тренд дня с постерами', async () => {
    fetchMock.mockResolvedValue(json(trendingAll))

    const items = await getTrending('en-US')

    expect(new URL(String(fetchMock.mock.calls[0]![0])).pathname).toBe(
      '/3/trending/all/day',
    )
    expect(items.map(item => item.id)).toEqual([
      'tmdb:movie:603',
      'tmdb:tv:1396',
    ])
  })
})
