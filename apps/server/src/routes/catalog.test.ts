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
import { migrateDb } from '../db/index.ts'
import { movie, searchResponse } from '../services/tmdb/fixtures/index.ts'
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

describe('get /catalog/search', () => {
  it('отвечает 401 без cookie', async () => {
    const res = await app.inject({ url: '/catalog/search?query=matrix' })

    expect(res.statusCode).toBe(401)
  })

  it.each(['', '?query=', '?query=%20%20', '?query=x&language=russian'])(
    'отвечает 400 на %s',
    async (search) => {
      const res = await app.inject({
        url: `/catalog/search${search}`,
        cookies: authed(),
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toHaveProperty('message')
    },
  )

  it('отдаёт карточки без персон', async () => {
    fetchMock.mockResolvedValue(json(searchResponse))

    const res = await app.inject({
      url: '/catalog/search?query=matrix&language=ru-RU',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().items).toHaveLength(3)
    expect(res.json().items[0]).toMatchObject({
      id: 'tmdb:movie:603',
      poster: '/img/w342/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
    })
  })

  it('отвечает 503 без токена TMDB', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')

    const res = await app.inject({
      url: '/catalog/search?query=no-token',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(503)
  })

  it('отвечает 502, если TMDB недоступен и кэша нет', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const res = await app.inject({
      url: '/catalog/search?query=offline',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(502)
  })
})

describe('get /catalog/titles/:id', () => {
  it('отвечает 401 без cookie', async () => {
    const res = await app.inject({ url: '/catalog/titles/tmdb:movie:603' })

    expect(res.statusCode).toBe(401)
  })

  it('отвечает 404 на неизвестный ID', async () => {
    const res = await app.inject({
      url: '/catalog/titles/unknown',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отвечает 404, если тайтла нет в TMDB', async () => {
    fetchMock.mockResolvedValue(json({ status_code: 34 }, 404))

    const res = await app.inject({
      url: '/catalog/titles/tmdb:movie:999999',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(404)
  })

  it('отдаёт карточку тайтла', async () => {
    fetchMock.mockResolvedValue(json(movie))

    const res = await app.inject({
      url: `/catalog/titles/${encodeURIComponent('tmdb:movie:603')}?language=ru-RU`,
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
