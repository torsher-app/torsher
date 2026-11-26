import type {
  CreatePlaybackInput,
  Playback,
  TorrentStats,
} from '@torsher/api-client'
import { effectScope } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlayback } from './usePlayback.ts'
import {
  restartScope,
  saveRestart,
  stageViewingRestart,
  viewingRestartFor,
} from '../lib/viewingRestart.ts'
import {
  setTitleViewer,
  titleActions,
  titleProgressVersion,
} from '../titleActions.ts'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  remove: vi.fn(),
  get: vi.fn(),
  getViewingAttempt: vi.fn(),
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
      getViewingAttempt: mocks.getViewingAttempt,
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
  setTitleViewer(undefined)
  setTitleViewer('A')
  mocks.remove.mockResolvedValue(undefined)
})

it('notifies only successful saves, including library files without a client title ID', async () => {
  mocks.save
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('offline'))
  const scope = effectScope()
  const player = scope.run(() => usePlayback({ mediaFileId: 'local-file' }))!
  const version = titleActions.version
  const progress = titleProgressVersion('server-matched-title')
  await player.saveWatchState(10, 100)
  expect(titleActions.version).toBe(version + 1)
  expect(titleProgressVersion('server-matched-title')).not.toBe(progress)
  await player.saveWatchState(20, 100)
  expect(titleActions.version).toBe(version + 1)
  scope.stop()
})

it('keeps notification scope captured at player creation after A/B/A, even for later saves', async () => {
  const save = deferred<void>()
  mocks.save.mockReturnValueOnce(save.promise).mockResolvedValue(undefined)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ mediaFileId: 'local-file' }, undefined, undefined, {}, 'A'),
  )!
  const pending = player.saveWatchState(10, 100)
  setTitleViewer('B')
  setTitleViewer('A')
  const version = titleActions.version
  save.resolve()
  await pending
  await player.saveWatchState(20, 100, 'exit')
  expect(titleActions.version).toBe(version)
  expect(mocks.save.mock.calls[1]![0]).toMatchObject({ profileId: 'A' })
  scope.stop()
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
  let offset = 0
  player.pollStats(() => ({ offset: (offset += 10), intervalMs: 1000 }))
  await vi.advanceTimersByTimeAsync(0)
  expect(player.statsReceivedAt()).toBe(100_000)
  expect(player.statsOffset()).toBe(10)
  await vi.advanceTimersByTimeAsync(1000)
  expect(player.statsFailed.value).toBe(true)
  expect(player.statsReceivedAt()).toBe(100_000)
  expect(player.statsOffset()).toBe(10)
  expect(player.stats.value).toEqual(zeroPeers)
  expect(mocks.post).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(player.statsFailed.value).toBe(false)
  expect(player.statsReceivedAt()).toBe(102_000)
  expect(player.statsOffset()).toBe(30)
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
  expect(player.statsOffset()).toBe(20)
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
  setTitleViewer('B')
  await player.saveWatchState(10, 100, 'exit', undefined, {
    sessionId: 'origin-session',
    appliedAudioStream: 2,
  })
  expect(mocks.remove).toHaveBeenCalledWith('origin-session')
  expect(mocks.save.mock.calls[0]![0]).toMatchObject({
    profileId: 'origin-profile',
    mediaFileId: 'file-00001',
    sessionId: 'origin-session',
    appliedAudioStream: 2,
    position: 10,
  })
  scope.stop()
})

it('requests actual playback time without inventing a diagnostic byte offset', async () => {
  mocks.stats.mockResolvedValue(zeroPeers)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ torrentId: 'torrent', fileIndex: 0 }),
  )!
  player.pollStats(() => ({ time: 3990.612, intervalMs: 1000 }))
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.stats).toHaveBeenCalledWith('torrent', {
    fileIndex: '0',
    time: '3990.612',
  })
  expect(player.statsOffset()).toBeUndefined()
  await player.freshStats(3990.612)
  expect(mocks.stats).toHaveBeenLastCalledWith('torrent', {
    fileIndex: '0',
    time: '3990.612',
  })
  scope.stop()
})

it('discards a time sample that resolves after a seek before the next tick', async () => {
  const pending = deferred<TorrentStats>()
  mocks.stats.mockReturnValueOnce(pending.promise)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ torrentId: 'torrent', fileIndex: 0 }),
  )!
  let time = 100
  player.pollStats(() => ({ time, intervalMs: 1000 }))
  time = 500
  pending.resolve(zeroPeers)
  await vi.advanceTimersByTimeAsync(0)
  expect(player.stats.value).toBeUndefined()
  expect(player.statsReceivedAt()).toBe(0)
  scope.stop()
})

it('orders checkpoints and backward seeks across player instances without waiting for old requests', async () => {
  const old = deferred<void>()
  mocks.save.mockReturnValueOnce(old.promise).mockResolvedValue(undefined)
  const scope = effectScope()
  const a = scope.run(() => usePlayback({ mediaFileId: 'A' }))!
  const pending = a.saveWatchState(798, 2000)
  await a.saveWatchState(921, 2000, 'exit')
  const b = scope.run(() => usePlayback({ mediaFileId: 'B' }))!
  await b.saveWatchState(20, 2000)
  const again = scope.run(() => usePlayback({ mediaFileId: 'A' }))!
  await again.saveWatchState(200, 2000, 'pause')
  const events = mocks.save.mock.calls.map(call => call[0].event)
  expect(new Set(events.map(event => event.clientId)).size).toBe(1)
  expect(events.map(event => event.sequence)).toEqual([
    events[0].sequence,
    events[0].sequence + 1,
    events[0].sequence + 2,
    events[0].sequence + 3,
  ])
  old.resolve()
  await pending
  scope.stop()
})

it('retries a lost explicit restart with the same request ID and expected generation', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  const previous = {
    attemptId: 'old',
    generation: 3,
    state: 'completed' as const,
  }
  const current = { attemptId: 'new', generation: 4, state: 'open' as const }
  mocks.getViewingAttempt.mockResolvedValue({ attempt: previous })
  mocks.post
    .mockRejectedValueOnce(new Error('lost response'))
    .mockResolvedValue({ ...ready('new-session'), viewing: current })
  const title = { id: 'tmdb:movie:10' }
  const key = restartScope('A', title)
  const restart = stageViewingRestart(key)
  const create = () =>
    usePlayback({ mediaFileId: 'file' }, title, undefined, {}, 'A')
  const scope = effectScope()
  const player = scope.run(create)!
  await player.start({ startPosition: 0 }, restart)
  scope.stop()
  const reloaded = effectScope()
  const retry = reloaded.run(create)!
  const stored = viewingRestartFor(key, restart.requestId)
  expect(stored?.expectedGeneration).toBe(3)
  expect(await retry.start({ startPosition: 0 }, stored)).toBe('ready')
  expect(mocks.getViewingAttempt).toHaveBeenCalledTimes(1)
  const first = mocks.post.mock.calls[0]![0].viewing
  expect(first).toMatchObject({ intent: 'restart', expectedGeneration: 3 })
  expect(mocks.post.mock.calls[1]![0].viewing).toMatchObject({
    requestId: first.requestId,
    intent: 'restart',
    expectedGeneration: 3,
  })
  expect(mocks.post.mock.calls[1]![0].viewing.playerId).not.toBe(
    first.playerId,
  )
  reloaded.stop()
  const readyReloaded = effectScope()
  const continued = readyReloaded.run(create)!
  expect(viewingRestartFor(key, restart.requestId)?.consumed).toBe(true)
  await continued.start()
  expect(mocks.post.mock.calls[2]![0].viewing).toMatchObject({
    intent: 'join',
  })
  expect(mocks.post.mock.calls[2]![0].viewing.requestId).not.toBe(
    first.requestId,
  )
  readyReloaded.stop()
  vi.unstubAllGlobals()
})

it.each([false, true])(
  'replays the newer history restart once after reload (first POST accepted: %s)',
  async (acceptedBeforeLoss) => {
    const storage = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    try {
      const title = { id: 'tmdb:movie:10' }
      const key = restartScope('A', title)
      const oldRoute = stageViewingRestart(key)
      saveRestart({ ...oldRoute, expectedGeneration: 2, consumed: true })
      const restart = stageViewingRestart(key, 'player-history-entry')
      let generation = 3
      let applied: string | undefined
      let posts = 0
      mocks.getViewingAttempt.mockImplementation(async () => ({
        attempt: { generation },
      }))
      mocks.post.mockImplementation(async (body: CreatePlaybackInput) => {
        const request = body.viewing!
        posts++
        if (
          (posts > 1 || acceptedBeforeLoss)
          && request.intent === 'restart'
          && applied !== request.requestId
        ) {
          expect(request.expectedGeneration).toBe(generation)
          generation++
          applied = request.requestId
        }
        if (posts === 1)
          throw new Error('lost response')
        return {
          ...ready('reloaded'),
          viewing: { attemptId: 'attempt', generation, state: 'open' },
        }
      })
      const create = () =>
        usePlayback({ mediaFileId: 'file' }, title, undefined, {}, 'A')
      const original = effectScope()
      await original.run(create)!.start({ startPosition: 0 }, restart)
      original.stop()
      vi.resetModules()
      const fresh = await import('../lib/viewingRestart.ts')
      const persisted = fresh.viewingRestartFor(
        key,
        oldRoute.requestId,
        'player-history-entry',
      )
      expect(persisted).toMatchObject({
        requestId: restart.requestId,
        expectedGeneration: 3,
      })
      expect(
        fresh.viewingRestartFor(key, restart.requestId, 'other-history-entry'),
      ).toBeUndefined()
      expect(
        fresh.viewingRestartFor(
          restartScope('B', title),
          oldRoute.requestId,
          'player-history-entry',
        ),
      ).toBeUndefined()
      const reloaded = effectScope()
      expect(
        await reloaded.run(create)!.start({ startPosition: 0 }, persisted),
      ).toBe('ready')
      reloaded.stop()
      expect(mocks.post.mock.lastCall?.[0].viewing).toMatchObject({
        requestId: restart.requestId,
        expectedGeneration: 3,
      })
      expect(mocks.getViewingAttempt).toHaveBeenCalledOnce()
      expect(generation).toBe(4)
      expect(
        fresh.viewingRestartFor(key, oldRoute.requestId, 'player-history-entry')
          ?.consumed,
      ).toBe(true)
    }
    finally {
      vi.unstubAllGlobals()
    }
  },
)

it('never rebases an unprepared stored restart after the pinned CAS could not be saved', async () => {
  let stored: string | null = null
  const writes = vi.fn((_key: string, value: string) => {
    if (stored)
      throw new Error('quota')
    stored = value
  })
  const removeItem = vi.fn(() => {
    throw new Error('storage unavailable')
  })
  vi.stubGlobal('sessionStorage', {
    getItem: () => stored,
    setItem: writes,
    removeItem,
  })
  try {
    const title = { id: 'tmdb:movie:10' }
    const key = restartScope('A', title)
    const restart = stageViewingRestart(key)
    const create = () =>
      usePlayback({ mediaFileId: 'file' }, title, undefined, {}, 'A')
    let generation = 3
    mocks.getViewingAttempt.mockImplementation(async () => ({
      attempt: { generation },
    }))
    mocks.post
      .mockRejectedValueOnce(new Error('request lost before acceptance'))
      .mockImplementation(async (body: CreatePlaybackInput) => {
        if (body.viewing?.intent === 'restart')
          generation++
        return {
          ...ready('joined'),
          viewing: { attemptId: 'current', generation, state: 'open' },
        }
      })
    const original = effectScope()
    await original.run(create)!.start({ startPosition: 0 }, restart)
    original.stop()
    expect(writes).toHaveBeenCalledTimes(2)
    expect(removeItem).toHaveBeenCalledOnce()
    expect(mocks.post.mock.calls[0]![0].viewing).toMatchObject({
      requestId: restart.requestId,
      intent: 'restart',
      expectedGeneration: 3,
    })
    expect(JSON.parse(stored!)).not.toHaveProperty('expectedGeneration')

    generation = 4
    vi.resetModules()
    const fresh = await import('../lib/viewingRestart.ts')
    const persisted = fresh.viewingRestartFor(key, restart.requestId)
    expect(persisted).toBeUndefined()
    const reloaded = effectScope()
    expect(await reloaded.run(create)!.start(undefined, persisted)).toBe(
      'ready',
    )
    reloaded.stop()
    expect(mocks.post.mock.lastCall?.[0].viewing).toMatchObject({
      intent: 'join',
    })
    expect(mocks.getViewingAttempt).toHaveBeenCalledOnce()
    expect(generation).toBe(4)
  }
  finally {
    vi.unstubAllGlobals()
  }
})

it('captures seek lines and binding identity before a new source session opens', async () => {
  const viewing = {
    attemptId: 'attempt',
    generation: 1,
    state: 'open' as const,
  }
  mocks.post
    .mockResolvedValueOnce({ ...ready('before'), viewing })
    .mockResolvedValueOnce({ ...ready('after'), viewing })
  mocks.save.mockResolvedValue({ accepted: true })
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ mediaFileId: 'file' }, { id: 'tmdb:movie:10' }),
  )!
  await player.start()
  const old = player.captureCheckpoint('playback', 2)
  const seek = player.captureCheckpoint('seek')
  const seekFollowup = player.captureCheckpoint('playback')
  await player.start({ startPosition: 350 })
  const current = player.captureCheckpoint('playback')
  await player.saveWatchState(950, 1000, 'exit', undefined, old)
  await player.saveWatchState(350, 1000, 'checkpoint', undefined, current)
  expect(seek.viewing).toMatchObject({ line: 1, kind: 'seek' })
  expect(seekFollowup.viewing).toMatchObject({ line: 1, kind: 'playback' })
  const playerId = mocks.post.mock.calls[0]![0].viewing.playerId
  expect(mocks.save.mock.calls[0]![0]).toMatchObject({
    sessionId: 'before',
    appliedAudioStream: 2,
    viewing: { playerId, line: 0, kind: 'playback' },
  })
  expect(mocks.save.mock.calls[1]![0]).toMatchObject({
    sessionId: 'after',
    viewing: { playerId, line: 0, kind: 'playback' },
  })
  scope.stop()
})

it('closes a catalog playback response missing its binding instead of sending legacy progress', async () => {
  mocks.post.mockResolvedValue(ready('no-binding'))
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ mediaFileId: 'file' }, { id: 'tmdb:movie:10' }),
  )!
  expect(await player.start()).toBe('error')
  expect(mocks.remove).toHaveBeenCalledWith('no-binding')
  await player.saveWatchState(
    350,
    1000,
    'exit',
    undefined,
    player.captureCheckpoint('stop'),
  )
  expect(mocks.save).not.toHaveBeenCalled()
  scope.stop()
})

it('discards the old restart lookup after the viewer changes away and back', async () => {
  const lookup = deferred<{ attempt: null }>()
  mocks.getViewingAttempt.mockReturnValue(lookup.promise)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback(
      { mediaFileId: 'file' },
      { id: 'tmdb:movie:10' },
      undefined,
      {},
      'A',
    ),
  )!
  const start = player.start(
    { startPosition: 0 },
    stageViewingRestart(restartScope('A', { id: 'tmdb:movie:10' })),
  )
  setTitleViewer('B')
  setTitleViewer('A')
  lookup.resolve({ attempt: null })
  expect(await start).toBe('stale')
  expect(mocks.getViewingAttempt).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ profileId: 'A' }),
  )
  expect(mocks.post).not.toHaveBeenCalled()
  scope.stop()
})

it('requires the original generation on reconnect and ignores a rejected obsolete session', async () => {
  const viewing = {
    attemptId: 'attempt',
    generation: 3,
    state: 'open' as const,
  }
  mocks.post
    .mockResolvedValueOnce({ ...ready('old-line'), viewing })
    .mockResolvedValueOnce({ ...ready('fresh-line'), viewing })
    .mockResolvedValueOnce({
      ...ready('superseded'),
      viewing: { ...viewing, state: 'abandoned', current: false },
    })
  const oldRequest = deferred<{
    accepted: false
    rejection: 'viewingConflict'
  }>()
  mocks.save
    .mockReturnValueOnce(oldRequest.promise)
    .mockResolvedValueOnce({ accepted: false, rejection: 'stale' })
    .mockResolvedValueOnce({ accepted: false, rejection: 'viewingConflict' })
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback({ mediaFileId: 'file' }, { id: 'tmdb:movie:10' }),
  )!
  await player.start()
  const old = player.saveWatchState(
    350,
    1000,
    'checkpoint',
    undefined,
    player.captureCheckpoint('playback'),
  )
  await player.start({ startPosition: 350 })
  oldRequest.resolve({ accepted: false, rejection: 'viewingConflict' })
  await old
  expect(player.status.value).toBe('ready')
  await player.saveWatchState(
    360,
    1000,
    'checkpoint',
    undefined,
    player.captureCheckpoint('playback'),
  )
  expect(player.status.value).toBe('ready')
  await player.saveWatchState(
    370,
    1000,
    'checkpoint',
    undefined,
    player.captureCheckpoint('playback'),
  )
  expect(player.status.value).toBe('error')
  expect(mocks.remove).toHaveBeenCalledWith('fresh-line')
  expect(await player.start({ startPosition: 370 })).toBe('error')
  expect(mocks.post.mock.lastCall?.[0].viewing).toMatchObject({
    intent: 'join',
    expectedGeneration: 3,
  })
  expect(mocks.remove).toHaveBeenCalledWith('superseded')
  scope.stop()
})

it('keeps an HTTP add-on session during reconfiguration and saves only its scoped checkpoint', async () => {
  const requested = deferred<Playback>()
  mocks.post
    .mockResolvedValueOnce(ready('remote-first'))
    .mockReturnValueOnce(requested.promise)
  mocks.save.mockResolvedValue({})
  const scope = effectScope()
  const title = { id: 'tmdb:tv:42', season: 0, episode: 2 }
  const player = scope.run(() =>
    usePlayback({ addonLaunchId: 'opaque-launch' }, title, undefined, {}, 'A'),
  )!
  expect(await player.start()).toBe('ready')
  expect(mocks.post.mock.calls[0]![0]).toMatchObject({
    addonLaunchId: 'opaque-launch',
    addonSubtitles: true,
    profileId: 'A',
    title,
  })
  expect(mocks.post.mock.calls[0]![0].viewing).toBeUndefined()
  const selection = player.start({ audioStream: 3, startPosition: 11 })
  expect(mocks.post.mock.calls[1]![0]).toMatchObject({
    addonSessionId: 'remote-first',
    addonSubtitles: true,
    audioStream: 3,
    startPosition: 11,
  })
  expect(mocks.post.mock.calls[1]![0]).not.toHaveProperty('addonLaunchId')
  expect(mocks.remove).not.toHaveBeenCalled()
  requested.resolve(ready('remote-new'))
  expect(await selection).toBe('ready')
  expect(mocks.remove).toHaveBeenCalledWith('remote-first')
  player.pollStats(() => ({ intervalMs: 1000 }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(mocks.stats).not.toHaveBeenCalled()
  await player.saveWatchState(
    12,
    100,
    'checkpoint',
    {},
    player.captureCheckpoint('pause'),
  )
  const checkpoint = mocks.save.mock.calls[0]![0]
  expect(checkpoint).toMatchObject({
    addonHttp: true,
    sessionId: 'remote-new',
    profileId: 'A',
    title,
    position: 12,
  })
  expect(checkpoint).not.toHaveProperty('addonLaunchId')
  expect(checkpoint).not.toHaveProperty('torrentId')
  expect(checkpoint).not.toHaveProperty('mediaFileId')
  expect(checkpoint.viewing).toBeUndefined()
  expect(JSON.stringify(mocks.diagnostic.mock.calls)).not.toContain(
    'opaque-launch',
  )
  scope.stop()
})

it('coalesces the single-use HTTP launch while it is still pending', async () => {
  const requested = deferred<Playback>()
  mocks.post.mockReturnValue(requested.promise)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback(
      { addonLaunchId: 'opaque-launch' },
      { id: 'tmdb:movie:42' },
      undefined,
      {},
      'A',
    ),
  )!

  const initial = player.start()
  const repeated = player.start()
  expect(mocks.post).toHaveBeenCalledTimes(1)
  requested.resolve(ready('active-http'))
  expect(await initial).toBe('ready')
  expect(await repeated).toBe('ready')
  expect(mocks.remove).not.toHaveBeenCalled()
  scope.stop()
})

it('uses distinct HTTP reconfiguration operations and closes only the obsolete result', async () => {
  const first = deferred<Playback>()
  const second = deferred<Playback>()
  mocks.post
    .mockResolvedValueOnce(ready('original-http'))
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback(
      { addonLaunchId: 'opaque-launch' },
      { id: 'tmdb:movie:42' },
      undefined,
      {},
      'A',
    ),
  )!

  await player.start()
  const old = player.start({ audioStream: 1 })
  const current = player.start({ audioStream: 2 })
  const [older, newer] = mocks.post.mock.calls.slice(1).map(([body]) => body)
  expect(older).toMatchObject({
    addonSessionId: 'original-http',
    addonOperationId: expect.any(String),
    audioStream: 1,
  })
  expect(newer).toMatchObject({
    addonSessionId: 'original-http',
    addonOperationId: expect.any(String),
    audioStream: 2,
  })
  expect(older.addonOperationId).not.toBe(newer.addonOperationId)
  expect(mocks.remove).not.toHaveBeenCalled()

  second.resolve(ready('current-http'))
  expect(await current).toBe('ready')
  first.resolve(ready('obsolete-http'))
  expect(await old).toBe('stale')
  expect(player.playback.value?.sessionId).toBe('current-http')
  expect(mocks.remove.mock.calls.map(([id]) => id)).toEqual([
    'original-http',
    'obsolete-http',
  ])
  scope.stop()
})
