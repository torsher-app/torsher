import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addTorrent,
  EngineError,
  forgetTorrent,
  inspectTorrent,
  listEngineTorrents,
  moveTorrent,
  openStream,
  pauseTorrent,
  putEngineSettings,
  resolveMagnet,
  resumeTorrent,
  selectFiles,
  setEngineDown,
  setEngineReady,
  setTorrentSeed,
  torrentMoveState,
  torrentStats,
} from './client.ts'
import {
  comparedDetails,
  engineError,
  INFO_HASH,
  liveState,
  liveStats,
  moveState,
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
      infoHash: INFO_HASH,
      paused: false,
      selected: [0],
      bytesCompleted: 3_145_728,
      bytesWanted: 9_437_184,
      wantedCompleted: 3_145_728,
      queued: false,
      seeding: true,
      uploaded: 1_048_576,
      peers: { connected: 7, found: 41 },
      downloadSpeed: 2_621_440,
      uploadSpeed: 262_144,
      fileProgress: [3_145_728, 0, 0],
      pieces: liveStats.pieces,
    })
  })

  it('список раздач: infohash в нижнем регистре, пустой выбор — пустой массив', async () => {
    fetchMock.mockResolvedValue(
      json([
        { ...liveState, infoHash: INFO_HASH.toUpperCase(), selected: null },
      ]),
    )

    const list = await listEngineTorrents()

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://127.0.0.1:4000/torrents',
    )
    expect(list).toEqual([
      expect.objectContaining({ infoHash: INFO_HASH, selected: [] }),
    ])
  })

  it('выбор файлов, пауза и продолжение', async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 204 }),
    )

    await selectFiles(INFO_HASH, [0, 2])
    await pauseTorrent(INFO_HASH)
    await resumeTorrent(INFO_HASH)

    const calls = fetchMock.mock.calls.map(([input, init]) => [
      init?.method,
      String(input).replace('http://127.0.0.1:4000', ''),
      init?.body,
    ])

    expect(calls).toEqual([
      ['PUT', `/torrents/${INFO_HASH}/files`, '{"files":[0,2]}'],
      ['POST', `/torrents/${INFO_HASH}/pause`, undefined],
      ['POST', `/torrents/${INFO_HASH}/resume`, undefined],
    ])
  })

  it('движок прежней версии без очереди и отданного — нули', async () => {
    const { queued: _queued, uploaded: _uploaded, ...legacy } = liveState
    fetchMock.mockResolvedValue(json([legacy]))

    const [state] = await listEngineTorrents()

    expect(state).toEqual(
      expect.objectContaining({ queued: false, uploaded: 0 }),
    )
  })

  it('флаг раздачи и живые настройки', async () => {
    const settings = {
      downloadLimit: 1_048_576,
      uploadLimit: 0,
      connsPerTorrent: 50,
      connsTotal: 200,
      activeDownloads: 3,
    }

    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(settings))

    await setTorrentSeed(INFO_HASH, false)
    expect(await putEngineSettings(settings)).toEqual(settings)

    const calls = fetchMock.mock.calls.map(([input, init]) => [
      init?.method,
      String(input).replace('http://127.0.0.1:4000', ''),
      init?.body,
    ])

    expect(calls).toEqual([
      ['PUT', `/torrents/${INFO_HASH}/seed`, '{"seed":false}'],
      ['PUT', '/settings', JSON.stringify(settings)],
    ])
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

  it('сверяет файлы раздачи с каталогом до добавления', async () => {
    fetchMock.mockResolvedValue(json(comparedDetails))

    const details = await inspectTorrent(new Uint8Array([100]), {
      dir: '/downloads/shows',
    })
    const url = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(url.pathname).toBe('/torrents/inspect')
    expect(url.searchParams.get('dir')).toBe('/downloads/shows')
    expect(details.files.map(file => file.onDisk)).toEqual([
      'match',
      'missing',
      'differs',
    ])
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

  it('забыть раздачу — DELETE, с файлами — сколько освободилось, отсутствующая — not_found', async () => {
    fetchMock.mockResolvedValueOnce(json({ deletedBytes: 0 }))
    fetchMock.mockResolvedValueOnce(json({ deletedBytes: 9_437_184 }))
    fetchMock.mockResolvedValueOnce(
      json(
        engineError('torrent_not_found', 'torrent is not in the engine'),
        404,
      ),
    )

    await forgetTorrent(INFO_HASH)
    const freed = await forgetTorrent(INFO_HASH, { deleteFiles: true })

    expect(fetchMock.mock.calls[0]![1]!.method).toBe('DELETE')
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain('delete_files')
    expect(String(fetchMock.mock.calls[1]![0])).toContain('?delete_files=true')
    expect(freed).toBe(9_437_184)
    await expect(forgetTorrent(INFO_HASH)).rejects.toMatchObject({
      kind: 'not_found',
    })
  })

  it('перенос в другой каталог: ход переноса, раздача на переезде — moving', async () => {
    fetchMock.mockResolvedValueOnce(json(moveState('/big', 'running'), 202))
    fetchMock.mockResolvedValueOnce(json(moveState('/big')))
    fetchMock.mockResolvedValueOnce(
      json(engineError('torrent_moving', 'torrent is being moved'), 409),
    )

    expect(await moveTorrent(INFO_HASH, '/big')).toMatchObject({
      state: 'running',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      dir: '/big',
    })
    expect(await torrentMoveState(INFO_HASH)).toMatchObject({ state: 'done' })
    await expect(pauseTorrent(INFO_HASH)).rejects.toMatchObject({
      kind: 'moving',
    })
  })

  it('добавление в свой каталог — параметр dir', async () => {
    fetchMock.mockResolvedValueOnce(json(movieDetails))

    await addTorrent(new Uint8Array([1]), [0, 2], '/big/torrents')

    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      '?files=0,2&dir=%2Fbig%2Ftorrents',
    )
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

  it('поток с окном передаёт его движку', async () => {
    fetchMock.mockResolvedValueOnce(new Response('abc', { status: 206 }))

    await openStream(
      INFO_HASH,
      1,
      undefined,
      new AbortController().signal,
      64 * 1024 * 1024,
    )

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `http://127.0.0.1:4000/torrents/${INFO_HASH}/files/1/stream?window=67108864`,
    )
  })

  it('движок упал между запросами — unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(torrentStats(INFO_HASH)).rejects.toMatchObject({
      kind: 'unavailable',
    })
  })
})
