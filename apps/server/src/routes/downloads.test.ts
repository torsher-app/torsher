import type { Torrent } from '../db/schema.ts'
import { Buffer } from 'node:buffer'
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
import { storagePolicy, torrents, users } from '../db/schema.ts'
import { setEngineDown, setEngineReady } from '../services/engine/index.ts'
import {
  engineError,
  INFO_HASH,
  liveState,
  liveStats,
  movieDetails,
  sampleTorrentFile,
} from '../services/engine/fixtures/index.ts'
import { trackStream } from '../services/storage/index.ts'
import { clearStreamSelections } from '../services/torrents/index.ts'
import { signToken } from '../utils/token.ts'

const GIB = 1024 ** 3
const OTHER_HASH = 'fedcba9876543210fedcba9876543210fedcba98'
const disk = vi.hoisted(() => ({ total: 0, free: 0 }))

vi.mock('../services/storage/disk.ts', () => ({
  diskUsage: async () => ({ ...disk }),
}))

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>
type LiveState = typeof liveState

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const noContent = () => new Response(null, { status: 204 })

/** Подменённый движок: список раздач `live` и ответы по пути запроса */
function engine(live: LiveState[], routes: Record<string, Route> = {}) {
  const all: Record<string, Route> = {
    'GET /torrents': () => json(live),
    ...routes,
  }

  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    const route = all[`${init.method ?? 'GET'} ${url.pathname}`]

    if (!route)
      return json(engineError('torrent_not_found', 'torrent not found'), 404)

    return route(url, init)
  })
}

function engineCalls() {
  return fetchMock.mock.calls
    .map(([input, init]) => {
      const url = new URL(String(input))
      return `${init?.method ?? 'GET'} ${url.pathname}${url.search}`
    })
    .filter(call => call !== 'GET /torrents')
}

function insertTorrent(
  values: Partial<typeof torrents.$inferInsert> = {},
): Torrent {
  return getDb()
    .insert(torrents)
    .values({
      infoHash: INFO_HASH,
      name: 'Sample Movie (2008)',
      source: 'file',
      torrentFile: Buffer.from(sampleTorrentFile()),
      files: movieDetails.files.map(item => ({
        path: item.path,
        size: item.length,
        padding: item.padding,
      })),
      pieceLength: 262_144,
      status: 'ready',
      ...values,
    })
    .returning()
    .get()
}

function rowOf(id: string) {
  return getDb()
    .select()
    .from(torrents)
    .all()
    .find(row => row.id === id)
}

beforeAll(() => {
  migrateDb()
  // Сессию проверяют по аккаунту в базе (версия сессий)
  getDb()
    .insert(users)
    .values({
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'hash',
    })
    .run()
})

beforeEach(() => {
  disk.total = 1000 * GIB
  disk.free = 500 * GIB
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setEngineReady('http://127.0.0.1:4000')
  getDb().delete(torrents).run()
  getDb().delete(storagePolicy).run()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setEngineDown('stopped')
})

describe('доступ', () => {
  it.each([
    ['POST', '/api/torrents/x/download'],
    ['POST', '/api/torrents/x/pause'],
    ['POST', '/api/torrents/x/resume'],
    ['PUT', '/api/torrents/x/retention'],
    ['GET', '/api/storage'],
    ['PUT', '/api/storage/policy'],
  ] as const)('%s %s: 401 без входа', async (method, url) => {
    const anonymous = await app.inject({ method, url })

    expect(anonymous.statusCode).toBe(401)
  })
})

describe('список загрузок', () => {
  it('живые поля из движка, общая скорость и заполнение кэша', async () => {
    insertTorrent({ inEngine: true, selectedFiles: [0] })
    engine([{ ...liveState }])

    const response = await app.inject({ url: '/api/torrents', cookies: owner })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.items[0]).toMatchObject({
      state: 'downloading',
      retention: 'cache',
      pauseReason: null,
      streaming: false,
      progress: { downloaded: 3_145_728, wanted: 9_437_184 },
      sizeOnDisk: 3_145_728,
      downloadSpeed: 2_621_440,
      peers: { connected: 7, found: 41 },
    })
    expect(body.items[0].files[0]).toMatchObject({
      downloaded: 3_145_728,
      selected: true,
    })
    expect(body.totals).toEqual({
      downloadSpeed: 2_621_440,
      uploadSpeed: 262_144,
    })
    expect(body.cache).toEqual({ used: 3_145_728, limit: 200 * GIB })
  })

  it('без движка — данные из базы, раздача без данных на диске', async () => {
    insertTorrent({ inEngine: true })
    setEngineDown('starting')

    const body = (
      await app.inject({ url: '/api/torrents', cookies: owner })
    ).json()

    expect(body.engine).toBe('starting')
    expect(body.items[0]).toMatchObject({ state: 'idle', sizeOnDisk: 0 })
  })

  it('скачано и раздаётся, на паузе, ждёт пиров', async () => {
    const seeding = {
      ...liveState,
      wantedCompleted: 9_437_184,
    }
    insertTorrent({ inEngine: true })
    engine([seeding])

    const states = []

    for (const live of [
      seeding,
      { ...liveState, paused: true },
      {
        ...liveState,
        peers: { connected: 0, found: 3, seeders: 0 },
      },
    ]) {
      engine([live])
      states.push(
        (await app.inject({ url: '/api/torrents', cookies: owner })).json()
          .items[0].state,
      )
    }

    expect(states).toEqual(['seeding', 'paused', 'stalled'])
  })
})

describe('действия', () => {
  it('скачать выбранные: в движок сразу и «Оставить»', async () => {
    const torrent = insertTorrent()
    engine([], {
      'POST /torrents': () => json(movieDetails),
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/torrents/${torrent.id}/download`,
      cookies: owner,
      payload: { files: [0, 2, 0] },
    })

    expect(response.statusCode).toBe(200)
    // Выбор в движке и есть закачка целиком
    expect(engineCalls()).toEqual(['POST /torrents?files=0,2'])
    expect(rowOf(torrent.id)).toMatchObject({
      inEngine: true,
      retention: 'keep',
      selectedFiles: [0, 2],
    })
  })

  it('скачать: файл-выравнивание — 400, без метаданных — 409', async () => {
    const ready = insertTorrent()
    const resolving = insertTorrent({
      infoHash: OTHER_HASH,
      status: 'resolving',
      torrentFile: null,
      files: null,
    })

    const padding = await app.inject({
      method: 'POST',
      url: `/api/torrents/${ready.id}/download`,
      cookies: owner,
      payload: { files: [1] },
    })
    const notReady = await app.inject({
      method: 'POST',
      url: `/api/torrents/${resolving.id}/download`,
      cookies: owner,
      payload: { files: [0] },
    })

    expect(padding.statusCode).toBe(400)
    expect(notReady.statusCode).toBe(409)
  })

  it('пауза и продолжение: причина в базе, раздачи нет в движке — 409', async () => {
    const idle = insertTorrent({ infoHash: OTHER_HASH })
    const active = insertTorrent({ inEngine: true })
    engine([liveState], {
      [`POST /torrents/${INFO_HASH}/pause`]: noContent,
      [`POST /torrents/${INFO_HASH}/resume`]: noContent,
    })

    const notInEngine = await app.inject({
      method: 'POST',
      url: `/api/torrents/${idle.id}/pause`,
      cookies: owner,
    })
    const paused = await app.inject({
      method: 'POST',
      url: `/api/torrents/${active.id}/pause`,
      cookies: owner,
    })

    expect(notInEngine.statusCode).toBe(409)
    expect(paused.statusCode).toBe(200)
    expect(rowOf(active.id)?.pauseReason).toBe('user')

    const resumed = await app.inject({
      method: 'POST',
      url: `/api/torrents/${active.id}/resume`,
      cookies: owner,
    })

    expect(resumed.statusCode).toBe(200)
    expect(rowOf(active.id)?.pauseReason).toBeNull()
    expect(engineCalls()).toEqual([
      `POST /torrents/${INFO_HASH}/pause`,
      `POST /torrents/${INFO_HASH}/resume`,
    ])
  })

  it('«Оставить» докачивает начатые видео, «Не оставлять» останавливает закачку', async () => {
    const torrent = insertTorrent({ inEngine: true })
    const bodies: unknown[] = []
    // Начаты фильм и субтитры, но целиком качается только видео
    const started = {
      ...liveStats,
      selected: [],
      fileProgress: [1024, 0, 512],
    }
    engine([{ ...liveState, selected: [] }], {
      [`GET /torrents/${INFO_HASH}/stats`]: () => json(started),
      [`PUT /torrents/${INFO_HASH}/files`]: (_url, init) => {
        bodies.push(JSON.parse(String(init.body)))
        return noContent()
      },
    })

    const retention = (value: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/torrents/${torrent.id}/retention`,
        cookies: owner,
        payload: { retention: value },
      })

    const kept = await retention('keep')

    expect(kept.json().retention).toBe('keep')
    expect(rowOf(torrent.id)?.selectedFiles).toEqual([0])

    const unkept = await retention('cache')

    expect(unkept.json().retention).toBe('cache')
    expect(rowOf(torrent.id)?.selectedFiles).toBeNull()
    expect(bodies).toEqual([{ files: [0] }, { files: [] }])
    expect((await retention('forever')).statusCode).toBe(400)
  })

  it('после старта движка выбор, накопленный просмотром, снимается у кэша', async () => {
    const cached = insertTorrent({ inEngine: true, selectedFiles: [0, 2] })
    const kept = insertTorrent({
      infoHash: OTHER_HASH,
      inEngine: true,
      retention: 'keep',
      selectedFiles: [0],
    })
    engine([], {
      [`PUT /torrents/${INFO_HASH}/files`]: noContent,
    })

    await clearStreamSelections()
    await clearStreamSelections()

    expect(engineCalls()).toEqual([`PUT /torrents/${INFO_HASH}/files`])
    expect(rowOf(cached.id)?.selectedFiles).toBeNull()
    expect(rowOf(kept.id)?.selectedFiles).toEqual([0])
  })

  it('удаление с файлами просит движок удалить и их', async () => {
    const torrent = insertTorrent({ inEngine: true })
    engine([], {
      [`DELETE /torrents/${INFO_HASH}`]: () =>
        json({ deletedBytes: 3_145_728 }),
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/torrents/${torrent.id}?files=delete`,
      cookies: owner,
    })

    expect(response.statusCode).toBe(200)
    expect(engineCalls()).toEqual([
      `DELETE /torrents/${INFO_HASH}?delete_files=true`,
    ])
    expect(rowOf(torrent.id)).toBeUndefined()
  })
})

describe('хранилище', () => {
  it('обзор: том, кэш, закреплённое и очередь вытеснения', async () => {
    const old = insertTorrent({
      inEngine: true,
      lastAccessAt: new Date('2026-01-01'),
    })
    insertTorrent({ infoHash: OTHER_HASH, inEngine: true, retention: 'keep' })
    engine([
      { ...liveState, bytesCompleted: 4 * GIB },
      { ...liveState, infoHash: OTHER_HASH, bytesCompleted: 30 * GIB },
    ])

    const body = (
      await app.inject({ url: '/api/storage', cookies: owner })
    ).json()

    expect(body).toMatchObject({
      total: 1000 * GIB,
      free: 500 * GIB,
      cacheUsed: 4 * GIB,
      keptUsed: 30 * GIB,
      other: 466 * GIB,
      policy: { cacheLimit: 200 * GIB, minFree: 20 * GIB, custom: false },
    })
    expect(body.queue).toEqual([
      {
        torrentId: old.id,
        name: 'Sample Movie (2008)',
        sizeOnDisk: 4 * GIB,
        lastAccessAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })

  it('политика: меньше 1 ГБ — 400; новый лимит сразу вытесняет кэш, закреплённое остаётся', async () => {
    const cached = insertTorrent({
      inEngine: true,
      lastAccessAt: new Date('2026-01-01'),
    })
    const kept = insertTorrent({
      infoHash: OTHER_HASH,
      inEngine: true,
      retention: 'keep',
    })
    engine(
      [
        { ...liveState, bytesCompleted: 4 * GIB },
        { ...liveState, infoHash: OTHER_HASH, bytesCompleted: 30 * GIB },
      ],
      {
        [`DELETE /torrents/${INFO_HASH}`]: () =>
          json({ deletedBytes: 4 * GIB }),
      },
    )

    const tooSmall = await app.inject({
      method: 'PUT',
      url: '/api/storage/policy',
      cookies: owner,
      payload: { cacheLimit: 1000, minFree: 20 * GIB },
    })

    expect(tooSmall.statusCode).toBe(400)

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/storage/policy',
      cookies: owner,
      payload: { cacheLimit: 2 * GIB, minFree: 20 * GIB },
    })

    expect(saved.statusCode).toBe(200)
    expect(saved.json().policy).toEqual({
      cacheLimit: 2 * GIB,
      minFree: 20 * GIB,
      custom: true,
    })
    expect(engineCalls()).toEqual([
      `DELETE /torrents/${INFO_HASH}?delete_files=true`,
    ])
    expect(rowOf(cached.id)).toMatchObject({
      inEngine: false,
      selectedFiles: null,
    })
    expect(rowOf(kept.id)?.inEngine).toBe(true)
  })

  it('мало места и вытеснять нечего — загрузки на паузе, место вернулось — продолжают', async () => {
    const kept = insertTorrent({ inEngine: true, retention: 'keep' })
    const downloading = { ...liveState }
    engine([downloading], {
      [`POST /torrents/${INFO_HASH}/pause`]: noContent,
      [`POST /torrents/${INFO_HASH}/resume`]: noContent,
    })
    disk.free = 5 * GIB

    const { enforceStorage } = await import('../services/storage/index.ts')
    await enforceStorage()

    expect(rowOf(kept.id)?.pauseReason).toBe('storage')

    fetchMock.mockClear()
    engine([{ ...downloading, paused: true }], {
      [`POST /torrents/${INFO_HASH}/resume`]: noContent,
    })
    disk.free = 100 * GIB
    await enforceStorage()

    expect(rowOf(kept.id)?.pauseReason).toBeNull()
    expect(engineCalls()).toEqual([`POST /torrents/${INFO_HASH}/resume`])
  })

  it('мало места: вытесненная качающая раздача не встаёт на паузу, проверка не падает', async () => {
    const cached = insertTorrent({
      inEngine: true,
      lastAccessAt: new Date('2026-01-01'),
    })
    engine([{ ...liveState, bytesCompleted: GIB }], {
      [`DELETE /torrents/${INFO_HASH}`]: () => json({ deletedBytes: GIB }),
    })
    disk.free = 5 * GIB

    const { enforceStorage } = await import('../services/storage/index.ts')
    const result = await enforceStorage()

    expect(result.evicted).toEqual([cached.id])
    expect(engineCalls()).toEqual([
      `DELETE /torrents/${INFO_HASH}?delete_files=true`,
    ])
    expect(rowOf(cached.id)).toMatchObject({
      inEngine: false,
      pauseReason: null,
    })
  })

  it('поток открылся во время вытеснения — раздача остаётся', async () => {
    const first = insertTorrent({
      inEngine: true,
      lastAccessAt: new Date('2026-01-01'),
    })
    const second = insertTorrent({
      infoHash: OTHER_HASH,
      inEngine: true,
      lastAccessAt: new Date('2026-01-02'),
    })
    let release = () => {}
    engine(
      [
        { ...liveState, bytesCompleted: 300 * GIB },
        { ...liveState, infoHash: OTHER_HASH, bytesCompleted: 300 * GIB },
      ],
      {
        [`DELETE /torrents/${INFO_HASH}`]: () => {
          release = trackStream(second.id)
          return json({ deletedBytes: 300 * GIB })
        },
        [`DELETE /torrents/${OTHER_HASH}`]: () =>
          json({ deletedBytes: 300 * GIB }),
      },
    )
    disk.free = 5 * GIB

    const { enforceStorage } = await import('../services/storage/index.ts')
    const result = await enforceStorage()

    release()
    expect(result.evicted).toEqual([first.id])
    expect(rowOf(second.id)?.inEngine).toBe(true)
    // Место второй раздачи не освободилось: кэш всё ещё больше лимита
    expect(result).toMatchObject({ ok: false, shortage: 'cache_limit' })
  })

  it('смотрят сейчас — не вытесняется и не встаёт на паузу', async () => {
    const watching = insertTorrent({
      inEngine: true,
      lastAccessAt: new Date('2026-01-01'),
    })
    engine([{ ...liveState, bytesCompleted: 300 * GIB }])
    disk.free = 5 * GIB

    const release = trackStream(watching.id)
    const { enforceStorage } = await import('../services/storage/index.ts')
    await enforceStorage()
    release()

    expect(engineCalls()).toEqual([])
    expect(rowOf(watching.id)?.inEngine).toBe(true)
  })
})

describe('просмотр и место', () => {
  it('места не хватит — 507 с причиной и цифрами, раздача не добавляется', async () => {
    const torrent = insertTorrent()
    engine([])
    disk.free = 20 * GIB

    const response = await app.inject({
      method: 'POST',
      url: '/api/playback',
      cookies: owner,
      payload: { torrentId: torrent.id, fileIndex: 0 },
    })

    expect(response.statusCode).toBe(507)
    expect(response.json()).toMatchObject({
      kind: 'no_space',
      needed: 9_437_184,
      available: 0,
      free: 20 * GIB,
      minFree: 20 * GIB,
      cacheLimit: 200 * GIB,
    })
    expect(engineCalls()).toEqual([])
  })

  it('файл не влезает в лимит кэша — 507 с лимитом', async () => {
    const torrent = insertTorrent()
    engine([])
    getDb()
      .insert(storagePolicy)
      .values({
        cacheLimitBytes: 4 * 1024 * 1024,
        minFreeBytes: 20 * GIB,
        updatedAt: new Date(),
      })
      .run()

    const response = await app.inject({
      method: 'POST',
      url: '/api/playback',
      cookies: owner,
      payload: { torrentId: torrent.id, fileIndex: 0 },
    })

    expect(response.statusCode).toBe(507)
    expect(response.json()).toMatchObject({
      kind: 'cache_limit',
      needed: 9_437_184,
      available: 4 * 1024 * 1024,
      free: 500 * GIB,
      minFree: 20 * GIB,
      cacheLimit: 4 * 1024 * 1024,
    })
  })

  it.each([
    ['cache', 'POST /torrents?files=2', [2]],
    ['keep', 'POST /torrents?files=2,0', [2, 0]],
  ] as const)(
    'просмотр раздачи %s: выбор %s, пауза снимается',
    async (retention, call, selected) => {
      const torrent = insertTorrent({
        inEngine: true,
        retention,
        selectedFiles: [2],
        pauseReason: 'user',
      })
      engine([liveState], {
        [`GET /torrents/${INFO_HASH}/stats`]: () => json(liveStats),
        'POST /torrents': () => json(movieDetails),
        [`POST /torrents/${INFO_HASH}/resume`]: noContent,
      })

      const response = await app.inject({
        method: 'POST',
        url: '/api/playback',
        cookies: owner,
        payload: { torrentId: torrent.id, fileIndex: 0 },
      })

      expect(response.statusCode).toBe(200)
      expect(engineCalls()).toEqual([
        `GET /torrents/${INFO_HASH}/stats`,
        call,
        `POST /torrents/${INFO_HASH}/resume`,
      ])
      expect(rowOf(torrent.id)).toMatchObject({
        selectedFiles: selected,
        pauseReason: null,
      })
    },
  )
})
