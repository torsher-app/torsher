import { effectScope } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

class FakeHls {
  static instances: FakeHls[] = []
  static isSupported = () => true
  static Events = {
    ERROR: 'error',
    FRAG_BUFFERED: 'buffered',
    INIT_PTS_FOUND: 'initPts',
  }

  static ErrorDetails = { FRAG_LOAD_ERROR: 'frag' }
  static ErrorTypes = { MEDIA_ERROR: 'media', NETWORK_ERROR: 'network' }
  handlers = new Map<string, (event: string, data: unknown) => void>()
  destroy = vi.fn()
  loadSource = vi.fn()
  attachMedia = vi.fn()
  recoverMediaError = vi.fn()
  swapAudioCodec = vi.fn()
  constructor() {
    FakeHls.instances.push(this)
  }

  on(event: string, handler: (event: string, data: unknown) => void) {
    this.handlers.set(event, handler)
  }
}

beforeEach(() => {
  vi.resetModules()
  FakeHls.instances = []
})
afterEach(() => vi.doUnmock('hls.js'))

it.each(['detach', 'dispose'] as const)(
  'does not attach a late HLS import after %s',
  async (cancel) => {
    const module = deferred<{ default: typeof FakeHls }>()
    vi.doMock('hls.js', () => module.promise)
    const { useHls } = await import('./useHls.ts')
    const scope = effectScope()
    const fatal = vi.fn()
    const hls = scope.run(() => useHls(fatal))!
    const video = { canPlayType: () => '' } as unknown as HTMLVideoElement
    const attached = hls.attach(video, '/old.m3u8', 42)
    if (cancel === 'dispose')
      scope.stop()
    else hls.detach()
    module.resolve({ default: FakeHls })
    expect(await attached).toBe(false)
    expect(FakeHls.instances).toHaveLength(0)
    expect(hls.diagnosticState()).toBe('idle')
    expect(fatal).not.toHaveBeenCalled()
    scope.stop()
  },
)

it('ignores callbacks from a destroyed HLS instance after a replacement attaches', async () => {
  vi.doMock('hls.js', () => ({ default: FakeHls }))
  const { useHls } = await import('./useHls.ts')
  const scope = effectScope()
  const fatal = vi.fn()
  const hls = scope.run(() => useHls(fatal))!
  const video = {} as HTMLVideoElement
  await hls.attach(video, '/old.m3u8', 0)
  const previous = FakeHls.instances[0]!
  await hls.attach(video, '/new.m3u8', 40)
  const current = FakeHls.instances[1]!
  previous.handlers.get('error')!('error', {
    details: 'frag',
    response: { code: 502 },
    fatal: true,
  })
  previous.handlers.get('buffered')!('buffered', {})
  expect(previous.destroy).toHaveBeenCalledTimes(1)
  expect(current.destroy).not.toHaveBeenCalled()
  expect(hls.diagnosticState()).toBe('loading')
  expect(fatal).not.toHaveBeenCalled()
  scope.stop()
})

it('attaches only the replacement when two launches await the same HLS import', async () => {
  const module = deferred<{ default: typeof FakeHls }>()
  const importing = deferred<void>()
  vi.doMock('hls.js', () => {
    importing.resolve()
    return module.promise
  })
  const { useHls } = await import('./useHls.ts')
  const scope = effectScope()
  const hls = scope.run(() => useHls(vi.fn()))!
  const previousVideo = {} as HTMLVideoElement
  const currentVideo = {} as HTMLVideoElement
  const previous = hls.attach(previousVideo, '/old.m3u8', 0)
  await importing.promise
  const current = hls.attach(currentVideo, '/new.m3u8', 40)
  module.resolve({ default: FakeHls })
  expect(await previous).toBe(false)
  expect(await current).toBe(true)
  expect(FakeHls.instances).toHaveLength(1)
  expect(FakeHls.instances[0]!.loadSource).toHaveBeenCalledExactlyOnceWith(
    '/new.m3u8',
  )
  expect(FakeHls.instances[0]!.attachMedia).toHaveBeenCalledExactlyOnceWith(
    currentVideo,
  )
  scope.stop()
})

it.each([false, true])(
  'handles a rejected HLS import with cancellation=%s',
  async (cancel) => {
    const module = deferred<{ default: typeof FakeHls }>()
    const importing = deferred<void>()
    vi.doMock('hls.js', () => {
      importing.resolve()
      return module.promise
    })
    const { useHls } = await import('./useHls.ts')
    const scope = effectScope()
    const hls = scope.run(() => useHls(vi.fn()))!
    const attached = hls.attach({} as HTMLVideoElement, '/old.m3u8', 0)
    await importing.promise
    if (cancel)
      scope.stop()
    const failure = new Error('chunk unavailable')
    module.reject(failure)
    if (cancel) {
      expect(await attached).toBe(false)
      expect(hls.diagnosticState()).toBe('idle')
    }
    else {
      await expect(attached).rejects.toMatchObject({ cause: failure })
    }
    expect(FakeHls.instances).toHaveLength(0)
    scope.stop()
  },
)

it('maps HLS decoder delay to the source clock for progress, seek and resume', async () => {
  vi.doMock('hls.js', () => ({ default: FakeHls }))
  const { useHls } = await import('./useHls.ts')
  const scope = effectScope()
  const hls = scope.run(() => useHls(vi.fn()))!
  await hls.attach({} as HTMLVideoElement, '/stream.m3u8', 0, 10)
  const old = FakeHls.instances[0]!
  old.handlers.get('initPts')!('initPts', {
    initPTS: 720000,
    timescale: 90000,
  })
  expect(hls.sourceTime(28.005666)).toBeCloseTo(26.005666)
  expect(hls.mediaTime(12)).toBe(14)
  expect(hls.sourceTime(hls.mediaTime(4))).toBe(4)
  expect(hls.sourceTime(0)).toBe(0)
  // A backward seek remains backward; this is a clock transform, not max(position).
  expect(hls.sourceTime(7)).toBe(5)
  await hls.attach({} as HTMLVideoElement, '/replacement.m3u8', 5, 10)
  old.handlers.get('initPts')!('initPts', { initPTS: 0, timescale: 90000 })
  expect(hls.sourceTime(5)).toBe(5)
  FakeHls.instances[1]!.handlers.get('initPts')!('initPts', {
    initPTS: 891000,
    timescale: 90000,
  })
  expect(hls.mediaTime(5)).toBeCloseTo(5.1)
  hls.detach()
  expect(hls.sourceTime(5)).toBe(5)
  scope.stop()
})

it('keeps the legacy clock when the server does not provide a TS offset', async () => {
  vi.doMock('hls.js', () => ({ default: FakeHls }))
  const { useHls } = await import('./useHls.ts')
  const scope = effectScope()
  const hls = scope.run(() => useHls(vi.fn()))!
  await hls.attach({} as HTMLVideoElement, '/legacy.m3u8', 12)
  FakeHls.instances[0]!.handlers.get('initPts')!('initPts', {
    initPTS: 720000,
    timescale: 90000,
  })
  expect(hls.sourceTime(14)).toBe(14)
  expect(hls.mediaTime(12)).toBe(12)
  scope.stop()
})
