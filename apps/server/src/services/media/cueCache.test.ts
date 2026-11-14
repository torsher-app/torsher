import type { Torrent } from '../../db/schema.ts'
import type { MatroskaCues, RangeReader } from './matroska.ts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  clearCueCache,
  cueRangeReader,
  loadTorrentCues,
  peekPlaybackIndex,
} from './cueCache.ts'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  stats: vi.fn(),
  maintenance: vi.fn(),
  stream: vi.fn(),
  releases: [] as ReturnType<typeof vi.fn>[],
}))
vi.mock('./matroska.ts', () => ({ readMatroskaCues: mocks.parse }))
vi.mock('../engine/index.ts', () => ({
  engineStreamUrl: () => 'http://synthetic.invalid/stream',
  torrentStats: mocks.stats,
}))
vi.mock('../libraryMaintenance/admission.ts', () => ({
  acquireMaintenanceLease: mocks.maintenance,
}))
vi.mock('../storage/index.ts', () => ({ trackStream: mocks.stream }))
function torrent(key = 'synthetic', size = 1000) {
  return {
    id: key,
    infoHash: key,
    files: [{ size }],
    pieceLength: 100,
  } as Torrent
}
const value: MatroskaCues = {
  times: [0, 5],
  playbackIndex: [
    { offset: 20, minTime: 0, maxTime: 0 },
    { offset: 500, minTime: 5, maxTime: 5 },
  ],
}
function response(start = 0, end = 8, size = 1000) {
  return new Response(new Uint8Array(end - start), {
    status: 206,
    headers: { 'content-range': `bytes ${start}-${end - 1}/${size}` },
  })
}
beforeEach(() => {
  clearCueCache()
  vi.clearAllMocks()
  mocks.releases = []
  mocks.stats.mockResolvedValue({ pieces: '1'.repeat(10) })
  for (const acquire of [mocks.maintenance, mocks.stream]) {
    acquire.mockImplementation(() => {
      const release = vi.fn()
      mocks.releases.push(release)
      return release
    })
  }
  mocks.parse.mockImplementation(async (read: RangeReader) => {
    await read(0, 8)
    return value
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  )
})
afterEach(() => {
  clearCueCache()
  vi.unstubAllGlobals()
})

it('shares one read and leases while a viewer leaves; stats peek starts no IO', async () => {
  let resolve!: (response: Response) => void
  let signal!: AbortSignal
  vi.mocked(fetch).mockImplementation((_url, options) => {
    signal = options!.signal as AbortSignal
    return new Promise((done) => {
      resolve = done
    })
  })
  const first = new AbortController()
  const second = new AbortController()
  expect(peekPlaybackIndex('synthetic', 0, 1000)).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
  const a = loadTorrentCues(torrent(), 0, first.signal)
  const b = loadTorrentCues(torrent(), 0, second.signal)
  await Promise.resolve()
  await Promise.resolve()
  first.abort()
  expect(signal.aborted).toBe(false)
  resolve(response())
  expect(await a).toEqual(value)
  expect(await b).toEqual(value)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(
    mocks.releases.every(release => release.mock.calls.length === 1),
  ).toBe(true)
  expect(peekPlaybackIndex('synthetic', 0, 1000)).toEqual(value.playbackIndex)
  expect(peekPlaybackIndex('synthetic', 0, 1001)).toBeNull()
  await loadTorrentCues(torrent(), 0, new AbortController().signal)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('aborts after the last subscriber and retries transient failures on the next preparation', async () => {
  vi.mocked(fetch).mockImplementation(
    (_url, options) =>
      new Promise((_done, reject) => {
        options!.signal!.addEventListener(
          'abort',
          () => reject(new Error('cancelled')),
          { once: true },
        )
      }),
  )
  const controller = new AbortController()
  const pending = loadTorrentCues(torrent(), 0, controller.signal)
  await Promise.resolve()
  await Promise.resolve()
  controller.abort()
  expect(await pending).toBeNull()
  expect(
    mocks.releases.every(release => release.mock.calls.length === 1),
  ).toBe(true)
  vi.mocked(fetch).mockResolvedValue(response())
  expect(
    await loadTorrentCues(torrent(), 0, new AbortController().signal),
  ).toEqual(value)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('bounds concurrent loads and evicts old positive and negative entries', async () => {
  const controllers = Array.from({ length: 5 }, () => new AbortController())
  const complete: (() => void)[] = []
  mocks.parse.mockImplementation(
    () => new Promise(done => complete.push(() => done(null))),
  )
  const pending = controllers.map((controller, i) =>
    loadTorrentCues(torrent(`file${i}`), 0, controller.signal),
  )
  await Promise.resolve()
  await Promise.resolve()
  expect(mocks.parse).toHaveBeenCalledTimes(4)
  expect(await pending[4]).toBeNull()
  complete.forEach(done => done())
  await Promise.all(pending)
  mocks.parse.mockResolvedValue(value)
  for (let i = 0; i <= 100; i++) {
    await loadTorrentCues(
      torrent(`entry${i}`),
      0,
      new AbortController().signal,
    )
  }
  expect(peekPlaybackIndex('entry0', 0, 1000)).toBeNull()
  expect(peekPlaybackIndex('entry100', 0, 1000)).toEqual(value.playbackIndex)
  mocks.parse.mockResolvedValue(null)
  await loadTorrentCues(torrent('negative'), 0, new AbortController().signal)
  const calls = mocks.parse.mock.calls.length
  await loadTorrentCues(torrent('negative'), 0, new AbortController().signal)
  expect(mocks.parse).toHaveBeenCalledTimes(calls)
})

it('bounds total cached points as well as entry count', async () => {
  mocks.parse.mockResolvedValue({
    times: Array.from({ length: 60_000 }, (_, i) => i),
    playbackIndex: value.playbackIndex,
  })
  for (let i = 0; i < 4; i++) {
    await loadTorrentCues(
      torrent(`large${i}`),
      0,
      new AbortController().signal,
    )
  }
  expect(peekPlaybackIndex('large0', 0, 1000)).toBeNull()
  expect(peekPlaybackIndex('large3', 0, 1000)).toEqual(value.playbackIndex)
})

it('rejects ignored Range, malformed Content-Range, oversized and truncated bodies', async () => {
  const read = () =>
    cueRangeReader(
      'http://synthetic.invalid/stream',
      1000,
      new AbortController().signal,
    )(0, 8)
  for (const invalid of [
    new Response(new Uint8Array(1000), { status: 200 }),
    new Response(new Uint8Array(8), {
      status: 206,
      headers: { 'content-range': 'bytes 0-7/999' },
    }),
    new Response(new Uint8Array(9), {
      status: 206,
      headers: { 'content-range': 'bytes 0-7/1000' },
    }),
    new Response(new Uint8Array(7), {
      status: 206,
      headers: { 'content-range': 'bytes 0-7/1000' },
    }),
  ]) {
    vi.mocked(fetch).mockResolvedValueOnce(invalid)
    await expect(read()).rejects.toThrow()
  }
  expect(fetch).toHaveBeenCalledTimes(4)
  await expect(
    cueRangeReader(
      'http://synthetic.invalid/stream',
      1000,
      new AbortController().signal,
    )(-1, 8),
  ).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(4)
})

it('enforces per-range and total read budgets before opening another request', async () => {
  const read = cueRangeReader(
    'http://synthetic.invalid/stream',
    20 * 1024 * 1024,
    new AbortController().signal,
  )
  await expect(read(0, 9 * 1024 * 1024)).rejects.toThrow('budget')
  expect(fetch).not.toHaveBeenCalled()
  vi.mocked(fetch).mockRejectedValueOnce(new Error('transient'))
  await expect(read(0, 7 * 1024 * 1024)).rejects.toThrow('transient')
  await expect(read(0, 6 * 1024 * 1024)).rejects.toThrow('budget')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('retries a transport failure on a later preparation', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('transient'))
  expect(
    await loadTorrentCues(torrent(), 0, new AbortController().signal),
  ).toBeNull()
  expect(
    await loadTorrentCues(torrent(), 0, new AbortController().signal),
  ).toEqual(value)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('does not persist corrupt unverified structural negatives at the same hash', async () => {
  mocks.stats.mockResolvedValueOnce({ pieces: '0'.repeat(10) })
  mocks.parse.mockImplementationOnce(async (read: RangeReader) => {
    await read(0, 8)
    return null
  })
  expect(
    await loadTorrentCues(torrent(), 0, new AbortController().signal),
  ).toBeNull()
  expect(
    await loadTorrentCues(torrent(), 0, new AbortController().signal),
  ).toEqual(value)
  expect(mocks.parse).toHaveBeenCalledTimes(2)
})

it('keeps structurally valid unverified metadata out of strict cache until a verified reread', async () => {
  const unverified = {
    times: [0, 99],
    playbackIndex: [{ offset: 900, minTime: 0, maxTime: 99 }],
  }
  mocks.stats.mockResolvedValueOnce({ pieces: '0'.repeat(10) })
  mocks.parse.mockImplementationOnce(async (read: RangeReader) => {
    await read(0, 8)
    return unverified
  })
  expect(
    await loadTorrentCues(torrent(), 0, new AbortController().signal),
  ).toEqual({ times: [0, 99], playbackIndex: null })
  expect(peekPlaybackIndex('synthetic', 0, 1000)).toBeNull()
  expect(
    await loadTorrentCues(torrent(), 0, new AbortController().signal),
  ).toEqual(value)
  expect(peekPlaybackIndex('synthetic', 0, 1000)).toEqual(value.playbackIndex)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('does not trust metadata in a hybrid or ambiguous second file using the first file piece', async () => {
  const smallValue: MatroskaCues = {
    times: [0, 5],
    playbackIndex: [
      { offset: 10, minTime: 0, maxTime: 0 },
      { offset: 30, minTime: 5, maxTime: 5 },
    ],
  }
  mocks.parse.mockImplementation(async (read: RangeReader) => {
    await read(0, 8)
    return smallValue
  })
  for (const size of [50, 60]) {
    const source = {
      ...torrent(`layout${size}`),
      pieceLength: 100,
      files: [
        { size, path: 'first.mkv', padding: false },
        { size, path: 'second.mkv', padding: false },
      ],
    }
    mocks.stats.mockResolvedValue({ pieces: '10' })
    vi.mocked(fetch).mockImplementation(async () => response(0, 8, size))
    expect(
      await loadTorrentCues(source, 1, new AbortController().signal),
    ).toEqual({ ...smallValue, playbackIndex: null })
    expect(peekPlaybackIndex(source.infoHash, 1, size)).toBeNull()
    mocks.stats.mockResolvedValue({ pieces: '11' })
    expect(
      await loadTorrentCues(source, 1, new AbortController().signal),
    ).toEqual(smallValue)
    expect(peekPlaybackIndex(source.infoHash, 1, size)).toEqual(
      smallValue.playbackIndex,
    )
  }
})

it('applies the shared deadline to the metadata verification stats request and releases both leases', async () => {
  const deadline = new AbortController()
  const timeout = vi
    .spyOn(AbortSignal, 'timeout')
    .mockReturnValue(deadline.signal)
  mocks.stats.mockImplementation(
    (_hash: string, signal: AbortSignal) =>
      new Promise((_done, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        })
      }),
  )
  const pending = loadTorrentCues(torrent(), 0, new AbortController().signal)
  await Promise.resolve()
  deadline.abort()
  expect(await pending).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
  expect(
    mocks.releases.every(release => release.mock.calls.length === 1),
  ).toBe(true)
  timeout.mockRestore()
})
