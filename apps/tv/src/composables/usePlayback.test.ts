import type { Playback } from '@torsher/api-client'
import { effectScope } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlayback } from './usePlayback.ts'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  remove: vi.fn(),
  get: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
    playback: {
      postPlayback: mocks.post,
      deletePlayback: mocks.remove,
      getPlayback: mocks.get,
    },
  },
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
