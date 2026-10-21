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
  importManager,
  listIndexers,
  syncManager,
} from './index.ts'
import { listManagerIndexers } from './managers.ts'

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
  getDb().delete(indexers).run()
  getDb().delete(indexerManagers).run()
})

afterEach(() => {
  vi.unstubAllGlobals()
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
      },
      {
        externalId: '2',
        name: 'Indexer B',
        url: 'http://manager.example:9696/2',
        enabled: false,
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

    await checkIndexers(
      [...toCheck, listIndexers().find(i => i.name === 'Indexer B')!.id],
      onError,
    )

    const byName = new Map(listIndexers().map(item => [item.name, item]))

    expect(onError).not.toHaveBeenCalled()
    expect(byName.get('Indexer A')?.checkStatus).toBe('ok')
    expect(byName.get('Indexer B')?.checkStatus).toBe('auth')
    expect(byName.get('Indexer B')?.checkedAt).toBeInstanceOf(Date)
  })
})
