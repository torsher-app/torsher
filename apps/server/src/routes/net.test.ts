import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, config } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { indexers, netRoutes, serverSettings } from '../db/schema.ts'
import { checkDeps, waitForCheck } from '../services/net/check.ts'
import { refreshImdbRatings } from '../services/ratings/imdb/index.ts'
import { routesChanged } from '../services/net/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
let owner = {}
const PASSWORD = 'proxy-password-1'

function inject(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
) {
  return app.inject({ method, url, payload, cookies: owner })
}

function failure(code: string, name = 'Error') {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error(code), { code, name }),
  })
}

beforeAll(async () => {
  await migrateDb()

  const { id } = createOwner({
    name: 'Owner',
    email: 'owner@example.com',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(id, 'user_access') }
})

beforeEach(() => {
  // Прокси из окружения разработчика меняет маршрут по умолчанию
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'])
    vi.stubEnv(name, '')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  getDb().delete(netRoutes).run()
  getDb().delete(indexers).run()
  getDb().delete(serverSettings).run()
  routesChanged()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('доступ', () => {
  it.each([
    ['GET', '/api/net/routes'],
    ['POST', '/api/net/routes'],
    ['PATCH', '/api/net/routes/x'],
    ['DELETE', '/api/net/routes/x'],
    ['PUT', '/api/net/routes/order'],
    ['GET', '/api/net/dns-providers'],
    ['GET', '/api/net/check'],
    ['POST', '/api/net/check'],
    ['GET', '/api/settings/metadata'],
    ['PUT', '/api/settings/metadata'],
    ['POST', '/api/settings/metadata/check'],
    ['PUT', '/api/settings/metadata/imdb'],
    ['POST', '/api/settings/metadata/imdb/refresh'],
  ] as const)('%s %s: 401 без входа', async (method, url) => {
    const anonymous = await app.inject({ method, url, payload: {} })

    expect(anonymous.statusCode).toBe(401)
  })
})

describe('маршруты', () => {
  it('маршрут по умолчанию есть сразу и не удаляется', async () => {
    const list = (await inject('GET', '/api/net/routes')).json()

    expect(list.items).toEqual([
      expect.objectContaining({
        match: '*',
        isDefault: true,
        via: 'direct',
        dns: 'system',
      }),
    ])

    const removed = await inject(
      'DELETE',
      `/api/net/routes/${list.items[0].id}`,
    )

    expect(removed.statusCode).toBe(422)
    expect(removed.json()).toMatchObject({
      kind: 'default_route',
      field: 'match',
    })

    const renamed = await inject(
      'PATCH',
      `/api/net/routes/${list.items[0].id}`,
      { match: 'example.org' },
    )

    expect(renamed.statusCode).toBe(422)

    const switched = await inject(
      'PATCH',
      `/api/net/routes/${list.items[0].id}`,
      { dns: 'quad9' },
    )

    expect(switched.json()).toMatchObject({ match: '*', dns: 'quad9' })
  })

  it('сохраняет прокси, а учётные данные — только шифртекстом', async () => {
    const created = await inject('POST', '/api/net/routes', {
      match: '*.Indexer.example',
      via: 'socks5h',
      proxy: `socks5://reader:${PASSWORD}@10.0.0.2:1080`,
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      match: '*.indexer.example',
      proxy: '10.0.0.2:1080',
      hasUsername: true,
      hasPassword: true,
      dns: 'system',
    })
    expect(created.body).not.toContain(PASSWORD)
    expect(created.body).not.toContain('reader')

    const row = getDb()
      .select()
      .from(netRoutes)
      .all()
      .find(item => item.match === '*.indexer.example')!

    expect(row.proxyPassword).toMatch(/^v1:/)
    expect(row.proxyPassword).not.toContain(PASSWORD)

    const list = await inject('GET', '/api/net/routes')

    expect(list.body).not.toContain(PASSWORD)

    const cleared = await inject('PATCH', `/api/net/routes/${row.id}`, {
      password: null,
    })

    expect(cleared.json()).toMatchObject({
      hasUsername: true,
      hasPassword: false,
    })
  })

  it.each([
    [{ match: '', via: 'direct' }, 400, undefined],
    [{ match: 'https://indexer.example/api', via: 'direct' }, 422, 'match'],
    [{ match: 'indexer.example', via: 'socks5h' }, 422, 'proxy'],
    [
      { match: 'indexer.example', via: 'socks5h', proxy: '10.0.0.2' },
      422,
      'proxy',
    ],
    [
      { match: 'indexer.example', via: 'socks5h', proxy: '10.0.0.2:70000' },
      422,
      'proxy',
    ],
    [
      {
        match: 'indexer.example',
        via: 'http',
        proxy: 'socks5://10.0.0.2:1080',
      },
      422,
      'proxy',
    ],
    [{ match: 'indexer.example', via: 'direct', dns: 'custom' }, 422, 'dohUrl'],
    [
      {
        match: 'indexer.example',
        via: 'direct',
        dns: 'custom',
        dohUrl: 'http://doh.example/q',
      },
      422,
      'dohUrl',
    ],
    [{ match: 'indexer.example', via: 'tor' }, 400, undefined],
  ])('отклоняет %j', async (payload, status, field) => {
    const res = await inject('POST', '/api/net/routes', payload)

    expect(res.statusCode).toBe(status)

    if (field)
      expect(res.json()).toMatchObject({ field, kind: 'invalid' })
  })

  it('не заводит второй маршрут на тот же хост', async () => {
    await inject('POST', '/api/net/routes', {
      match: 'indexer.example',
      via: 'direct',
    })

    const again = await inject('POST', '/api/net/routes', {
      match: 'INDEXER.example',
      via: 'direct',
    })

    expect(again.statusCode).toBe(422)
    expect(again.json()).toMatchObject({ field: 'match', kind: 'duplicate' })
  })

  it('прямой маршрут забывает прокси', async () => {
    const created = (
      await inject('POST', '/api/net/routes', {
        match: 'indexer.example',
        via: 'http',
        proxy: '10.0.0.2:3128',
        password: PASSWORD,
      })
    ).json()

    const direct = await inject('PATCH', `/api/net/routes/${created.id}`, {
      via: 'direct',
    })

    expect(direct.json()).toMatchObject({
      via: 'direct',
      proxy: null,
      hasPassword: false,
    })
  })

  it('меняет порядок, `*` остаётся последним', async () => {
    const a = (
      await inject('POST', '/api/net/routes', {
        match: 'a.example',
        via: 'direct',
      })
    ).json()
    const b = (
      await inject('POST', '/api/net/routes', {
        match: 'b.example',
        via: 'direct',
      })
    ).json()

    const reordered = await inject('PUT', '/api/net/routes/order', {
      ids: [b.id, a.id],
    })

    expect(
      reordered.json().items.map((item: { match: string }) => item.match),
    ).toEqual(['b.example', 'a.example', '*'])

    const partial = await inject('PUT', '/api/net/routes/order', {
      ids: [b.id],
    })

    expect(partial.statusCode).toBe(400)
  })

  it('показывает прокси из окружения у нетронутого маршрута по умолчанию', async () => {
    vi.stubEnv('https_proxy', 'http://10.0.0.2:3128')

    const [route] = (await inject('GET', '/api/net/routes')).json().items

    expect(route).toMatchObject({ match: '*', envProxy: true })

    const doh = await inject('PATCH', `/api/net/routes/${route.id}`, {
      dns: 'quad9',
    })

    expect(doh.json().envProxy).toBe(false)
  })

  it('отдаёт список DoH-провайдеров', async () => {
    const res = await inject('GET', '/api/net/dns-providers')

    expect(res.json().items.map((item: { id: string }) => item.id)).toEqual([
      'quad9',
      'google',
      'cloudflare',
    ])
  })
})

describe('проверка хостов', () => {
  function stubDns(system: string[], doh: string[]) {
    vi.spyOn(checkDeps, 'systemAddresses').mockResolvedValue(system)
    vi.spyOn(checkDeps, 'dohAddresses').mockResolvedValue(doh)
  }

  async function checkAll() {
    const started = await inject('POST', '/api/net/check', {})

    expect(started.statusCode).toBe(200)
    await waitForCheck()

    return (await inject('GET', '/api/net/check')).json()
  }

  it('проверяет TMDB и ручные индексаторы с маршрутом и задержкой', async () => {
    stubDns(['203.0.113.1'], ['203.0.113.1'])
    getDb()
      .insert(indexers)
      .values({ name: 'Local', url: 'http://indexer.example:9117/torznab' })
      .run()
    fetchMock.mockImplementation(async () => new Response('', { status: 401 }))

    const state = await checkAll()

    expect(state).toMatchObject({ running: false, done: 3, total: 3 })
    expect(state.hosts).toEqual([
      expect.objectContaining({
        host: 'api.themoviedb.org',
        kind: 'tmdb',
        status: 'ok',
        httpStatus: 401,
      }),
      expect.objectContaining({
        host: 'image.tmdb.org',
        kind: 'tmdb_images',
        status: 'ok',
      }),
      expect.objectContaining({
        host: 'indexer.example:9117',
        hostname: 'indexer.example',
        kind: 'indexer',
        label: 'Local',
        route: expect.objectContaining({ match: '*', via: 'direct' }),
        dnsSpoofed: false,
      }),
    ])
    expect(state.hosts[0].latencyMs).toBeGreaterThanOrEqual(0)
  })

  it.each([
    [failure('ENOTFOUND'), 'dns'],
    [failure('EDOHUNAVAILABLE'), 'doh'],
    [failure('UND_ERR_CONNECT_TIMEOUT'), 'timeout'],
    [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), 'timeout'],
    [failure('ECONNREFUSED'), 'refused'],
    [failure('ERR_TLS_CERT_ALTNAME_INVALID'), 'tls'],
    [failure('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), 'tls'],
  ])('статус по ошибке %#: %s', async (error, status) => {
    stubDns(['203.0.113.1'], ['203.0.113.1'])
    fetchMock.mockRejectedValue(error)

    const state = await checkAll()

    expect(state.hosts[0].status).toBe(status)
  })

  it('5xx — статус http', async () => {
    stubDns(['203.0.113.1'], ['203.0.113.1'])
    fetchMock.mockImplementation(async () => new Response('', { status: 503 }))

    const state = await checkAll()

    expect(state.hosts[0]).toMatchObject({ status: 'http', httpStatus: 503 })
  })

  it('подмена DNS: адреса не совпадают и запрос по системному не прошёл', async () => {
    stubDns(['10.10.10.10'], ['203.0.113.1'])
    fetchMock.mockRejectedValue(failure('ERR_TLS_CERT_ALTNAME_INVALID'))

    const state = await checkAll()

    expect(state.hosts[0]).toMatchObject({ status: 'tls', dnsSpoofed: true })
  })

  it('разные адреса CDN при рабочем запросе — не подмена', async () => {
    stubDns(['198.51.100.1'], ['203.0.113.1'])
    fetchMock.mockImplementation(async () => new Response('ok'))

    const state = await checkAll()

    expect(state.hosts[0]).toMatchObject({ status: 'ok', dnsSpoofed: false })
  })

  it('маршрут с DoH: подмена видна по запросу мимо маршрута', async () => {
    stubDns(['10.10.10.10'], ['203.0.113.1'])
    vi.spyOn(checkDeps, 'probeSystem').mockResolvedValue(false)
    await inject('POST', '/api/net/routes', {
      match: '*.themoviedb.org',
      via: 'direct',
      dns: 'cloudflare',
    })
    fetchMock.mockImplementation(async () => new Response('ok'))

    const state = await checkAll()

    expect(state.hosts[0]).toMatchObject({
      status: 'ok',
      dnsSpoofed: true,
      route: expect.objectContaining({
        match: '*.themoviedb.org',
        dns: 'cloudflare',
      }),
    })
    expect(checkDeps.dohAddresses).toHaveBeenCalledWith(
      'https://1.1.1.1/dns-query',
      'api.themoviedb.org',
    )
  })

  it('через прокси DNS не сравнивается', async () => {
    // Хосты вне маршрута через прокси сравнивают DNS: без заглушки тест ушёл бы в сеть
    stubDns(['203.0.113.1'], ['203.0.113.1'])
    const systemAddresses = vi.spyOn(checkDeps, 'systemAddresses')

    await inject('POST', '/api/net/routes', {
      match: 'api.themoviedb.org',
      via: 'socks5h',
      proxy: '10.0.0.2:1080',
    })
    fetchMock.mockRejectedValue(failure('ECONNREFUSED'))

    const state = await checkAll()

    expect(state.hosts[0]).toMatchObject({
      status: 'refused',
      dnsSpoofed: false,
    })
    expect(systemAddresses).not.toHaveBeenCalledWith('api.themoviedb.org')
  })

  it('проверяет один хост по id', async () => {
    stubDns(['203.0.113.1'], ['203.0.113.1'])
    fetchMock.mockImplementation(async () => new Response('ok'))

    const one = await inject('POST', '/api/net/check', {
      host: 'https://image.tmdb.org',
    })

    expect(one.statusCode).toBe(200)
    await waitForCheck()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://image.tmdb.org/')

    const unknown = await inject('POST', '/api/net/check', {
      host: 'https://unknown.example',
    })

    expect(unknown.statusCode).toBe(404)
  })
})

describe('ключ TMDB', () => {
  const KEY = 'eyJhbGciOiJIUzI1NiJ9.owner-token'
  const APP_KEY = 'eyJhbGciOiJIUzI1NiJ9.app-token'
  let appKeyDir: string

  beforeAll(() => {
    appKeyDir = mkdtempSync(join(tmpdir(), 'torsher-tmdb-'))
  })

  afterAll(() => {
    rmSync(appKeyDir, { recursive: true, force: true })
  })

  // Без содержимого — образ без ключа приложения
  function useAppKey(content?: string) {
    const path = join(appKeyDir, `key-${Math.random()}`)

    if (content !== undefined)
      writeFileSync(path, content)

    vi.spyOn(config, 'tmdbAppKeyPath', 'get').mockReturnValue(path)
  }

  async function lastAuthorization() {
    fetchMock.mockImplementation(async () => Response.json({ images: {} }))
    await inject('POST', '/api/settings/metadata/check', {})

    return new Headers(fetchMock.mock.calls.at(-1)![1]?.headers).get(
      'authorization',
    )
  }

  it('без своего ключа и env — ключ приложения из образа', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')
    useAppKey(`${APP_KEY}\n`)

    const res = await inject('GET', '/api/settings/metadata')

    expect(res.json()).toEqual({
      tmdb: { source: 'app', defaultKey: 'app' },
      imdb: { enabled: false, state: 'off' },
    })
    expect(res.body).not.toContain(APP_KEY)
    expect(await lastAuthorization()).toBe(`Bearer ${APP_KEY}`)
  })

  it('ключ из окружения важнее ключа приложения', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', 'env-token')
    useAppKey(APP_KEY)

    const res = await inject('GET', '/api/settings/metadata')

    expect(res.json().tmdb).toEqual({ source: 'env', defaultKey: 'env' })
    expect(await lastAuthorization()).toBe('Bearer env-token')
  })

  it.each([[undefined], ['  \n']])(
    'без ключа приложения и env — none: %#',
    async (content) => {
      vi.stubEnv('TMDB_ACCESS_TOKEN', '')
      useAppKey(content)

      const res = await inject('GET', '/api/settings/metadata')

      expect(res.json().tmdb).toEqual({ source: 'none', defaultKey: null })
    },
  )

  it('сохраняет свой ключ шифрованно и ходит с ним в TMDB', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')
    useAppKey(APP_KEY)

    const saved = await inject('PUT', '/api/settings/metadata', {
      tmdbKey: KEY,
    })

    expect(saved.json()).toEqual({
      tmdb: { source: 'custom', defaultKey: 'app' },
      imdb: { enabled: false, state: 'off' },
    })
    expect(saved.body).not.toContain(KEY)

    const row = getDb().select().from(serverSettings).all()[0]!

    expect(JSON.stringify(row.value)).not.toContain(KEY)

    fetchMock.mockImplementation(async () => Response.json({ images: {} }))

    const check = await inject('POST', '/api/settings/metadata/check', {})

    expect(check.json()).toEqual({ ok: true, kind: null })

    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers)

    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)

    const reset = await inject('PUT', '/api/settings/metadata', {
      tmdbKey: null,
    })

    expect(reset.json().tmdb.source).toBe('app')
  })

  it('ключ API v3 уходит параметром', async () => {
    const v3 = '0123456789abcdef0123456789abcdef'

    fetchMock.mockImplementation(async () => Response.json({}))
    await inject('POST', '/api/settings/metadata/check', { tmdbKey: v3 })

    const url = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(url.searchParams.get('api_key')).toBe(v3)
  })

  it.each([
    [async () => new Response('', { status: 401 }), 'rejected'],
    [
      async () => {
        throw failure('ENOTFOUND')
      },
      'unavailable',
    ],
  ])('проверка ключа: %#', async (respond, kind) => {
    fetchMock.mockImplementation(respond)

    const res = await inject('POST', '/api/settings/metadata/check', {
      tmdbKey: KEY,
    })

    expect(res.json()).toEqual({ ok: false, kind })
  })

  it('без ключа — missing', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')
    useAppKey()

    const res = await inject('POST', '/api/settings/metadata/check', {})

    expect(res.json()).toEqual({ ok: false, kind: 'missing' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('оценки IMDb', () => {
  beforeEach(() => {
    // Файл выгрузки не должен попасть в каталог данных разработчика
    vi.spyOn(config, 'imdbRatingsPath', 'get').mockReturnValue(
      '/nonexistent/torsher-imdb.db',
    )
    fetchMock.mockImplementation(
      async () => new Response('fail', { status: 503 }),
    )
  })

  it('обновление выключенного — 409, без запроса к IMDb', async () => {
    const res = await inject('POST', '/api/settings/metadata/imdb/refresh')

    expect(res.statusCode).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('включение запускает загрузку, ошибка видна в состоянии', async () => {
    const enabled = await inject('PUT', '/api/settings/metadata/imdb', {
      enabled: true,
    })

    expect(enabled.statusCode).toBe(200)
    expect(enabled.json()).toMatchObject({ enabled: true, state: 'updating' })

    await refreshImdbRatings()

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://datasets.imdbws.com/title.ratings.tsv.gz',
    )

    const status = (await inject('GET', '/api/settings/metadata')).json().imdb

    expect(status).toMatchObject({
      enabled: true,
      state: 'error',
      error: { kind: 'unavailable' },
    })

    const about = await app.inject({ url: '/api/about' })

    expect(about.json().imdbAttribution).toBe(true)

    const refresh = await inject('POST', '/api/settings/metadata/imdb/refresh')

    expect(refresh.statusCode).toBe(202)
    await refreshImdbRatings()

    const disabled = await inject('PUT', '/api/settings/metadata/imdb', {
      enabled: false,
    })

    expect(disabled.json()).toEqual({ enabled: false, state: 'off' })
  })
})
