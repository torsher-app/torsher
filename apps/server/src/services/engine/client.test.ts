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
  torrentStats,
} from './client.ts'
import {
  engineError,
  INFO_HASH,
  liveStats,
  movieDetails,
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

  it('статистика: пиры, скорость, прогресс файлов и скачанные куски', async () => {
    fetchMock.mockResolvedValue(json(liveStats))

    const stats = await torrentStats(INFO_HASH)

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `http://127.0.0.1:4000/torrents/${INFO_HASH}/stats`,
    )
    expect(stats).toEqual({
      peers: { connected: 7, found: 41 },
      downloadSpeed: 2_621_440,
      uploadSpeed: 262_144,
      fileProgress: [3_145_728, 0, 0],
      pieces: liveStats.pieces,
    })
  })

  it('раздачи нет в движке — not_found', async () => {
    fetchMock.mockResolvedValue(
      json(
        engineError('torrent_not_found', 'torrent is not in the engine'),
        404,
      ),
    )

    await expect(torrentStats(INFO_HASH)).rejects.toMatchObject({
      kind: 'not_found',
    })
  })

  it('неожиданная форма ответа — failed', async () => {
    fetchMock.mockResolvedValue(json({ peers: 'many' }))

    await expect(torrentStats(INFO_HASH)).rejects.toMatchObject({
      kind: 'failed',
    })
  })

  it('битый .torrent — rejected с текстом движка', async () => {
    fetchMock.mockResolvedValue(
      json(engineError('invalid_torrent', 'bencode: syntax error'), 400),
    )

    await expect(inspectTorrent(new Uint8Array([1, 2]))).rejects.toMatchObject({
      kind: 'rejected',
      message: 'bencode: syntax error',
    })
  })

  it('добавляет раздачу с выбранными файлами', async () => {
    fetchMock.mockResolvedValue(json(movieDetails))

    const details = await addTorrent(new Uint8Array([100]), [0])
    const url = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(url.pathname).toBe('/torrents')
    expect(url.searchParams.get('files')).toBe('0')
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST')
    expect(details.files).toHaveLength(3)
    expect(details.pieceLength).toBe(262_144)
  })

  it('magnet без пиров — timeout', async () => {
    fetchMock.mockResolvedValue(
      json(engineError('timeout', 'no peers sent the torrent metadata'), 504),
    )

    await expect(
      resolveMagnet(`magnet:?xt=urn:btih:${INFO_HASH}`, 1000),
    ).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('забыть раздачу — DELETE, отсутствующая — not_found', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    fetchMock.mockResolvedValueOnce(
      json(
        engineError('torrent_not_found', 'torrent is not in the engine'),
        404,
      ),
    )

    await forgetTorrent(INFO_HASH)

    expect(fetchMock.mock.calls[0]![1]!.method).toBe('DELETE')
    await expect(forgetTorrent(INFO_HASH)).rejects.toMatchObject({
      kind: 'not_found',
    })
  })

  it('поток: Range уходит в движок, 206 и 416 отдаются как есть', async () => {
    fetchMock.mockResolvedValueOnce(new Response('abc', { status: 206 }))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 416 }))

    const controller = new AbortController()
    const partial = await openStream(
      INFO_HASH,
      0,
      'bytes=0-2',
      controller.signal,
    )
    const init = fetchMock.mock.calls[0]![1]!

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `http://127.0.0.1:4000/torrents/${INFO_HASH}/files/0/stream`,
    )
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
