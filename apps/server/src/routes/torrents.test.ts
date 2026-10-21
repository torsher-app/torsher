import type { AddressInfo } from 'node:net'
import type { Torrent } from '../db/schema.ts'
import { Buffer } from 'node:buffer'
import { get } from 'node:http'
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
import { torrents } from '../db/schema.ts'
import { setEngineDown, setEngineReady } from '../services/engine/index.ts'
import {
  addResponse,
  engineError,
  INFO_HASH,
  liveStats,
  movieDetails,
  sampleTorrentFile,
} from '../services/engine/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const ENGINE = 'http://127.0.0.1:4000'
const MAGNET = `magnet:?xt=urn:btih:${INFO_HASH}&dn=Sample+Movie`
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Подменённый движок: ответы по пути запроса */
function engine(routes: Record<string, Route>) {
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    const route = routes[`${init.method ?? 'GET'} ${url.pathname}`]

    if (!route) {
      return json(
        engineError(404, 'torrent_not_found', 'torrent not found'),
        404,
      )
    }

    return route(url, init)
  })
}

/** Проматывает фальшивое время, пока промис не выполнится */
async function settle<T>(promise: Promise<T>) {
  const state = { done: false }

  void promise.finally(() => {
    state.done = true
  })

  while (!state.done) await vi.advanceTimersByTimeAsync(500)

  return promise
}

function insertTorrent(
  values: Partial<typeof torrents.$inferInsert> = {},
): Torrent {
  const file = sampleTorrentFile()

  return getDb()
    .insert(torrents)
    .values({
      infoHash: INFO_HASH,
      name: 'Sample Movie (2008)',
      source: 'file',
      torrentFile: Buffer.from(file),
      files: movieDetails.files.map(item => ({
        path: item.components.join('/'),
        size: item.length,
        padding: item.attributes.padding,
      })),
      pieceLength: 262_144,
      status: 'ready',
      ...values,
    })
    .returning()
    .get()
}

beforeAll(() => {
  migrateDb()
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setEngineReady(ENGINE)
  getDb().delete(torrents).run()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setEngineDown('stopped')
})

describe('доступ', () => {
  it.each([
    ['GET', '/torrents'],
    ['POST', '/torrents'],
    ['GET', '/torrents/x'],
    ['DELETE', '/torrents/x'],
    ['POST', '/torrents/x/retry'],
    ['GET', '/torrents/x/stats?fileIndex=0'],
    ['POST', '/playback'],
    ['PUT', '/watch-state'],
    ['GET', '/stream/x/0'],
  ] as const)('%s %s: 401 без входа', async (method, url) => {
    const anonymous = await app.inject({ method, url })

    expect(anonymous.statusCode).toBe(401)
  })

  it('поток не принимает токен другого назначения', async () => {
    const torrent = insertTorrent()
    const response = await app.inject({
      url: `/stream/${torrent.id}/0?token=${signToken('owner', 'user_access')}`,
    })

    expect(response.statusCode).toBe(401)
  })
})

describe('добавление раздачи', () => {
  it('без magnet и файла или с обоими — 400', async () => {
    const empty = await app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload: {},
    })
    const both = await app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload: { magnet: MAGNET, torrentFile: 'ZA==' },
    })

    expect(empty.statusCode).toBe(400)
    expect(both.statusCode).toBe(400)
  })

  it('magnet без infohash v1 — 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload: { magnet: 'magnet:?dn=nothing' },
    })

    expect(response.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('без движка — 503 с причиной, раздача не создаётся', async () => {
    setEngineDown('not_installed')

    const response = await app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload: { magnet: MAGNET },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      message: 'Torrent engine is not running',
      kind: 'not_installed',
    })
    expect(getDb().select().from(torrents).all()).toHaveLength(0)
  })

  it('magnet: метаданные пришли быстро — файлы сразу, без выравнивания', async () => {
    engine({
      'POST /torrents/resolve_magnet': () => new Response(sampleTorrentFile()),
      'POST /torrents': (url) => {
        expect(url.searchParams.get('list_only')).toBe('true')
        return json(addResponse())
      },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload: { magnet: MAGNET },
    })
    const body = response.json()

    expect(response.statusCode).toBe(201)
    expect(body).toMatchObject({
      infoHash: INFO_HASH,
      name: 'Sample Movie (2008)',
      source: 'magnet',
      status: 'ready',
      error: null,
      totalSize: 9_457_664,
    })
    expect(body.files).toEqual([
      {
        index: 0,
        path: 'Sample Movie (2008)/Sample.Movie.2008.1080p.mkv',
        size: 9_437_184,
        isVideo: true,
      },
      {
        index: 2,
        path: 'Sample Movie (2008)/Sample.Movie.2008.srt',
        size: 20_480,
        isVideo: false,
      },
    ])
    // Ни .torrent, ни magnet в ответ не попадают
    expect(body).not.toHaveProperty('magnet')
    expect(body).not.toHaveProperty('torrentFile')
  })

  it('magnet: пиров долго нет — раздача ждёт метаданные в фоне', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })

    let respond: (value: Response) => void = () => {}

    engine({
      'POST /torrents/resolve_magnet': () =>
        new Promise<Response>((resolve) => {
          respond = resolve
        }),
      'POST /torrents': () => json(addResponse()),
    })

    const pending = app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload: { magnet: MAGNET },
    })

    const response = await settle(pending)

    vi.useRealTimers()

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      name: 'Sample Movie',
      status: 'resolving',
      files: [],
    })

    respond(new Response(sampleTorrentFile()))
    await vi.waitFor(() => {
      const list = getDb().select().from(torrents).all()

      expect(list[0]?.status).toBe('ready')
    })
  })

  it('magnet: пиры так и не прислали метаданные — failed, повторное добавление — повтор', async () => {
    engine({
      'POST /torrents/resolve_magnet': () =>
        json(engineError(500, 'internal_error', 'timeout'), 500),
    })

    const failed = await app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload: { magnet: MAGNET },
    })

    expect(failed.json()).toMatchObject({ status: 'failed', error: 'timeout' })

    engine({
      'POST /torrents/resolve_magnet': () => new Response(sampleTorrentFile()),
      'POST /torrents': () => json(addResponse()),
    })

    const retried = await app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload: { magnet: MAGNET },
    })

    expect(retried.statusCode).toBe(200)
    expect(retried.json()).toMatchObject({
      id: failed.json().id,
      status: 'ready',
    })
  })

  it('повтор раздачи, которая не дождалась пиров', async () => {
    const torrent = insertTorrent({
      source: 'magnet',
      magnet: MAGNET,
      status: 'failed',
      error: 'timeout',
      torrentFile: null,
      files: null,
    })

    engine({
      'POST /torrents/resolve_magnet': () => new Response(sampleTorrentFile()),
      'POST /torrents': () => json(addResponse()),
    })

    const response = await app.inject({
      method: 'POST',
      url: `/torrents/${torrent.id}/retry`,
      cookies: owner,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: torrent.id, status: 'ready' })
    expect(response.json().files).toHaveLength(2)
  })

  it('.torrent: файлы сразу, повторное добавление возвращает ту же раздачу', async () => {
    engine({ 'POST /torrents': () => json(addResponse()) })

    const payload = {
      torrentFile: Buffer.from(sampleTorrentFile()).toString('base64'),
    }
    const created = await app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload,
    })
    const again = await app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload,
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ source: 'file', status: 'ready' })
    expect(again.statusCode).toBe(200)
    expect(again.json().id).toBe(created.json().id)

    const stored = getDb().select().from(torrents).get()

    expect(stored?.pieceLength).toBe(262_144)
  })

  it('битый .torrent — 400 с текстом движка', async () => {
    engine({
      'POST /torrents': () =>
        json(engineError(400, 'internal_error', 'error adding torrent'), 400),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/torrents',
      cookies: owner,
      payload: { torrentFile: 'bm90IGEgdG9ycmVudA==' },
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('список и удаление', () => {
  it('список и карточка раздачи', async () => {
    const torrent = insertTorrent()

    const list = await app.inject({ url: '/torrents', cookies: owner })
    const one = await app.inject({
      url: `/torrents/${torrent.id}`,
      cookies: owner,
    })
    const missing = await app.inject({ url: '/torrents/nope', cookies: owner })

    expect(list.json()).toMatchObject({ engine: 'ready' })
    expect(list.json().items).toHaveLength(1)
    expect(one.json().id).toBe(torrent.id)
    expect(missing.statusCode).toBe(404)
  })

  it('раздачу, которую не смотрели, удаляем и без движка', async () => {
    setEngineDown('starting')

    const torrent = insertTorrent()
    const response = await app.inject({
      method: 'DELETE',
      url: `/torrents/${torrent.id}`,
      cookies: owner,
    })

    expect(response.statusCode).toBe(200)
    expect(getDb().select().from(torrents).all()).toHaveLength(0)
  })

  it('раздача в движке: без движка — 503, иначе движок её забывает', async () => {
    const torrent = insertTorrent({ inEngine: true })

    setEngineDown('starting')

    const down = await app.inject({
      method: 'DELETE',
      url: `/torrents/${torrent.id}`,
      cookies: owner,
    })

    expect(down.statusCode).toBe(503)
    expect(getDb().select().from(torrents).all()).toHaveLength(1)

    setEngineReady(ENGINE)
    engine({ [`POST /torrents/${INFO_HASH}/forget`]: () => json({}) })

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/torrents/${torrent.id}`,
      cookies: owner,
    })

    expect(deleted.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('статистика', () => {
  it('раздача ещё не в движке — idle', async () => {
    const torrent = insertTorrent()

    engine({})

    const response = await app.inject({
      url: `/torrents/${torrent.id}/stats?fileIndex=0`,
      cookies: owner,
    })

    expect(response.json()).toMatchObject({
      activity: 'idle',
      file: { size: 9_437_184, downloaded: 0, bufferedAhead: 0 },
    })
  })

  it('пиры, скорость и буфер впереди позиции чтения', async () => {
    const torrent = insertTorrent()

    engine({
      [`GET /torrents/${INFO_HASH}/stats/v1`]: () => json(liveStats),
      // Скачаны первые 12 кусков по 256 КиБ
      [`GET /torrents/${INFO_HASH}/haves`]: () =>
        new Response(new Uint8Array([0xFF, 0xF0, 0, 0, 0, 0]), {
          headers: { 'x-bitfield-len': '41' },
        }),
    })

    const response = await app.inject({
      url: `/torrents/${torrent.id}/stats?fileIndex=0&offset=1048576`,
      cookies: owner,
    })

    expect(response.json()).toEqual({
      activity: 'downloading',
      peers: { connected: 7, found: 41 },
      downloadSpeed: 2_621_440,
      uploadSpeed: 262_144,
      file: {
        size: 9_437_184,
        downloaded: 3_145_728,
        bufferedAhead: 2_097_152,
      },
    })
  })

  it('файл-выравнивание и чужой индекс — 404', async () => {
    const torrent = insertTorrent()
    const padding = await app.inject({
      url: `/torrents/${torrent.id}/stats?fileIndex=1`,
      cookies: owner,
    })
    const outside = await app.inject({
      url: `/torrents/${torrent.id}/stats?fileIndex=9`,
      cookies: owner,
    })

    expect(padding.statusCode).toBe(404)
    expect(outside.statusCode).toBe(404)
  })

  it('без движка — 503', async () => {
    const torrent = insertTorrent()

    setEngineDown('starting')

    const response = await app.inject({
      url: `/torrents/${torrent.id}/stats?fileIndex=0`,
      cookies: owner,
    })

    expect(response.statusCode).toBe(503)
    expect(response.json().kind).toBe('starting')
  })
})

describe('воспроизведение и позиция', () => {
  it('раздача без метаданных — 409', async () => {
    const torrent = insertTorrent({ status: 'resolving', torrentFile: null })
    const response = await app.inject({
      method: 'POST',
      url: '/playback',
      cookies: owner,
      payload: { torrentId: torrent.id, fileIndex: 0 },
    })

    expect(response.statusCode).toBe(409)
  })

  it('добавляет раздачу в движок только с этим файлом и отдаёт адрес потока', async () => {
    const torrent = insertTorrent()

    engine({
      'POST /torrents': (url) => {
        expect(url.searchParams.get('only_files')).toBe('0')
        return json(
          addResponse(
            {
              ...movieDetails,
              files: movieDetails.files.map((file, index) => ({
                ...file,
                included: index === 0,
              })),
            },
            1,
          ),
        )
      },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/playback',
      cookies: owner,
      payload: { torrentId: torrent.id, fileIndex: 0 },
    })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body).toMatchObject({
      mode: 'direct',
      title: 'Sample Movie (2008)',
      fileName: 'Sample.Movie.2008.1080p.mkv',
      size: 9_437_184,
      duration: null,
      startPosition: null,
    })
    expect(body.streamUrl).toMatch(
      new RegExp(`^/api/stream/${torrent.id}/0\\?token=.+`),
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(getDb().select().from(torrents).get()?.inEngine).toBe(true)
  })

  it('раздача уже в движке с другими файлами — выбор файлов меняется', async () => {
    const torrent = insertTorrent()
    const updates: unknown[] = []

    engine({
      'POST /torrents': () => json(addResponse(movieDetails, 1)),
      [`POST /torrents/${INFO_HASH}/update_only_files`]: (_url, init) => {
        updates.push(JSON.parse(String(init.body)))
        return json({})
      },
    })

    await app.inject({
      method: 'POST',
      url: '/playback',
      cookies: owner,
      payload: { torrentId: torrent.id, fileIndex: 0 },
    })

    expect(updates).toEqual([{ only_files: [0] }])
  })

  it('сохранённая позиция предлагается при следующем открытии', async () => {
    const torrent = insertTorrent()

    engine({
      'POST /torrents': () => json(addResponse(movieDetails, 1)),
      [`POST /torrents/${INFO_HASH}/update_only_files`]: () => json({}),
    })

    const saved = await app.inject({
      method: 'PUT',
      url: '/watch-state',
      cookies: owner,
      payload: {
        torrentId: torrent.id,
        fileIndex: 0,
        position: 754.2,
        duration: 5400,
      },
    })

    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({ position: 754.2, duration: 5400 })

    const response = await app.inject({
      method: 'POST',
      url: '/playback',
      cookies: owner,
      payload: { torrentId: torrent.id, fileIndex: 0 },
    })

    expect(response.json()).toMatchObject({
      duration: 5400,
      startPosition: 754.2,
    })
  })

  it('позиция чужого файла — 404', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/watch-state',
      cookies: owner,
      payload: { torrentId: 'nope', fileIndex: 0, position: 10 },
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('поток', () => {
  function streamUrl(torrent: Torrent, fileIndex = 0) {
    return `/stream/${torrent.id}/${fileIndex}?token=${signToken('owner', 'stream')}`
  }

  it('диапазон Range уходит в движок, 206 и Content-Range возвращаются плееру', async () => {
    const torrent = insertTorrent()

    engine({
      [`GET /torrents/${INFO_HASH}/stream/0`]: (_url, init) => {
        expect(init.headers).toEqual({ Range: 'bytes=100-104' })
        return new Response('hello', {
          status: 206,
          headers: {
            'Content-Length': '5',
            'Content-Range': 'bytes 100-104/9437184',
            'Content-Type': 'application/octet-stream',
          },
        })
      },
    })

    const response = await app.inject({
      url: streamUrl(torrent),
      headers: { range: 'bytes=100-104' },
    })

    expect(response.statusCode).toBe(206)
    expect(response.body).toBe('hello')
    expect(response.headers['content-range']).toBe('bytes 100-104/9437184')
    expect(response.headers['content-length']).toBe('5')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(response.headers['content-type']).toBe('video/x-matroska')
  })

  it('принимает и сессию из cookie', async () => {
    const torrent = insertTorrent()

    engine({
      [`GET /torrents/${INFO_HASH}/stream/0`]: () => new Response('x'),
    })

    const response = await app.inject({
      url: `/stream/${torrent.id}/0`,
      cookies: owner,
    })

    expect(response.statusCode).toBe(200)
  })

  it('диапазон за концом файла — 416 с размером файла', async () => {
    const torrent = insertTorrent()

    engine({
      [`GET /torrents/${INFO_HASH}/stream/0`]: () =>
        json(engineError(416, 'internal_error', 'bad range'), 416),
    })

    const response = await app.inject({
      url: streamUrl(torrent),
      headers: { range: 'bytes=99999999-' },
    })

    expect(response.statusCode).toBe(416)
    expect(response.headers['content-range']).toBe('bytes */9437184')
  })

  it('движок забыл раздачу — добавляет её заново и отдаёт поток', async () => {
    const torrent = insertTorrent()
    let added = false

    engine({
      'POST /torrents': () => {
        added = true
        return json(
          addResponse(
            {
              ...movieDetails,
              files: movieDetails.files.map((file, index) => ({
                ...file,
                included: index === 0,
              })),
            },
            1,
          ),
        )
      },
      [`GET /torrents/${INFO_HASH}/stream/0`]: () =>
        added
          ? new Response('ok')
          : json(
              engineError(404, 'torrent_not_found', 'torrent not found'),
              404,
            ),
    })

    const response = await app.inject({ url: streamUrl(torrent) })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('ok')
  })

  it('пока движок проверяет скачанные куски, поток ждёт', async () => {
    const torrent = insertTorrent()
    let calls = 0

    engine({
      [`GET /torrents/${INFO_HASH}/stream/0`]: () => {
        calls++
        return calls === 1
          ? json(
              engineError(
                500,
                'internal_error',
                'streams: invalid state initializing',
              ),
              500,
            )
          : new Response('ok')
      },
    })

    const response = await app.inject({ url: streamUrl(torrent) })

    expect(response.statusCode).toBe(200)
    expect(calls).toBe(2)
  })

  it('без движка — 503', async () => {
    const torrent = insertTorrent()

    setEngineDown('starting')

    const response = await app.inject({ url: streamUrl(torrent) })

    expect(response.statusCode).toBe(503)
  })

  it('плеер закрыл соединение — чтение из движка отменяется', async () => {
    const torrent = insertTorrent()
    let signal: AbortSignal | undefined

    engine({
      [`GET /torrents/${INFO_HASH}/stream/0`]: (_url, init) => {
        signal = init.signal ?? undefined

        // Движок отдал начало и ждёт куски, которых ещё нет
        const body = new ReadableStream({
          start: controller =>
            controller.enqueue(new TextEncoder().encode('start')),
          pull: () => new Promise(() => {}),
        })

        return new Response(body, { status: 206 })
      },
    })

    // Обрыв соединения проверяем на настоящем сокете: inject его не закрывает
    const server = createApp()

    await server.listen({ port: 0, host: '127.0.0.1' })

    const { port } = server.server.address() as AddressInfo

    try {
      await new Promise<void>((resolve, reject) => {
        const request = get(
          `http://127.0.0.1:${port}${streamUrl(torrent)}`,
          (response) => {
            expect(response.statusCode).toBe(206)
            response.once('data', () => {
              request.destroy()
              resolve()
            })
          },
        )

        request.on('error', (err) => {
          if (!request.destroyed)
            reject(err)
        })
      })

      await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    }
    finally {
      await server.close()
    }
  })
})
