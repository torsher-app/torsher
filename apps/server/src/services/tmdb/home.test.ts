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
import { emptyList, movieList, trendingAll, tvList } from './fixtures/index.ts'
import { getHomeRows } from './home.ts'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

// Ответ по пути запроса: каждый ряд — свой список TMDB
function respondByPath(bodies: Record<string, unknown>) {
  fetchMock.mockImplementation(async (input) => {
    const { pathname } = new URL(String(input))
    const body = bodies[pathname.replace(/^\/3/, '')]

    return body === undefined ? json({}, 500) : json(body)
  })
}

function requested() {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input)))
}

// Язык в ключе кэша: у каждого теста свой, чтобы не попадать в кэш соседа
let languageIndex = 0

function freshLanguage(region = 'US') {
  languageIndex += 1

  return `${String.fromCharCode(97 + (languageIndex % 26))}${String.fromCharCode(97 + Math.floor(languageIndex / 26))}-${region}`
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

const allLists = {
  '/trending/all/day': trendingAll,
  '/trending/movie/day': movieList,
  '/trending/tv/day': tvList,
  '/movie/popular': movieList,
  '/tv/popular': tvList,
  '/discover/tv': tvList,
  '/movie/now_playing': movieList,
  '/tv/on_the_air': tvList,
  '/movie/top_rated': movieList,
  '/tv/top_rated': tvList,
}

describe('getHomeRows', () => {
  it('собирает главную по порядку, Топ-10 первым', async () => {
    respondByPath(allLists)

    const rows = await getHomeRows('all', 'en-US')

    expect(rows.map(row => row.id)).toEqual([
      'trending',
      'popularMovies',
      'popularSeries',
      'nowPlaying',
      'onTheAir',
      'topRatedMovies',
      'topRatedSeries',
    ])
    expect(rows[0]).toMatchObject({
      kind: 'top10',
      title: 'home.rows.trending',
    })
    expect(rows[1]).toMatchObject({ kind: 'posters' })
  })

  it('русские сериалы — только для ru-RU', async () => {
    respondByPath(allLists)

    const rows = await getHomeRows('series', 'ru-RU')
    const discover = requested().find(
      url => url.pathname === '/3/discover/tv',
    )

    expect(rows.map(row => row.id)).toEqual([
      'trendingSeries',
      'popularSeries',
      'russianSeries',
      'onTheAir',
      'topRatedSeries',
    ])
    expect(discover?.searchParams.get('with_original_language')).toBe('ru')
  })

  it('фильмы — подмножество главной', async () => {
    respondByPath(allLists)

    const rows = await getHomeRows('movies', freshLanguage())

    expect(rows.map(row => row.id)).toEqual([
      'trendingMovies',
      'popularMovies',
      'nowPlaying',
      'topRatedMovies',
    ])
    expect(requested().some(url => url.pathname.startsWith('/3/tv'))).toBe(
      false,
    )
  })

  it('передаёт регион из языка спискам с прокатом', async () => {
    respondByPath(allLists)

    await getHomeRows('movies', freshLanguage('DE'))

    const nowPlaying = requested().find(
      url => url.pathname === '/3/movie/now_playing',
    )
    const trending = requested().find(
      url => url.pathname === '/3/trending/movie/day',
    )

    expect(nowPlaying?.searchParams.get('region')).toBe('DE')
    expect(trending?.searchParams.has('region')).toBe(false)
  })

  it('топ-10 — десять тайтлов, обычный ряд — страница', async () => {
    respondByPath(allLists)

    const rows = await getHomeRows('movies', freshLanguage())

    expect(rows[0]!.items).toHaveLength(10)
    expect(rows[1]!.items).toHaveLength(20)
  })

  it('пропускает персоны и тайтлы без постера', async () => {
    respondByPath(allLists)

    const [trending] = await getHomeRows('all', freshLanguage())

    expect(trending!.items.map(item => item.id)).toEqual([
      'tmdb:movie:603',
      'tmdb:tv:1396',
    ])
  })

  it('не отдаёт пустые ряды и ряды, чей список не загрузился', async () => {
    respondByPath({
      ...allLists,
      '/tv/popular': emptyList,
      '/tv/top_rated': undefined,
    })

    const rows = await getHomeRows('series', freshLanguage())

    expect(rows.map(row => row.id)).toEqual(['trendingSeries', 'onTheAir'])
  })

  it('без токена — ошибка конфигурации', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')

    await expect(getHomeRows('all', freshLanguage())).rejects.toMatchObject({
      kind: 'config',
    })
  })

  it('ничего не загрузилось — unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(getHomeRows('movies', freshLanguage())).rejects.toMatchObject({
      kind: 'unavailable',
    })
  })

  it('повторный запрос отдаёт ряды из кэша', async () => {
    respondByPath(allLists)

    const language = freshLanguage()

    await getHomeRows('movies', language)
    const calls = fetchMock.mock.calls.length

    await getHomeRows('movies', language)

    expect(fetchMock).toHaveBeenCalledTimes(calls)
  })
})
