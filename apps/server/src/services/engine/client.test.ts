import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addTorrent,
  EngineError,
  forgetTorrent,
  inspectTorrent,
  openStream,
  resolveMagnet,
  setEngineDown,
  setEngineReady,
  torrentHaves,
  torrentStats,
} from './client.ts'
import {
  addResponse,
  engineError,
  INFO_HASH,
  initializingStats,
  liveStats,
} from './fixtures/index.ts'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setEngineReady('http://127.0.0.1:4000')
})

afterEach(() => {
  vi.unstubAllGlobals()
  setEngineDown('stopped')
})

describe('клиент движка', () => {
  it('без движка запрос не уходит, ошибка говорит почему', async () => {
    setEngineDown('not_installed')

    const err = await torrentStats(INFO_HASH).catch(e => e)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(err).toBeInstanceOf(EngineError)
    expect(err).toMatchObject({
      kind: 'unavailable',
      unavailable: 'not_installed',
    })
  })

  it('статистика: пиры, скорость в байтах и прогресс файлов', async () => {
    fetchMock.mockResolvedValue(json(liveStats))

    const stats = await torrentStats(INFO_HASH)

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `http://127.0.0.1:4000/torrents/${INFO_HASH}/stats/v1`,
    )
    expect(stats).toEqual({
      state: 'live',
      error: null,
      fileProgress: [3_145_728, 0, 0],
      peers: { connected: 7, found: 41 },
      downloadSpeed: 2_621_440,
      uploadSpeed: 262_144,
    })
  })

  it('статистика раздачи, которая ещё проверяет файлы, — без пиров', async () => {
    fetchMock.mockResolvedValue(json(initializingStats))

    const stats = await torrentStats(INFO_HASH)

    expect(stats.state).toBe('initializing')
    expect(stats.peers).toEqual({ connected: 0, found: 0 })
    expect(stats.downloadSpeed).toBe(0)
  })

  it('раздачи нет в движке — not_found', async () => {
    fetchMock.mockResolvedValue(
      json(engineError(404, 'torrent_not_found', 'torrent not found'), 404),
    )

    await expect(torrentStats(INFO_HASH)).rejects.toMatchObject({
      kind: 'not_found',
    })
  })

  it('забыть раздачу, которой уже нет, — not_found, хотя движок отвечает 500', async () => {
    fetchMock.mockResolvedValue(
      json(
        engineError(
          500,
          'internal_error',
          'error forgetting torrent: no such torrent in db',
        ),
        500,
      ),
    )

    await expect(forgetTorrent(INFO_HASH)).rejects.toMatchObject({
      kind: 'not_found',
    })
  })

  it('неожиданная форма ответа — failed', async () => {
    fetchMock.mockResolvedValue(json({ state: 'live' }))

    await expect(torrentStats(INFO_HASH)).rejects.toMatchObject({
      kind: 'failed',
    })
  })

  it('битый .torrent — rejected с текстом движка', async () => {
    fetchMock.mockResolvedValue(
      json(engineError(400, 'internal_error', 'error adding torrent'), 400),
    )

    await expect(inspectTorrent(new Uint8Array([1, 2]))).rejects.toMatchObject({
      kind: 'rejected',
      message: 'error adding torrent',
    })
  })

  it('добавляет раздачу с выбранными файлами и разрешает дописывать скачанное', async () => {
    fetchMock.mockResolvedValue(json(addResponse(undefined, 3)))

    const details = await addTorrent(new Uint8Array([100]), [0])
    const url = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(url.pathname).toBe('/torrents')
    expect(url.searchParams.get('only_files')).toBe('0')
    expect(url.searchParams.get('overwrite')).toBe('true')
    expect(url.searchParams.get('is_url')).toBe('false')
    expect(details.files).toHaveLength(3)
  })

  it('magnet без пиров упирается в таймаут движка — timeout', async () => {
    fetchMock.mockResolvedValue(
      json(engineError(500, 'internal_error', 'timeout'), 500),
    )

    await expect(
      resolveMagnet(`magnet:?xt=urn:btih:${INFO_HASH}`, 1000),
    ).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('битовое поле кусков; пока раздача проверяется — null', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([0b1110_0000]), {
        headers: { 'x-bitfield-len': '3' },
      }),
    )
    fetchMock.mockResolvedValueOnce(
      json(engineError(412, 'internal_error', 'torrent is not live'), 412),
    )

    expect(await torrentHaves(INFO_HASH)).toEqual({
      bits: new Uint8Array([0b1110_0000]),
      pieceCount: 3,
    })
    expect(await torrentHaves(INFO_HASH)).toBeNull()
  })

  it('поток: Range уходит в движок, 206 и 416 отдаются как есть', async () => {
    fetchMock.mockResolvedValueOnce(new Response('abc', { status: 206 }))
    fetchMock.mockResolvedValueOnce(
      json(engineError(416, 'internal_error', 'bad range'), 416),
    )

    const controller = new AbortController()
    const partial = await openStream(
      INFO_HASH,
      0,
      'bytes=0-2',
      controller.signal,
    )
    const init = fetchMock.mock.calls[0]![1]!

    expect(partial.status).toBe(206)
    expect(init.headers).toEqual({ Range: 'bytes=0-2' })
    expect(init.signal).toBe(controller.signal)
    expect(
      (await openStream(INFO_HASH, 0, 'bytes=99-', controller.signal)).status,
    ).toBe(416)
  })

  it('движок упал между запросами — unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(torrentStats(INFO_HASH)).rejects.toMatchObject({
      kind: 'unavailable',
    })
  })
})
