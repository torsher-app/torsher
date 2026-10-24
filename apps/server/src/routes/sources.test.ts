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
import { indexerManagers, indexers } from '../db/schema.ts'
import {
  capsXml,
  jackettIndexersXml,
  prowlarrIndexers,
} from '../services/torznab/fixtures/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const SECRET = 'very-secret-api-key'

let owner = {}

function cookieOf(userId: string) {
  return { [ACCESS_TOKEN_COOKIE]: signToken(userId, 'user_access') }
}

beforeAll(async () => {
  await migrateDb()
  owner = cookieOf(
    createOwner({
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'x',
    }).id,
  )
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  getDb().delete(indexers).run()
  getDb().delete(indexerManagers).run()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('доступ', () => {
  it.each([
    ['GET', '/api/indexers'],
    ['POST', '/api/indexers'],
    ['PATCH', '/api/indexers/x'],
    ['DELETE', '/api/indexers/x'],
    ['POST', '/api/indexers/x/test'],
    ['GET', '/api/indexer-managers'],
    ['POST', '/api/indexer-managers'],
    ['POST', '/api/indexer-managers/x/sync'],
    ['DELETE', '/api/indexer-managers/x'],
  ] as const)('%s %s: 401 без входа', async (method, url) => {
    const anonymous = await app.inject({ method, url })

    expect(anonymous.statusCode).toBe(401)
  })
})

describe('индексаторы', () => {
  it('ручной индексатор: проверка caps, ключ не возвращается', async () => {
    fetchMock.mockResolvedValue(new Response(capsXml))

    const created = await app.inject({
      method: 'POST',
      url: '/api/indexers',
      cookies: owner,
      payload: {
        name: 'Indexer A',
        url: 'https://indexer.example/torznab/',
        apiKey: SECRET,
      },
    })

    expect(created.statusCode).toBe(201)
    expect(created.body).not.toContain(SECRET)
    expect(created.json()).toMatchObject({
      name: 'Indexer A',
      url: 'https://indexer.example/torznab',
      hasApiKey: true,
      enabled: true,
      managerKind: null,
      checkStatus: 'ok',
      categories: [
        { id: 2000, name: 'Movies' },
        { id: 5000, name: 'TV' },
      ],
      searchModes: { search: true, tvSearch: true, movieSearch: false },
    })

    const list = await app.inject({ url: '/api/indexers', cookies: owner })

    expect(list.json().items).toHaveLength(1)
    expect(list.body).not.toContain(SECRET)
  })

  it('не сохраняет ручной индексатор при неудачной проверке', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))

    const res = await app.inject({
      method: 'POST',
      url: '/api/indexers',
      cookies: owner,
      payload: {
        name: 'Indexer A',
        url: 'https://indexer.example',
        apiKey: 'bad',
      },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ kind: 'auth' })
    expect(getDb().select().from(indexers).all()).toHaveLength(0)
  })

  it('отвечает 400 на адрес не по http', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/indexers',
      cookies: owner,
      payload: { name: 'Indexer A', url: 'file:///etc/passwd' },
    })

    expect(res.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('patch, test и delete', async () => {
    fetchMock.mockResolvedValue(new Response(capsXml))
    const { id } = (
      await app.inject({
        method: 'POST',
        url: '/api/indexers',
        cookies: owner,
        payload: { name: 'Indexer A', url: 'https://indexer.example' },
      })
    ).json()

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/indexers/${id}`,
      cookies: owner,
      payload: { enabled: false, name: 'Indexer B', apiKey: SECRET },
    })

    expect(patched.statusCode).toBe(200)
    expect(patched.body).not.toContain(SECRET)
    expect(patched.json()).toMatchObject({
      name: 'Indexer B',
      enabled: false,
      hasApiKey: true,
      checkStatus: null,
    })

    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    const tested = await app.inject({
      method: 'POST',
      url: `/api/indexers/${id}/test`,
      cookies: owner,
    })

    expect(tested.statusCode).toBe(200)
    expect(tested.json().checkStatus).toBe('auth')
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain(
      `apikey=${SECRET}`,
    )

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/indexers/${id}`,
      cookies: owner,
    })

    expect(deleted.statusCode).toBe(200)

    const missing = await app.inject({
      method: 'POST',
      url: `/api/indexers/${id}/test`,
      cookies: owner,
    })

    expect(missing.statusCode).toBe(404)
  })
})

describe('менеджеры', () => {
  it('импорт из prowlarr и синхронизация без ключа в ответах', async () => {
    fetchMock.mockImplementation(async url =>
      String(url).endsWith('/api/v1/indexer')
        ? new Response(JSON.stringify(prowlarrIndexers))
        : new Response(capsXml),
    )

    const imported = await app.inject({
      method: 'POST',
      url: '/api/indexer-managers',
      cookies: owner,
      payload: {
        kind: 'prowlarr',
        url: 'http://manager.example:9696',
        apiKey: SECRET,
      },
    })

    expect(imported.statusCode).toBe(200)
    expect(imported.body).not.toContain(SECRET)
    expect(imported.json()).toMatchObject({
      added: 2,
      updated: 0,
      missing: 0,
      manager: { kind: 'prowlarr', indexerCount: 2, missingCount: 0 },
    })

    const { id } = imported.json().manager
    const synced = await app.inject({
      method: 'POST',
      url: `/api/indexer-managers/${id}/sync`,
      cookies: owner,
    })

    expect(synced.statusCode).toBe(200)
    expect(synced.json()).toMatchObject({ added: 0, updated: 0, missing: 0 })

    for (const url of ['/api/indexer-managers', '/api/indexers']) {
      const res = await app.inject({ url, cookies: owner })

      expect(res.body).not.toContain(SECRET)
    }

    const list = (
      await app.inject({ url: '/api/indexers', cookies: owner })
    ).json()

    expect(
      list.items.map((item: { managerKind: string }) => item.managerKind),
    ).toEqual(['prowlarr', 'prowlarr'])
  })

  it('неверный ключ jackett — 422 auth', async () => {
    fetchMock.mockResolvedValue(
      new Response('<error code="100" description="Invalid API Key" />'),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/indexer-managers',
      cookies: owner,
      payload: {
        kind: 'jackett',
        url: 'http://manager.example:9117',
        apiKey: 'bad',
      },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ kind: 'auth' })
  })

  it('удаление с индексаторами и без', async () => {
    fetchMock.mockImplementation(async () => new Response(jackettIndexersXml))

    async function importJackett(url: string) {
      return (
        await app.inject({
          method: 'POST',
          url: '/api/indexer-managers',
          cookies: owner,
          payload: { kind: 'jackett', url, apiKey: 'key' },
        })
      ).json().manager.id as string
    }

    const kept = await importJackett('http://one.example:9117')
    const removed = await importJackett('http://two.example:9117')

    await app.inject({
      method: 'DELETE',
      url: `/api/indexer-managers/${kept}`,
      cookies: owner,
    })
    await app.inject({
      method: 'DELETE',
      url: `/api/indexer-managers/${removed}?indexers=delete`,
      cookies: owner,
    })

    const list = (
      await app.inject({ url: '/api/indexers', cookies: owner })
    ).json()

    expect(list.items).toHaveLength(2)
    expect(
      list.items.every((item: { managerId: null }) => item.managerId === null),
    ).toBe(true)

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/indexer-managers/${kept}`,
      cookies: owner,
    })

    expect(again.statusCode).toBe(404)
  })
})
