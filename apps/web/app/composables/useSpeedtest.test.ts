import type { InternetSpeedtest } from '@torsher/api-client'
import { computed, effectScope, ref, shallowRef, watch } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const methods = vi.hoisted(() => ({
  postInternetSpeedtest: vi.fn(),
  getInternetSpeedtest: vi.fn(),
  postInternetSpeedtestHeartbeat: vi.fn(),
  deleteInternetSpeedtest: vi.fn(),
}))
vi.mock('~/services/api', () => ({ api: { speedtest: methods } }))
const phase = {
  bytesPerSecond: null,
  durationMs: 0,
  payloadBytes: 0,
  confirmedBytes: 0,
  reservedBytes: 0,
  shortened: false,
}
const result: InternetSpeedtest = {
  id: 'job',
  state: 'running',
  phase: 'latency',
  provider: 'Cloudflare',
  route: 'direct',
  dns: 'system',
  startedAt: '2026-01-01T00:00:00Z',
  finishedAt: null,
  reason: null,
  latencyMs: null,
  download: phase,
  upload: phase,
  samples: [],
}
const loggedIn = ref(true)
let unmount: () => void
beforeEach(() => {
  vi.useFakeTimers()
  for (const [name, value] of Object.entries({
    ref,
    computed,
    shallowRef,
    watch,
    __DEMO__: false,
    onMounted: vi.fn(),
    onDeactivated: vi.fn(),
    onBeforeUnmount: (fn: () => void) => {
      unmount = fn
    },
    useUser: () => ({ isAuthenticated: loggedIn }),
    withErrorMode: (_mode: string, fn: () => Promise<unknown>) => fn(),
  }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  loggedIn.value = true
  methods.postInternetSpeedtest.mockResolvedValue(result)
  methods.postInternetSpeedtestHeartbeat.mockResolvedValue({ message: 'ok' })
  methods.deleteInternetSpeedtest.mockResolvedValue({ message: 'cancelled' })
})
afterEach(() => {
  unmount?.()
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
it('keeps the completed result when a poll follows a fast completed phase', async () => {
  const { useSpeedtest } = await import('./useSpeedtest')
  methods.getInternetSpeedtest.mockResolvedValue({
    ...result,
    state: 'complete',
    phase: 'finished',
  })
  const scope = effectScope()
  const test = scope.run(useSpeedtest)!
  await test.startInternet()
  await vi.advanceTimersByTimeAsync(1000)
  expect(test.internetState.value).toBe('complete')
  expect(test.internetError.value).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  scope.stop()
})
it('discards a late start response after logout and releases the server ID', async () => {
  const { useSpeedtest } = await import('./useSpeedtest')
  let resolve!: (value: InternetSpeedtest) => void
  methods.postInternetSpeedtest.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const scope = effectScope()
  const test = scope.run(useSpeedtest)!
  const pending = test.startInternet()
  loggedIn.value = false
  await Promise.resolve()
  resolve(result)
  await pending
  expect(methods.deleteInternetSpeedtest).toHaveBeenCalledWith('job')
  expect(test.internetState.value).toBe('cancelled')
  expect(test.internet.value).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  scope.stop()
})
it('polls progress at 4Hz independently of the 1Hz heartbeat', async () => {
  const { useSpeedtest } = await import('./useSpeedtest')
  methods.getInternetSpeedtest.mockResolvedValue(result)
  const scope = effectScope()
  const test = scope.run(useSpeedtest)!
  await test.startInternet()
  await vi.advanceTimersByTimeAsync(1000)
  expect(methods.getInternetSpeedtest).toHaveBeenCalledTimes(4)
  expect(methods.postInternetSpeedtestHeartbeat).toHaveBeenCalledTimes(1)
  test.stopInternet()
  expect(vi.getTimerCount()).toBe(0)
  scope.stop()
})
it('never overlaps pending progress reads and drops a late result after stop', async () => {
  const { useSpeedtest } = await import('./useSpeedtest')
  let resolve!: (value: InternetSpeedtest) => void
  methods.getInternetSpeedtest.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const scope = effectScope()
  const test = scope.run(useSpeedtest)!
  await test.startInternet()
  await vi.advanceTimersByTimeAsync(2000)
  expect(methods.getInternetSpeedtest).toHaveBeenCalledTimes(1)
  expect(methods.postInternetSpeedtestHeartbeat).toHaveBeenCalledTimes(2)
  test.stopInternet()
  resolve({ ...result, state: 'complete' })
  await vi.advanceTimersByTimeAsync(0)
  expect(test.internetState.value).toBe('cancelled')
  expect(vi.getTimerCount()).toBe(0)
  scope.stop()
})
it.each(['download', 'upload'] as const)(
  'retains the last %s rate on manual stop along with a completed earlier phase',
  async (direction) => {
    const { useSpeedtest } = await import('./useSpeedtest')
    const progress: InternetSpeedtest = {
      ...result,
      phase: direction,
      download: { ...phase, bytesPerSecond: 10 },
      upload: { ...phase, bytesPerSecond: 20 },
    }
    methods.postInternetSpeedtest.mockResolvedValue(progress)
    const scope = effectScope()
    const test = scope.run(useSpeedtest)!
    await test.startInternet()
    test.stopInternet()
    expect(test.internet.value).toMatchObject({
      state: 'cancelled',
      phase: 'finished',
      reason: 'cancelled',
      [direction]: { bytesPerSecond: direction === 'download' ? 10 : 20 },
    })
    if (direction === 'upload')
      expect(test.internet.value?.download.bytesPerSecond).toBe(10)
    scope.stop()
  },
)
it('marks a failed progress read terminal and clears only the unfinished upload rate', async () => {
  const { useSpeedtest } = await import('./useSpeedtest')
  methods.postInternetSpeedtest.mockResolvedValue({
    ...result,
    phase: 'upload',
    download: { ...phase, bytesPerSecond: 10 },
    upload: { ...phase, bytesPerSecond: 20 },
  })
  methods.getInternetSpeedtest.mockRejectedValue(new Error('connection lost'))
  const scope = effectScope()
  const test = scope.run(useSpeedtest)!
  await test.startInternet()
  await vi.advanceTimersByTimeAsync(250)
  expect(test.internetState.value).toBe('error')
  expect(test.internet.value).toMatchObject({
    state: 'error',
    phase: 'finished',
    reason: null,
    download: { bytesPerSecond: 10 },
    upload: { bytesPerSecond: null },
  })
  expect(test.internet.value?.finishedAt).not.toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  scope.stop()
})
it('ignores a heartbeat rejection arriving after a completed terminal GET', async () => {
  const { useSpeedtest } = await import('./useSpeedtest')
  let rejectHeartbeat!: (reason: Error) => void
  methods.getInternetSpeedtest.mockResolvedValue(result)
  methods.postInternetSpeedtestHeartbeat.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectHeartbeat = reject
      }),
  )
  const scope = effectScope()
  const test = scope.run(useSpeedtest)!
  await test.startInternet()
  await vi.advanceTimersByTimeAsync(1000)
  methods.getInternetSpeedtest.mockResolvedValue({
    ...result,
    state: 'complete',
    phase: 'finished',
    reason: 'complete',
  })
  await vi.advanceTimersByTimeAsync(250)
  expect(test.internetState.value).toBe('complete')
  rejectHeartbeat(new Error('late heartbeat failure'))
  await vi.advanceTimersByTimeAsync(0)
  expect(test.internetState.value).toBe('complete')
  expect(test.internet.value?.reason).toBe('complete')
  expect(test.internetError.value).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  scope.stop()
})
