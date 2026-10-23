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
import { indexers, users } from '../db/schema.ts'
import { encryptSecret } from '../services/secrets/index.ts'
import { clearSearchCache } from '../services/sources/cache.ts'
import { tvIdentity } from '../services/tmdb/fixtures/index.ts'
import {
  searchXml,
  torznabErrorXml,
} from '../services/torznab/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const requested: URL[] = []

function authed() {
  return { [ACCESS_TOKEN_COOKIE]: signToken('user-1', 'user_access') }
}

const textCaps = {
  search: { available: true, params: ['q'] },
  tvSearch: { available: false, params: [] },
  movieSearch: { available: false, params: [] },
  categories: [{ id: 5000, name: 'TV', subcategories: [] }],
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
  getDb()
    .insert(indexers)
    .values([
      {
        name: 'Indexer A',
        url: 'https://a.indexer.example/torznab',
        apiKey: encryptSecret('secret-key'),
        caps: {
          ...textCaps,
          tvSearch: { available: true, params: ['q', 'season', 'tvdbid'] },
        },
        checkStatus: 'ok',
      },
      {
        name: 'Indexer B',
        url: 'https://b.indexer.example/torznab',
        apiKey: encryptSecret('other-key'),
        caps: textCaps,
        checkStatus: 'ok',
      },
      {
        name: 'Indexer C',
        url: 'https://c.indexer.example/torznab',
        enabled: false,
        caps: textCaps,
      },
    ])
    .run()
})

beforeEach(() => {
  clearSearchCache()
  requested.length = 0
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))

    requested.push(url)

    if (url.hostname === 'api.themoviedb.org')
      return new Response(JSON.stringify(tvIdentity))

    if (url.hostname === 'a.indexer.example')
      return new Response(searchXml)

    return new Response(torznabErrorXml(100, 'Invalid API key'))
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('get /api/titles/:id/sources', () => {
  it('отвечает 401 без входа', async () => {
    const res = await app.inject({ url: '/api/titles/tmdb:tv:101/sources' })

    expect(res.statusCode).toBe(401)
  })

  it('отвечает 404 на ID не из каталога', async () => {
    const res = await app.inject({
      url: '/api/titles/unknown/sources',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(404)
  })

  it('ищет по ID и названиям, отдаёт кандидатов без ссылок и ключей', async () => {
    const res = await app.inject({
      url: '/api/titles/tmdb:tv:101/sources?season=2',
      cookies: authed(),
    })
    const body = res.json()
    const toA = requested.filter(url => url.hostname === 'a.indexer.example')

    expect(res.statusCode).toBe(200)
    expect(toA.map(url => url.searchParams.get('t'))).toEqual([
      'tvsearch',
      'search',
      'search',
      'search',
    ])
    expect(toA[0]!.searchParams.get('tvdbid')).toBe('202')
    expect(toA[0]!.searchParams.get('season')).toBe('2')
    expect(toA.slice(1).map(url => url.searchParams.get('q'))).toEqual([
      'Тихая гавань',
      'Quiet Harbor',
      'tikhaya gavan',
    ])
    expect(requested.some(url => url.hostname === 'c.indexer.example')).toBe(
      false,
    )
    expect(body.season).toBe(2)
    expect(body.candidates).toHaveLength(2)
    expect(body.top).toEqual([body.candidates[0].id])
    expect(body.candidates[0]).toMatchObject({
      quality: '1080p',
      resolution: { value: '1080p', basis: 'title', sure: true },
      voice: { studio: 'LostFilm', type: 'MVO' },
      seeders: 42,
      indexers: ['Indexer A'],
      pickReason: 'profile',
      confidence: 'high',
      subs: [],
      channels: null,
      voiceKeys: ['studio:LostFilm'],
    })
    expect(body.candidates[1]).toMatchObject({ quality: '2160p', voice: null })
    expect(body.voices).toEqual([
      {
        key: 'studio:LostFilm',
        studio: 'LostFilm',
        type: 'MVO',
        maxQuality: '1080p',
        seeders: 42,
        count: 1,
        pinned: false,
      },
    ])
    expect(body.indexers).toEqual({
      total: 2,
      failed: [{ name: 'Indexer B', kind: 'auth' }],
    })
    expect(res.body).not.toMatch(
      /secret-key|other-key|download|btih|1111111111/,
    )
  })

  it('повтор берёт кэш, refresh ищет заново', async () => {
    const url = '/api/titles/tmdb:tv:101/sources?season=2'

    await app.inject({ url, cookies: authed() })
    const searches = requested.length

    await app.inject({ url: `${url}&episode=5`, cookies: authed() })
    expect(requested.length).toBe(searches)

    await app.inject({ url: `${url}&refresh=1`, cookies: authed() })
    expect(requested.length).toBeGreaterThan(searches)
  })

  it('по серии оставляет только раздачи, где она есть', async () => {
    const res = await app.inject({
      url: '/api/titles/tmdb:tv:101/sources?season=2&episode=6',
      cookies: authed(),
    })

    expect(
      res.json().candidates.map((item: { quality: string }) => item.quality),
    ).toEqual(['1080p'])
  })

  it('строка зрителя ищется одна, текстом, и приходит в ответе', async () => {
    const res = await app.inject({
      url: `/api/titles/tmdb:tv:101/sources?all=1&query=${encodeURIComponent('Гавань 2023')}`,
      cookies: authed(),
    })
    const body = res.json()
    const toA = requested.filter(url => url.hostname === 'a.indexer.example')

    expect(res.statusCode).toBe(200)
    expect(
      toA.map(url => [url.searchParams.get('t'), url.searchParams.get('q')]),
    ).toEqual([['search', 'Гавань 2023']])
    expect(body.candidates).toHaveLength(2)
    expect(body.query.current).toBe('Гавань 2023')
    expect(body.query.suggestions).toContain('Тихая гавань')
    expect(body.query.suggestions).toContain('Quiet Harbor')
  })

  it('без строки зрителя запрос в ответе пуст, а её поиск кэшируется отдельно', async () => {
    const url = '/api/titles/tmdb:tv:101/sources?all=1'
    const auto = await app.inject({ url, cookies: authed() })
    const searches = requested.length

    expect(auto.json().query.current).toBeNull()

    await app.inject({ url: `${url}&query=Harbor`, cookies: authed() })
    expect(requested.length).toBeGreaterThan(searches)
  })

  it('400 на пустую строку зрителя', async () => {
    const res = await app.inject({
      url: '/api/titles/tmdb:tv:101/sources?all=1&query=%20',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(400)
  })

  it('400 на неверный сезон', async () => {
    const res = await app.inject({
      url: '/api/titles/tmdb:tv:101/sources?season=0',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('put /api/titles/:id/voice', () => {
  it('закреплённая озвучка даёт причину «как в прошлых сериях»', async () => {
    const pin = await app.inject({
      method: 'PUT',
      url: '/api/titles/tmdb:tv:101/voice',
      cookies: authed(),
      payload: { season: 2, voice: { studio: 'LostFilm' } },
    })

    expect(pin.statusCode).toBe(200)

    const res = await app.inject({
      url: '/api/titles/tmdb:tv:101/sources?season=2',
      cookies: authed(),
    })
    const body = res.json()

    expect(body.pinnedVoice).toEqual({ studio: 'LostFilm' })
    expect(body.candidates[0].pickReason).toBe('pinnedVoice')
    expect(body.voices[0].pinned).toBe(true)

    await app.inject({
      method: 'PUT',
      url: '/api/titles/tmdb:tv:101/voice',
      cookies: authed(),
      payload: { season: 2, voice: null },
    })
  })

  it('404 на ID не из каталога', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/titles/unknown/voice',
      cookies: authed(),
      payload: { season: 1, voice: null },
    })

    expect(res.statusCode).toBe(404)
  })
})
