import pino from 'pino'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { indexerManagers, indexers } from '../../db/schema.ts'
import { installLogger } from '../logs/index.ts'
import { decryptSecret, encryptWith, loadSecretKey } from '../secrets/index.ts'
import {
  capsXml,
  jackettIndexersXml,
  prowlarrIndexers,
  torznabErrorXml,
} from '../torznab/fixtures/index.ts'
import { SourceError } from '../torznab/index.ts'
import {
  checkIndexer,
  checkIndexers,
  createManualIndexer,
  deleteManager,
  hasSearchableIndexers,
  importManager,
  listIndexers,
  syncManager,
} from './index.ts'
import { listManagerIndexers } from './managers.ts'

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
  getDb().delete(indexers).run()
  getDb().delete(indexerManagers).run()
})

afterEach(() => {
  vi.unstubAllGlobals()
  installLogger(pino({ level: 'silent' }))
})

describe('listManagerIndexers', () => {
  it('prowlarr: торрент-индексаторы с Torznab-адресом /{id}', async () => {
    fetchMock.mockResolvedValue(json(prowlarrIndexers))

    const list = await listManagerIndexers(
      'prowlarr',
      'http://manager.example:9696',
      'key',
    )

    expect(list).toEqual([
      {
        externalId: '1',
        name: 'Indexer A',
        url: 'http://manager.example:9696/1',
        enabled: true,
        supportsRss: true,
        priority: 10,
      },
      {
        externalId: '2',
        name: 'Indexer B',
        url: 'http://manager.example:9696/2',
        enabled: false,
        supportsRss: false,
        priority: 25,
      },
    ])

    const [url, init] = fetchMock.mock.calls[0]!

    expect(String(url)).toBe('http://manager.example:9696/api/v1/indexer')
    expect(init?.headers).toMatchObject({ 'X-Api-Key': 'key' })
  })

  it('prowlarr: 401 — неверный ключ, 404 — не тот API', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    await expect(
      listManagerIndexers('prowlarr', 'http://manager.example', 'key'),
    ).rejects.toMatchObject({ kind: 'auth' })

    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    await expect(
      listManagerIndexers('prowlarr', 'http://manager.example', 'key'),
    ).rejects.toMatchObject({ kind: 'unsupported' })
  })

  it('prowlarr: HTML вместо JSON — не тот API', async () => {
    fetchMock.mockResolvedValue(new Response('<html></html>'))

    await expect(
      listManagerIndexers('prowlarr', 'http://manager.example', 'key'),
    ).rejects.toMatchObject({ kind: 'bad_response' })
  })

  it('jackett: настроенные индексаторы агрегатора с caps', async () => {
    fetchMock.mockResolvedValue(new Response(jackettIndexersXml))

    const list = await listManagerIndexers(
      'jackett',
      'http://manager.example:9117',
      'key',
    )

    expect(list.map(({ caps, ...item }) => item)).toEqual([
      {
        externalId: 'indexer-a',
        name: 'Indexer A',
        url: 'http://manager.example:9117/api/v2.0/indexers/indexer-a/results/torznab',
        enabled: true,
      },
      {
        externalId: 'indexer-b',
        name: 'Indexer B',
        url: 'http://manager.example:9117/api/v2.0/indexers/indexer-b/results/torznab',
        enabled: true,
      },
    ])
    expect(list[0]!.caps?.movieSearch).toEqual({
      available: true,
      params: ['q', 'imdbid'],
    })
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://manager.example:9117/api/v2.0/indexers/all/results/torznab/api?t=indexers&configured=true&apikey=key',
    )
  })

  it('jackett: без настроенных индексаторов — пустой список', async () => {
    fetchMock.mockResolvedValue(
      new Response('<?xml version="1.0" encoding="UTF-8"?>\n<indexers />'),
    )

    await expect(
      listManagerIndexers('jackett', 'http://manager.example', 'key'),
    ).resolves.toEqual([])
  })

  it('jackett: ошибка 100 — неверный ключ', async () => {
    fetchMock.mockResolvedValue(
      new Response(torznabErrorXml(100, 'Invalid API Key')),
    )

    await expect(
      listManagerIndexers('jackett', 'http://manager.example', 'key'),
    ).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('importManager', () => {
  it('сохраняет менеджер и индексаторы с зашифрованным ключом', async () => {
    fetchMock.mockResolvedValue(json(prowlarrIndexers))

    const result = await importManager({
      kind: 'prowlarr',
      url: 'http://manager.example:9696/',
      apiKey: 'manager-key',
    })

    expect(result).toMatchObject({ added: 2, updated: 0, missing: 0 })
    expect(result.manager).toMatchObject({
      url: 'http://manager.example:9696',
      indexerCount: 2,
    })
    expect(result.manager.syncedAt).toBeInstanceOf(Date)
    // Выключенный в менеджере индексатор не проверяем
    expect(result.toCheck).toHaveLength(1)

    const rows = getDb().select().from(indexers).all()

    for (const row of rows) {
      expect(row.apiKey).not.toContain('manager-key')
      expect(decryptSecret(row.apiKey!)).toBe('manager-key')
    }
    expect(rows.find(row => row.name === 'Indexer B')?.enabled).toBe(false)
    // Лента и приоритет — как в Prowlarr
    expect(
      rows.map(row => [row.name, row.supportsRss, row.priority]).sort(),
    ).toEqual([
      ['Indexer A', true, 10],
      ['Indexer B', false, 25],
    ])
  })

  it('повторный импорт синхронизирует: добавляет, обновляет, помечает исчезнувшие', async () => {
    fetchMock.mockResolvedValueOnce(json(prowlarrIndexers))
    const first = await importManager({
      kind: 'prowlarr',
      url: 'http://manager.example:9696',
      apiKey: 'key',
    })

    fetchMock.mockResolvedValueOnce(
      json([
        { ...prowlarrIndexers[0], name: 'Indexer A renamed' },
        { id: 4, name: 'Indexer C', protocol: 'torrent', enable: true },
      ]),
    )
    const second = await importManager({
      kind: 'prowlarr',
      url: 'http://manager.example:9696/',
      apiKey: 'new-key',
    })

    expect(second.manager.id).toBe(first.manager.id)
    expect(second).toMatchObject({ added: 1, updated: 1, missing: 1 })

    const byName = new Map(listIndexers().map(item => [item.name, item]))

    expect(byName.get('Indexer B')?.missing).toBe(true)
    expect(byName.get('Indexer C')?.managerKind).toBe('prowlarr')
    expect(decryptSecret(byName.get('Indexer A renamed')!.apiKey!)).toBe(
      'new-key',
    )

    // Вернувшийся индексатор снимает пометку, теперь пропал Indexer C
    fetchMock.mockResolvedValueOnce(json(prowlarrIndexers))
    const third = await syncManager(first.manager.id)

    expect(third).toMatchObject({ added: 0, updated: 2, missing: 1 })
  })

  it('не сохраняет менеджер, если список не получен', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))

    await expect(
      importManager({
        kind: 'prowlarr',
        url: 'http://manager.example',
        apiKey: 'bad',
      }),
    ).rejects.toBeInstanceOf(SourceError)
    expect(getDb().select().from(indexerManagers).all()).toHaveLength(0)
  })

  it('jackett: адрес страницы интерфейса или Torznab-ленты — тот же менеджер', async () => {
    fetchMock.mockImplementation(async () => new Response(jackettIndexersXml))

    const first = await importManager({
      kind: 'jackett',
      url: 'http://manager.example:9117/jackett/UI/Dashboard#indexers',
      apiKey: 'key',
    })
    const second = await importManager({
      kind: 'jackett',
      url: 'http://manager.example:9117/jackett/api/v2.0/indexers/all/results/torznab/',
      apiKey: 'key',
    })

    expect(first.manager.url).toBe('http://manager.example:9117/jackett')
    expect(second.manager.id).toBe(first.manager.id)
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://manager.example:9117/jackett/api/v2.0/indexers/all/results/torznab/api?t=indexers&configured=true&apikey=key',
    )
    expect(listIndexers()).toHaveLength(2)
  })

  it('prowlarr: адрес страницы интерфейса или Torznab-ленты — тот же менеджер', async () => {
    fetchMock.mockImplementation(async () => json(prowlarrIndexers))

    const urls = [
      'http://manager.example:9696/prowlarr/settings/general',
      'http://manager.example:9696/prowlarr/',
      'http://manager.example:9696/prowlarr/indexers/stats',
      'http://manager.example:9696/prowlarr/system/status',
      'http://manager.example:9696/prowlarr/login?returnUrl=%2Fprowlarr%2Fsearch',
      'http://manager.example:9696/prowlarr/1/api?t=caps',
      'http://manager.example:9696/prowlarr/api/v1/indexer/1/newznab',
    ]
    const results = []

    for (const url of urls) {
      results.push(
        await importManager({ kind: 'prowlarr', url, apiKey: 'key' }),
      )
    }

    for (const result of results) {
      expect(result.manager.url).toBe('http://manager.example:9696/prowlarr')
      expect(result.manager.id).toBe(results[0]!.manager.id)
    }
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://manager.example:9696/prowlarr/api/v1/indexer',
    )
  })

  it('jackett: caps из списка сохраняются сразу', async () => {
    fetchMock.mockResolvedValue(new Response(jackettIndexersXml))

    await importManager({
      kind: 'jackett',
      url: 'http://manager.example',
      apiKey: 'key',
    })

    expect(listIndexers()[0]!.caps?.categories).toEqual([
      { id: 2000, name: 'Movies', subcategories: [] },
    ])
  })
})

describe('deleteManager', () => {
  async function imported() {
    fetchMock.mockResolvedValue(json(prowlarrIndexers))

    return (
      await importManager({
        kind: 'prowlarr',
        url: 'http://manager.example',
        apiKey: 'key',
      })
    ).manager
  }

  it('keep — индексаторы остаются ручными', async () => {
    const manager = await imported()

    expect(deleteManager(manager.id, 'keep')).toBe(true)
    expect(listIndexers()).toHaveLength(2)
    expect(listIndexers().every(item => item.managerId === null)).toBe(true)
  })

  it('delete — индексаторы удаляются вместе с менеджером', async () => {
    const manager = await imported()

    expect(deleteManager(manager.id, 'delete')).toBe(true)
    expect(listIndexers()).toHaveLength(0)
  })
})

describe('hasSearchableIndexers', () => {
  const caps = {
    search: { available: true, params: ['q'] },
    tvSearch: { available: false, params: [] },
    movieSearch: { available: false, params: [] },
    categories: [],
  }

  function insert(values: Partial<typeof indexers.$inferInsert>) {
    getDb()
      .insert(indexers)
      .values({ name: 'Indexer', url: 'http://indexer.example/api', ...values })
      .run()
  }

  it('без индексаторов источников нет', () => {
    expect(hasSearchableIndexers()).toBe(false)
  })

  it('выключенный, исчезнувший из менеджера и без caps — не источники', () => {
    insert({ caps, enabled: false })
    insert({ caps, missing: true })
    insert({ caps: null })

    expect(hasSearchableIndexers()).toBe(false)
  })

  it('включённый с caps — источник, даже если сейчас не отвечает', () => {
    insert({ caps, checkStatus: 'unreachable' })

    expect(hasSearchableIndexers()).toBe(true)
  })
})

describe('createManualIndexer', () => {
  it('проверяет caps и сохраняет адрес без /api и ключа', async () => {
    fetchMock.mockResolvedValue(new Response(capsXml))

    const indexer = await createManualIndexer({
      name: 'Indexer A',
      url: 'https://indexer.example/torznab/api?apikey=from-url',
    })

    expect(indexer.url).toBe('https://indexer.example/torznab')
    expect(decryptSecret(indexer.apiKey!)).toBe('from-url')
    expect(indexer.checkStatus).toBe('ok')
    expect(indexer.caps?.tvSearch.available).toBe(true)
  })

  it('не сохраняет индексатор при неудачной проверке', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))

    await expect(
      createManualIndexer({
        name: 'Indexer A',
        url: 'https://indexer.example',
        apiKey: 'bad',
      }),
    ).rejects.toMatchObject({ kind: 'auth' })
    expect(listIndexers()).toHaveLength(0)
  })
})

describe('ключ, который нельзя расшифровать', () => {
  it('проверка и синхронизация отвечают как на непринятый ключ', async () => {
    fetchMock.mockResolvedValueOnce(json(prowlarrIndexers))
    const { manager } = await importManager({
      kind: 'prowlarr',
      url: 'http://manager.example',
      apiKey: 'key',
    })
    // Шифртекст от другого ключа сервера
    const foreign = encryptWith(loadSecretKey({ secret: 'other' }), 'key')

    getDb().update(indexers).set({ apiKey: foreign }).run()
    getDb().update(indexerManagers).set({ apiKey: foreign }).run()

    const checked = await checkIndexer(listIndexers()[0]!.id)

    expect(checked?.checkStatus).toBe('auth')
    await expect(syncManager(manager.id)).rejects.toMatchObject({
      kind: 'auth',
    })
  })
})

describe('checkIndexers', () => {
  it('записывает результат каждой проверки', async () => {
    fetchMock.mockResolvedValueOnce(json(prowlarrIndexers))
    const { toCheck } = await importManager({
      kind: 'prowlarr',
      url: 'http://manager.example',
      apiKey: 'key',
    })

    fetchMock.mockImplementation(async url =>
      String(url).includes('/1/api')
        ? new Response(capsXml)
        : new Response('', { status: 401 }),
    )
    const onError = vi.fn()
    const lines: string[] = []

    installLogger(
      pino({ level: 'trace' }, { write: line => lines.push(line) }),
    )
    await checkIndexers(
      [...toCheck, listIndexers().find(i => i.name === 'Indexer B')!.id],
      onError,
    )

    const byName = new Map(listIndexers().map(item => [item.name, item]))

    expect(onError).not.toHaveBeenCalled()
    expect(byName.get('Indexer A')?.checkStatus).toBe('ok')
    expect(lines.map(line => JSON.parse(line))).toEqual([
      expect.objectContaining({
        level: 40,
        source: 'sources',
        msg: 'Indexer check failed',
        indexerId: byName.get('Indexer B')?.id,
        kind: 'auth',
      }),
    ])
    expect(byName.get('Indexer B')?.checkStatus).toBe('auth')
    expect(byName.get('Indexer B')?.checkedAt).toBeInstanceOf(Date)
  })
})
