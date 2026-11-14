import type { InternetSpeedtest } from '@torsher/api-client'
import { createApiClient } from '@torsher/api-client'
import { effectScope, nextTick } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { session } from '../session.ts'
import { useSpeedtest } from './useSpeedtest.ts'

const { methods, hooks } = vi.hoisted(() => ({
  methods: {
    getProfiles: vi.fn(),
    postInternetSpeedtest: vi.fn(),
    getInternetSpeedtest: vi.fn(),
    postInternetSpeedtestHeartbeat: vi.fn(),
    deleteInternetSpeedtest: vi.fn(),
  },
  hooks: {
    mounted: [] as (() => void)[],
    unmount: [] as (() => void)[],
    deactivate: [] as (() => void)[],
  },
}))
vi.mock('../api.ts', () => ({
  api: { speedtest: methods, profiles: { getProfiles: methods.getProfiles } },
}))
vi.mock('../session.ts', async () => ({
  session: (await import('vue')).reactive({ status: 'ready' }),
}))
vi.mock('vue', async original => ({
  ...(await original<typeof import('vue')>()),
  onMounted: (fn: () => void) => hooks.mounted.push(fn),
  onBeforeUnmount: (fn: () => void) => hooks.unmount.push(fn),
  onDeactivated: (fn: () => void) => hooks.deactivate.push(fn),
}))
const phase = {
  bytesPerSecond: null,
  durationMs: 0,
  payloadBytes: 0,
  confirmedBytes: 0,
  reservedBytes: 0,
  shortened: false,
}
const result: InternetSpeedtest = {
  id: 'run',
  state: 'running',
  phase: 'latency',
  reason: null,
  provider: 'Cloudflare',
  route: 'direct',
  dns: 'system',
  startedAt: '2026-01-01T00:00:00Z',
  finishedAt: null,
  latencyMs: null,
  download: phase,
  upload: phase,
  samples: [],
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('__DEMO__', false)
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  hooks.mounted.length = hooks.unmount.length = hooks.deactivate.length = 0
  vi.resetAllMocks()
  Object.assign(session, { status: 'ready' })
  methods.getProfiles.mockResolvedValue({ items: [] })
  methods.postInternetSpeedtest.mockResolvedValue(result)
  methods.getInternetSpeedtest.mockResolvedValue(result)
  methods.postInternetSpeedtestHeartbeat.mockResolvedValue({})
  methods.deleteInternetSpeedtest.mockResolvedValue({})
})
afterEach(() => {
  hooks.unmount.forEach(fn => fn())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('opens idle and stops its own internet task on visibility loss and deactivation', async () => {
  const scope = effectScope()
  const test = scope.run(() => useSpeedtest('internet'))!
  expect(methods.postInternetSpeedtest).not.toHaveBeenCalled()
  hooks.mounted.forEach(fn => fn())
  await test.start()
  expect(test.running.value).toBe(true)
  Object.assign(document, { hidden: true })
  const callback = vi.mocked(document.addEventListener).mock.calls[0]![1] as () => void
  callback()
  expect(methods.deleteInternetSpeedtest).toHaveBeenCalledWith('run')
  expect(test.internet.value.status).toBe('cancelled')
  expect(vi.getTimerCount()).toBe(0)
  Object.assign(document, { hidden: false })
  await test.start()
  hooks.deactivate.forEach(fn => fn())
  expect(test.internet.value.status).toBe('cancelled')
  scope.stop()
})
it('stops when the paired session is lost', async () => {
  const scope = effectScope()
  const test = scope.run(() => useSpeedtest('internet'))!
  await test.start()
  Object.assign(session, { status: 'unpaired' })
  await nextTick()
  expect(methods.deleteInternetSpeedtest).toHaveBeenCalledWith('run')
  expect(test.internet.value.status).toBe('cancelled')
  scope.stop()
})

function realControls(fetcher: typeof fetch) {
  const expired = vi.fn(() => {
    Object.assign(session, { status: 'unpaired' })
  })
  const actual = createApiClient({
    getErrorMode: () => 'silent',
    shouldRefreshSession: url =>
      !/^\/api\/speedtest\/internet(?:\/|$)/.test(url),
    onSessionExpired: expired,
    onError: vi.fn(),
    onFatal: vi.fn(),
  })
  vi.stubGlobal('fetch', fetcher)
  methods.postInternetSpeedtest.mockImplementation(() =>
    actual.speedtest.postInternetSpeedtest({}),
  )
  methods.getProfiles.mockImplementation(() => actual.profiles.getProfiles())
  return { expired }
}
function response(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
it('shows an old owner-only endpoint as unavailable while the paired viewer remains valid', async () => {
  const fetcher = vi.fn<typeof fetch>(async url =>
    String(url) === '/api/profiles'
      ? response(200, { items: [] })
      : response(401),
  )
  const { expired } = realControls(fetcher)
  const scope = effectScope()
  const test = scope.run(() => useSpeedtest('internet'))!
  await test.start()
  expect(test.internet.value.error).toBe('unavailable')
  expect(expired).not.toHaveBeenCalled()
  expect(session.status).toBe('ready')
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    '/api/speedtest/internet',
    '/api/profiles',
    '/api/speedtest/internet',
  ])
  scope.stop()
})
it('refreshes an expired owner through the normal profile endpoint then retries the optional check once', async () => {
  let refreshed = false
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url) === '/api/auth/refresh') {
      refreshed = true
      return response(200)
    }
    if (String(url) === '/api/profiles')
      return response(refreshed ? 200 : 401, { items: [] })
    return response(refreshed ? 201 : 401, result)
  })
  const { expired } = realControls(fetcher)
  const scope = effectScope()
  const test = scope.run(() => useSpeedtest('internet'))!
  await test.start()
  expect(test.internet.value.status).toBe('running')
  expect(expired).not.toHaveBeenCalled()
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    '/api/speedtest/internet',
    '/api/profiles',
    '/api/auth/refresh',
    '/api/profiles',
    '/api/speedtest/internet',
  ])
  scope.stop()
})
it('expires a genuinely revoked viewer through the ordinary profile auth failure', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(401))
  const { expired } = realControls(fetcher)
  const scope = effectScope()
  const test = scope.run(() => useSpeedtest('internet'))!
  await test.start()
  await nextTick()
  expect(expired).toHaveBeenCalledTimes(1)
  expect(session.status).toBe('unpaired')
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    '/api/speedtest/internet',
    '/api/profiles',
    '/api/auth/refresh',
  ])
  scope.stop()
})
it('does not retry a server start after auth recovery if the user has already closed the panel', async () => {
  let resolveProfile: ((value: Response) => void) | undefined
  let attempts = 0
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url) === '/api/profiles') {
      return new Promise((done) => {
        resolveProfile = done
      })
    }
    return ++attempts === 1 ? response(401) : response(201, result)
  })
  realControls(fetcher)
  const scope = effectScope()
  const test = scope.run(() => useSpeedtest('internet'))!
  const pending = test.start()
  for (let i = 0; i < 20; i++) {
    if (resolveProfile)
      break
    await Promise.resolve()
  }
  expect(resolveProfile).toBeDefined()
  test.stop()
  resolveProfile!(response(200, { items: [] }))
  await pending
  expect(attempts).toBe(1)
  expect(methods.deleteInternetSpeedtest).not.toHaveBeenCalled()
  expect(test.internet.value.status).toBe('cancelled')
  expect(vi.getTimerCount()).toBe(0)
  scope.stop()
})

it('keeps the last internet measurements on Stop and resets only on the next Start', async () => {
  const progress: InternetSpeedtest = {
    ...result,
    phase: 'upload',
    download: { ...phase, bytesPerSecond: 10 },
    upload: {
      ...phase,
      bytesPerSecond: 20,
      durationMs: 2000,
      payloadBytes: 40,
    },
  }
  methods.postInternetSpeedtest.mockResolvedValue(progress)
  const scope = effectScope()
  const test = scope.run(() => useSpeedtest('internet'))!
  await test.start()
  test.stop()
  expect(test.internet.value).toMatchObject({
    status: 'cancelled',
    result: {
      download: progress.download,
      upload: progress.upload,
    },
  })
  methods.postInternetSpeedtest.mockReturnValueOnce(new Promise(() => {}))
  void test.start()
  expect(test.internet.value).toEqual({
    status: 'preparing',
    error: null,
    result: null,
  })
  test.stop()
  scope.stop()
})
