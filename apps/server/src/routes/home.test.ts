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
import { movieList } from '../services/tmdb/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()

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

describe('get /home', () => {
  it('отвечает 401 без cookie', async () => {
    const res = await app.inject({ url: '/home' })

    expect(res.statusCode).toBe(401)
  })

  it.each(['?mode=library', '?language=russian'])(
    'отвечает 400 на %s',
    async (search) => {
      const res = await app.inject({
        url: `/home${search}`,
        cookies: authed(),
      })

      expect(res.statusCode).toBe(400)
    },
  )

  it('отдаёт ряды с ключами строк и карточками', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify(movieList)),
    )

    const res = await app.inject({
      url: '/home?mode=movies&language=ru-RU',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)

    const { rows } = res.json()

    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({
      id: 'trendingMovies',
      kind: 'top10',
      title: 'home.rows.trendingMovies',
    })
    expect(rows[0].items[0]).toEqual({
      id: 'tmdb:movie:100',
      kind: 'movie',
      title: 'Фильм 1',
      originalTitle: 'Movie 1',
      year: 2024,
      poster: '/img/w342/movie1.jpg',
    })
  })

  it('отвечает 503 без токена TMDB', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')

    const res = await app.inject({
      url: '/home?language=fr-FR',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(503)
  })

  it('отвечает 502, если TMDB недоступен и кэша нет', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const res = await app.inject({
      url: '/home?mode=series&language=it-IT',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(502)
  })
})
