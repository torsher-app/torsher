import type { Playback, TorrentStats } from '@torsher/api-client'
import { effectScope } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlayback } from './usePlayback.ts'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  remove: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  diagnostic: vi.fn(),
  stats: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
    torrents: { getTorrentStats: mocks.stats },
    watchState: { putWatchState: mocks.save },
    playback: {
      postPlayback: mocks.post,
      deletePlayback: mocks.remove,
      getPlayback: mocks.get,
    },
  },
}))
vi.mock('../diagnostics/index.ts', async original => ({
  ...(await original<typeof import('../diagnostics/index.ts')>()),
  diagnostic: mocks.diagnostic,
}))
vi.mock('../i18n.ts', () => ({
  i18n: { global: { locale: { value: 'en_US' } } },
}))
vi.mock('../platform/android.ts', () => ({ nativeDeviceProfile: () => ({}) }))
vi.mock('../platform/webos.ts', () => ({ isWebos: () => false }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function ready(sessionId: string) {
  return { sessionId, status: 'ready', mode: 'direct' } as Playback
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  mocks.remove.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

const zeroPeers: TorrentStats = {
  activity: 'downloading',
  peers: { connected: 0, found: 0, seeders: 0 },
  downloadSpeed: 0,
  uploadSpeed: 0,
  badPieces: 0,
  file: { size: 100, downloaded: 0, bufferedAhead: 0 },
}

it('keeps last-success time separate from a missed poll and recovers on success', async () => {
  vi.setSystemTime(100_000)
  mocks.stats
    .mockResolvedValueOnce(zeroPeers)
    .mockRejectedValueOnce(new Error('503'))
    .mockResolvedValue(zeroPeers)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ torrentId: 'torrent', fileIndex: 0 }),
  )!
  player.pollStats(() => ({ offset: 0, intervalMs: 1000 }))
  await vi.advanceTimersByTimeAsync(0)
  expect(player.statsReceivedAt()).toBe(100_000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(player.statsFailed.value).toBe(true)
  expect(player.statsReceivedAt()).toBe(100_000)
  expect(player.stats.value).toEqual(zeroPeers)
  expect(mocks.post).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(player.statsFailed.value).toBe(false)
  expect(player.statsReceivedAt()).toBe(102_000)
  scope.stop()
})

it('lasting failures never advance the last successful timestamp or return cached data as fresh', async () => {
  vi.setSystemTime(100_000)
  mocks.stats
    .mockResolvedValueOnce(zeroPeers)
    .mockRejectedValue(new Error('503'))
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ torrentId: 'torrent', fileIndex: 0 }),
  )!
  player.pollStats(() => ({ offset: 0, intervalMs: 1000 }))
  await vi.advanceTimersByTimeAsync(20_000)
  expect(player.statsFailed.value).toBe(true)
  expect(player.statsReceivedAt()).toBe(100_000)
  expect(await player.freshStats(0)).toBeUndefined()
  expect(mocks.post).not.toHaveBeenCalled()
  scope.stop()
})

it('a late previous poll cannot overwrite current data, time or failure status', async () => {
  const old = deferred<TorrentStats>()
  const current = {
    ...zeroPeers,
    peers: { connected: 3, found: 3, seeders: 0 },
  }
  mocks.stats.mockReturnValueOnce(old.promise).mockResolvedValue(current)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ torrentId: 'torrent', fileIndex: 0 }),
  )!
  player.pollStats(() => ({ offset: 0, intervalMs: 1000 }))
  player.pollStats(() => ({ offset: 20, intervalMs: 1000 }))
  await vi.advanceTimersByTimeAsync(0)
  const received = player.statsReceivedAt()
  old.resolve(zeroPeers)
  await vi.advanceTimersByTimeAsync(0)
  expect(player.stats.value).toEqual(current)
  expect(player.statsReceivedAt()).toBe(received)
  expect(player.statsFailed.value).toBe(false)
  expect(vi.getTimerCount()).toBe(1)
  scope.stop()
})

it('freshStats discards a late result after the polling generation changed', async () => {
  const old = deferred<TorrentStats>()
  mocks.stats.mockReturnValueOnce(old.promise)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ torrentId: 'torrent', fileIndex: 0 }),
  )!
  const request = player.freshStats(0)
  player.stopStats()
  old.resolve(zeroPeers)
  expect(await request).toBeUndefined()
  scope.stop()
})

it('a poll from before a new playback launch cannot publish into its probe generation', async () => {
  const old = deferred<TorrentStats>()
  const startup = deferred<Playback>()
  mocks.stats.mockReturnValueOnce(old.promise).mockResolvedValue(zeroPeers)
  mocks.post.mockReturnValueOnce(startup.promise)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ torrentId: 'torrent', fileIndex: 0 }),
  )!
  player.pollStats(() => ({ offset: 0, intervalMs: 1000 }))
  const launching = player.start()
  old.resolve({ ...zeroPeers, peers: { connected: 9, found: 9, seeders: 0 } })
  await vi.advanceTimersByTimeAsync(0)
  expect(player.stats.value).toBeUndefined()
  expect(player.statsReceivedAt()).toBe(0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(player.stats.value).toEqual(zeroPeers)
  expect(player.status.value).toBe('loading')
  startup.resolve(ready('new'))
  await launching
  scope.stop()
})

it.each([false, true])(
  'keeps Off compatible with preference support=%s',
  async (supported) => {
    mocks.post.mockResolvedValue({
      ...ready('A'),
      ...(supported ? { preferenceMismatch: [] } : {}),
    })
    const scope = effectScope()
    const player = scope.run(() => usePlayback({ mediaFileId: 'file' }))!
    await player.start()
    await player.start({ audioStream: 2, subtitle: null, startPosition: 42 })
    expect(mocks.post.mock.lastCall?.[0]).toMatchObject({
      audioStream: 2,
      startPosition: 42,
      subtitle: supported ? null : undefined,
    })
    scope.stop()
  },
)

it('a late start A closes only A while the ready replacement B stays alive', async () => {
  const a = deferred<Playback>()
  const b = deferred<Playback>()
  mocks.post.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
  const scope = effectScope()
  const player = scope.run(() => usePlayback({ mediaFileId: 'file' }))!
  const startA = player.start()
  const startB = player.start()
  b.resolve(ready('B'))
  expect(await startB).toBe('ready')
  a.resolve(ready('A'))
  expect(await startA).toBe('stale')
  expect(player.playback.value?.sessionId).toBe('B')
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('A')
  scope.stop()
  expect(mocks.remove).toHaveBeenLastCalledWith('B')
})

it('unmount cancels a pending launch and closes its late server response', async () => {
  const a = deferred<Playback>()
  mocks.post.mockReturnValueOnce(a.promise)
  const scope = effectScope()
  const player = scope.run(() => usePlayback({ mediaFileId: 'file' }))!
  const start = player.start()
  scope.stop()
  a.resolve(ready('A'))
  expect(await start).toBe('stale')
  expect(player.playback.value).toBeUndefined()
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('A')
})

it('explicit close cancels a pending launch before unmount and never starts its heartbeat', async () => {
  const a = deferred<Playback>()
  mocks.post.mockReturnValueOnce(a.promise)
  const scope = effectScope()
  const player = scope.run(() => usePlayback({ mediaFileId: 'file' }))!
  const start = player.start({ audioStream: 2 })
  player.close()
  a.resolve(ready('A'))
  expect(await start).toBe('stale')
  expect(player.playback.value).toBeUndefined()
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('A')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(mocks.get).not.toHaveBeenCalled()
  scope.stop()
})

it('explicit close discards an in-flight probe result and leaves a replacement session alive', async () => {
  const probe = deferred<Playback>()
  mocks.post.mockResolvedValueOnce({ ...ready('A'), status: 'probing' })
  mocks.get.mockReturnValueOnce(probe.promise)
  const scope = effectScope()
  const player = scope.run(() => usePlayback({ mediaFileId: 'file' }))!
  const startA = player.start()
  await vi.advanceTimersByTimeAsync(1000)
  expect(mocks.get).toHaveBeenCalledOnce()
  player.close()
  probe.resolve(ready('A'))
  expect(await startA).toBe('stale')
  expect(player.playback.value).toBeUndefined()
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('A')
  mocks.post.mockResolvedValueOnce(ready('B'))
  expect(await player.start()).toBe('ready')
  expect(player.playback.value?.sessionId).toBe('B')
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('A')
  scope.stop()
})

it('keeps every business save but bounds successful checkpoint observations over two hours', async () => {
  mocks.save.mockResolvedValue(undefined)
  const scope = effectScope()
  const player = scope.run(() => usePlayback({ mediaFileId: 'file-00001' }))!
  for (let i = 0; i < 720; i++) {
    await player.saveWatchState(i * 10, 7200)
    vi.advanceTimersByTime(10_000)
  }
  expect(mocks.save).toHaveBeenCalledTimes(720)
  const progress = mocks.diagnostic.mock.calls.filter(([event]) =>
    event.event.startsWith('progress.'),
  )
  expect(progress).toHaveLength(40)
  await player.saveWatchState(7190, 7200, 'exit')
  expect(
    mocks.diagnostic.mock.calls.slice(-2).map(([event]) => event.event),
  ).toEqual(['progress.requested', 'progress.result'])
  scope.stop()
})
it('observes swallowed checkpoint failures even between throttled successful snapshots', async () => {
  mocks.save
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('offline'))
  const scope = effectScope()
  const player = scope.run(() => usePlayback({ mediaFileId: 'file-00001' }))!
  await player.saveWatchState(10, 100)
  await expect(player.saveWatchState(20, 100)).resolves.toBeUndefined()
  expect(mocks.diagnostic).toHaveBeenLastCalledWith(
    expect.objectContaining({
      event: 'progress.result',
      outcome: 'network_error',
      position: 20,
    }),
    expect.any(Object),
    true,
  )
  scope.stop()
})

it('keeps the originating viewer profile on final saves after closing the session', async () => {
  mocks.post.mockResolvedValue(ready('origin-session'))
  mocks.save.mockResolvedValue(undefined)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback(
      { mediaFileId: 'file-00001' },
      undefined,
      undefined,
      {},
      'origin-profile',
    ),
  )!
  await player.start()
  player.close()
  await player.saveWatchState(10, 100, 'exit')
  expect(mocks.save.mock.calls[0]![0]).toMatchObject({
    profileId: 'origin-profile',
    mediaFileId: 'file-00001',
    position: 10,
  })
  scope.stop()
})
