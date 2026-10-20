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
import {
  movie,
  movieExtras,
  searchResponse,
  season,
  seasonEnglish,
  trendingAll,
  tv,
  tvExtras,
} from './fixtures/index.ts'
import {
  getSeason,
  getTitle,
  getTitleExtras,
  getTrending,
  searchTitles,
  TmdbError,
} from './index.ts'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

beforeAll(() => {
  migrateDb()
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

describe('searchTitles', () => {
  it('ходит в search/multi с токеном и языком', async () => {
    fetchMock.mockResolvedValue(json(searchResponse))

    const items = await searchTitles('Matrix', 'ru-RU')

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
  })

  it('повторный запрос отдаёт из кэша без сети', async () => {
    fetchMock.mockResolvedValue(json(searchResponse))

    await searchTitles('Cached query', 'en-US')
    await searchTitles('cached query ', 'en-US')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('без токена отвечает ошибкой конфигурации', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')

    await expect(searchTitles('no token', 'en-US')).rejects.toMatchObject({
      kind: 'config',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('сетевая ошибка без кэша — unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const error = await searchTitles('offline', 'en-US').catch(err => err)

    expect(error).toBeInstanceOf(TmdbError)
    expect(error.kind).toBe('unavailable')
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
  it('просит актёров, рекомендации и названия одним запросом и кэширует урезанное', async () => {
    fetchMock.mockResolvedValue(json(tvExtras))

    const extras = await getTitleExtras('tmdb:tv:2000', 'ru-RU')
    const again = await getTitleExtras('tmdb:tv:2000', 'ru-RU')

    const requested = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(requested.pathname).toBe('/3/tv/2000')
    expect(requested.searchParams.get('append_to_response')).toBe(
      'aggregate_credits,recommendations,alternative_titles',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(extras?.cast).toHaveLength(20)
    expect(again).toEqual(extras)
  })

  it('без рекомендаций берёт похожие', async () => {
    fetchMock
      .mockResolvedValueOnce(json(movieExtras))
      .mockResolvedValueOnce(json(trendingAll))

    const extras = await getTitleExtras('tmdb:movie:603', 'en-US')

    expect(new URL(String(fetchMock.mock.calls[1]![0])).pathname).toBe(
      '/3/movie/603/similar',
    )
    expect(extras?.similar.map(card => card.id)).toEqual(['tmdb:tv:1396'])
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
