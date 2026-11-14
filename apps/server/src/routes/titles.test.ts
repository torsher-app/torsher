import { deleteSetting, setSetting } from '../services/settings/index.ts'
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
import { saveFollowSettings } from '../services/follow/settings.ts'
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

beforeAll(async () => {
  await migrateDb()
  // Сессию проверяют по аккаунту в базе (версия сессий)
  getDb()
    .insert(users)
    .values({
      id: 'user-1',
      username: 'Owner',
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
  // These fixtures exercise Russian studio continuity explicitly.
  setSetting('sources.profile', {
    qualities: ['1080p', '2160p', '720p', 'SD'],
    audioLanguages: ['ru'],
    voiceTypes: ['D', 'MVO', 'DVO', 'AVO', 'VO', 'L'],
  })
  clearSearchCache()
  getDb()
    .update(indexers)
    .set({ backoffUntil: null, backoffSince: null, failureCount: 0 })
    .run()
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
  it('явное 1080p сильнее UHD без infohash при поиске и чтении кэша', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      new URL(String(input)).hostname === 'a.indexer.example'
        ? new Response(
            searchXml
              .replace('WEB-DL 1080p', 'UHD BDRip 1080p')
              .replace(/<torznab:attr name="infohash"[^>]*\/>/, ''),
          )
        : original(input, init),
    )
    const url = '/api/titles/tmdb:tv:101/sources?season=2'
    const first = await app.inject({ url, cookies: authed() })
    const count = fetchMock.mock.calls.length
    const cached = await app.inject({ url, cookies: authed() })

    expect(fetchMock).toHaveBeenCalledTimes(count)
    for (const response of [first, cached]) {
      expect(response.statusCode).toBe(200)
      expect(response.json().candidates[0]).toMatchObject({
        id: first.json().candidates[0].id,
        quality: '1080p',
        resolution: { value: '1080p', basis: 'title', sure: true },
        torrentId: null,
      })
      expect(response.json().voices[0].maxQuality).toBe('1080p')
    }
  })

  it.each(['de', 'ja', 'original', 'ru'])(
    'uses preset audio %s when ranking cached sources',
    async (audio) => {
      const original = fetchMock.getMockImplementation()!
      const tag = { de: 'GER', ja: 'JPN', original: 'ENG', ru: 'RUS' }[audio]!
      fetchMock.mockImplementation(async (input, init) =>
        new URL(String(input)).hostname === 'a.indexer.example'
          ? new Response(
              searchXml
                .replace(' | LostFilm', ` | ${tag}`)
                .replace('S02E05.2160p', 'S02E05.1080p')
                .replace('H.265-GRP', 'H.265.FRE-GRP'),
            )
          : original(input, init),
      )
      const patch = await app.inject({
        method: 'PATCH',
        url: '/api/settings/sources/presets/default-1080p',
        cookies: authed(),
        payload: { audioLanguages: [audio], voiceTypes: [] },
      })
      expect(patch.statusCode).toBe(200)
      const result = (
        await app.inject({
          url: '/api/titles/tmdb:tv:101/sources?season=2&presetId=default-1080p',
          cookies: authed(),
        })
      ).json()
      expect(result.audio).toBe(audio)
      expect(result.candidates[0].title).toContain(tag)
      if (audio !== 'ru') {
        expect(result.pinnedVoice).toBeNull()
        expect(result.voices).toEqual([])
      }
    },
  )

  it('пересортировывает кэш по выбранному пресету, наследует дефолт и заменяет удалённый', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      const response = await original(input, init)
      return new URL(String(input)).hostname === 'a.indexer.example'
        ? new Response(
            searchXml
              .replace(' | LostFilm', '')
              .replace('name="seeders" value="7"', 'name="seeders" value="42"'),
          )
        : response
    })
    const url = '/api/titles/tmdb:tv:101/sources?season=2'
    const initial = (await app.inject({ url, cookies: authed() })).json()
    const searches = requested.length
    const chosen = (
      await app.inject({ url: `${url}&presetId=default-4k`, cookies: authed() })
    ).json()
    expect(initial.candidates[0].quality).toBe('1080p')
    expect(chosen.candidates[0].quality).toBe('2160p')
    expect(chosen.presets).toMatchObject({
      defaultId: 'default-1080p',
      effectiveId: 'default-4k',
    })
    expect(requested.length).toBe(searches)
    expect(
      (await app.inject({ url, cookies: authed() })).json().presets.effectiveId,
    ).toBe('default-1080p')
    await app.inject({
      method: 'PUT',
      url: '/api/settings/sources',
      cookies: authed(),
      payload: { defaultPresetId: 'default-4k' },
    })
    await app.inject({
      method: 'DELETE',
      url: '/api/settings/sources/presets/default-1080p',
      cookies: authed(),
    })
    const fallback = (
      await app.inject({
        url: `${url}&presetId=default-1080p`,
        cookies: authed(),
      })
    ).json()
    expect(fallback.presets.effectiveId).toBe('default-4k')
    expect(fallback.profile.qualities[0]).toBe('2160p')
    expect(
      (await app.inject({ url, cookies: authed() })).json().presets.effectiveId,
    ).toBe('default-4k')
    expect(requested.length).toBe(searches)
  })

  it('показывает сохранённый профиль на кэшированной выдаче без нового поиска', async () => {
    const url = '/api/titles/tmdb:tv:101/sources?season=2'
    const initial = await app.inject({ url, cookies: authed() })
    const searches = requested.length
    const qualities = ['2160p', '720p', '1080p', 'SD']
    const voiceTypes = ['MVO', 'D', 'DVO', 'AVO', 'VO', 'L']
    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/settings/sources/presets/default-1080p',
      cookies: authed(),
      payload: { qualities, voiceTypes },
    })
    expect(saved.statusCode).toBe(200)
    const changed = await app.inject({ url, cookies: authed() })
    expect(changed.statusCode).toBe(200)
    expect(changed.json().profile).toEqual({
      qualities,
      voiceTypes,
      audioLanguages: ['ru'],
    })
    expect(changed.json().updatedAt).toBe(initial.json().updatedAt)
    expect(requested.length).toBe(searches)
  })

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
    expect(body.audio).toBe('ru')
    expect(body.candidates[0].audioFit).toBeNull()
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

  it('индексатор после ошибки пропускается до конца паузы и считается не ответившим', async () => {
    const url = '/api/titles/tmdb:tv:101/sources?season=2&refresh=1'

    await app.inject({ url, cookies: authed() })
    requested.length = 0

    const body = (await app.inject({ url, cookies: authed() })).json()

    expect(
      requested.some(item => item.hostname === 'b.indexer.example'),
    ).toBe(false)
    expect(body.candidates).toHaveLength(2)
    expect(body.indexers).toEqual({
      total: 2,
      failed: [{ name: 'Indexer B', kind: 'skipped' }],
    })
  })

  it('на паузе все индексаторы — спрашиваем всех', async () => {
    getDb()
      .update(indexers)
      .set({ backoffUntil: new Date(Date.now() + 60_000), failureCount: 1 })
      .run()

    const body = (
      await app.inject({
        url: '/api/titles/tmdb:tv:101/sources?season=2',
        cookies: authed(),
      })
    ).json()

    expect(
      requested.some(item => item.hostname === 'a.indexer.example'),
    ).toBe(true)
    expect(body.candidates).toHaveLength(2)
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

  it('поиск зрителя добавляет ровно один точный запрос с годом', async () => {
    const res = await app.inject({
      url: '/api/titles/tmdb:tv:101/sources?all=1',
      cookies: authed(),
    })
    expect(res.statusCode).toBe(200)
    const queries = requested.filter(
      url =>
        url.hostname === 'a.indexer.example'
        && url.searchParams.get('t') === 'search',
    )
    expect(queries.map(url => url.searchParams.get('q'))).toEqual([
      'Тихая гавань 2023',
      'Тихая гавань',
      'Quiet Harbor',
      'tikhaya gavan',
    ])
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

  it('язык озвучки дома не `ru`: ранжирует по нему, без русских студий и фильтра', async () => {
    deleteSetting('sources.profile')
    saveFollowSettings({ audio: { value: 'original', source: 'user' } })

    try {
      const res = await app.inject({
        url: '/api/titles/tmdb:tv:101/sources?season=2',
        cookies: authed(),
      })
      const body = res.json()

      expect(body.audio).toBe('original')
      expect(body.candidates[0]).toMatchObject({
        quality: '2160p',
        voice: null,
        voiceKeys: [],
        audioFit: 'original',
        pickReason: 'profile',
      })
      expect(body.candidates[1]).toMatchObject({
        voice: null,
        voiceKeys: [],
        audioFit: 'foreign',
        audio: [{ studio: 'LostFilm', type: 'MVO' }],
      })
      expect(body.top).toEqual([body.candidates[0].id])
      expect(body.voices).toEqual([])
      expect(body.pinnedVoice).toBeNull()
    }
    finally {
      // Настройки слежения — только язык озвучки: без строки сервер снова не знает языка
      deleteSetting('follow')
    }
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
