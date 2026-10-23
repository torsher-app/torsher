import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { titleProgress, users } from '../db/schema.ts'
import { defaultProfile } from '../services/profiles/index.ts'
import {
  movie,
  movieExtras,
  person,
  searchResponse,
  season,
  trendingAll,
} from '../services/tmdb/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function authed() {
  return { [ACCESS_TOKEN_COOKIE]: signToken('user-1', 'user_access') }
}

beforeAll(() => {
  migrateDb()
  // Сессию проверяют по аккаунту в базе (версия сессий)
  getDb()
    .insert(users)
    .values({
      id: 'user-1',
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'hash',
    })
    .run()
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

describe('get /api/catalog/search', () => {
  it('отвечает 401 без cookie', async () => {
    const res = await app.inject({ url: '/api/catalog/search?query=matrix' })

    expect(res.statusCode).toBe(401)
  })

  it.each(['', '?query=', '?query=%20%20', '?query=x&language=russian'])(
    'отвечает 400 на %s',
    async (search) => {
      const res = await app.inject({
        url: `/api/catalog/search${search}`,
        cookies: authed(),
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toHaveProperty('message')
    },
  )

  it('отдаёт карточки без персон', async () => {
    fetchMock.mockResolvedValue(json(searchResponse))

    const res = await app.inject({
      url: '/api/catalog/search?query=matrix&language=ru-RU',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().items).toHaveLength(3)
    expect(res.json().people).toEqual([])
    expect(res.json().items[0]).toMatchObject({
      id: 'tmdb:movie:603',
      poster: '/api/img/w342/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
    })
  })

  it('отвечает 503 без токена TMDB', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')

    const res = await app.inject({
      url: '/api/catalog/search?query=no-token',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(503)
  })

  it('отвечает 502, если TMDB недоступен и кэша нет', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const res = await app.inject({
      url: '/api/catalog/search?query=offline',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(502)
  })
})

describe('get /api/catalog/titles/:id', () => {
  it('отвечает 401 без cookie', async () => {
    const res = await app.inject({ url: '/api/catalog/titles/tmdb:movie:603' })

    expect(res.statusCode).toBe(401)
  })

  it('отвечает 404 на неизвестный ID', async () => {
    const res = await app.inject({
      url: '/api/catalog/titles/unknown',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отвечает 404, если тайтла нет в TMDB', async () => {
    fetchMock.mockResolvedValue(json({ status_code: 34 }, 404))

    const res = await app.inject({
      url: '/api/catalog/titles/tmdb:movie:999999',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(404)
  })

  it('отдаёт карточку тайтла', async () => {
    fetchMock.mockResolvedValue(json(movie))

    const res = await app.inject({
      url: `/api/catalog/titles/${encodeURIComponent('tmdb:movie:603')}?language=ru-RU`,
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: 'tmdb:movie:603',
      title: 'Матрица',
      runtime: 136,
      genres: ['боевик', 'фантастика'],
    })
  })
})

describe('get /api/catalog/titles/:id/seasons/:number', () => {
  const url = (id: string, number: string) =>
    `/api/catalog/titles/${encodeURIComponent(id)}/seasons/${number}`

  it('отвечает 401 без cookie', async () => {
    const res = await app.inject({ url: url('tmdb:tv:2000', '1') })

    expect(res.statusCode).toBe(401)
  })

  it.each(['0', '01', '1000', 'x'])(
    'отвечает 400 на сезон %s',
    async (number) => {
      const res = await app.inject({
        url: url('tmdb:tv:2000', number),
        cookies: authed(),
      })

      expect(res.statusCode).toBe(400)
    },
  )

  it('отвечает 404 на сезон фильма', async () => {
    const res = await app.inject({
      url: url('tmdb:movie:603', '1'),
      cookies: authed(),
    })

    expect(res.statusCode).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отвечает 404, если сезона нет в TMDB', async () => {
    fetchMock.mockResolvedValue(json({ status_code: 34 }, 404))

    const res = await app.inject({
      url: url('tmdb:tv:2000', '9'),
      cookies: authed(),
    })

    expect(res.statusCode).toBe(404)
  })

  it('отдаёт серии сезона', async () => {
    fetchMock.mockResolvedValue(json(season))

    const res = await app.inject({
      url: `${url('tmdb:tv:2000', '2')}?language=en-US`,
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ number: 2, name: 'Сезон 2' })
    expect(res.json().episodes).toHaveLength(3)
  })
})

describe('get /api/catalog/titles/:id/extras', () => {
  it('отвечает 401 без cookie', async () => {
    const res = await app.inject({
      url: '/api/catalog/titles/tmdb:movie:603/extras',
    })

    expect(res.statusCode).toBe(401)
  })

  it('отвечает 404 на неизвестный ID', async () => {
    const res = await app.inject({
      url: '/api/catalog/titles/unknown/extras',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(404)
  })

  it('отдаёт актёров, похожее и названия', async () => {
    fetchMock
      .mockResolvedValueOnce(json(movieExtras))
      .mockResolvedValueOnce(json({ results: [] }))

    const res = await app.inject({
      url: `/api/catalog/titles/${encodeURIComponent('tmdb:movie:603')}/extras`,
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      similar: [],
      aka: ['Matrix'],
      directors: ['Lilly Wachowski', 'Lana Wachowski'],
    })
    expect(res.json().cast).toHaveLength(2)
  })
})

describe('get /api/catalog/people/:id', () => {
  it('отвечает 404 на ID не персоны', async () => {
    const res = await app.inject({
      url: `/api/catalog/people/${encodeURIComponent('tmdb:movie:603')}`,
      cookies: authed(),
    })

    expect(res.statusCode).toBe(404)
  })

  it('отмечает тайтлы, которые профиль смотрел', async () => {
    getDb()
      .insert(titleProgress)
      .values({
        profileId: defaultProfile().id,
        titleId: 'tmdb:movie:157336',
        season: 0,
        episode: 0,
        position: 600,
      })
      .run()
    fetchMock.mockResolvedValue(json({ ...person, biography: 'Режиссёр.' }))

    const res = await app.inject({
      url: `/api/catalog/people/${encodeURIComponent('tmdb:person:525')}?language=ru-RU`,
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      name: 'Кристофер Нолан',
      biography: 'Режиссёр.',
      credits: [
        {
          role: 'directing',
          total: 2,
          items: [
            { id: 'tmdb:movie:157336', watched: true },
            { id: 'tmdb:movie:27205', watched: false },
          ],
        },
        { role: 'writing' },
        { role: 'acting' },
        { role: 'production' },
      ],
    })
  })
})

describe('get /api/catalog/trending', () => {
  it('отвечает 401 без cookie', async () => {
    const res = await app.inject({ url: '/api/catalog/trending' })

    expect(res.statusCode).toBe(401)
  })

  it('отдаёт тренды дня', async () => {
    fetchMock.mockResolvedValue(json(trendingAll))

    const res = await app.inject({
      url: '/api/catalog/trending?language=ru-RU',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().items).toHaveLength(2)
  })
})

describe('get /api/catalog/backdrops', () => {
  it('отвечает 401 без cookie', async () => {
    const res = await app.inject({ url: '/api/catalog/backdrops' })

    expect(res.statusCode).toBe(401)
  })

  it('отдаёт кадры тренда дня, тайтлы без бэкдропа пропускает', async () => {
    const [first, ...rest] = trendingAll.results

    fetchMock.mockResolvedValue(
      json({
        ...trendingAll,
        results: [{ ...first, backdrop_path: '/matrix.jpg' }, ...rest],
      }),
    )

    // Язык не как в тесте трендов: у того же списка в кэше нет бэкдропов
    const res = await app.inject({
      url: '/api/catalog/backdrops?language=en-US',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().items).toEqual([
      {
        id: 'tmdb:movie:603',
        title: 'Матрица',
        year: 1999,
        backdrop: '/api/img/w1280/matrix.jpg',
      },
    ])
  })
})
