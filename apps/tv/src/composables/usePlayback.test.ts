import type { Playback } from '@torsher/api-client'
import { effectScope } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlayback } from './usePlayback.ts'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  remove: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  diagnostic: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
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
