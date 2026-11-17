import type { BackupStatus } from '@torsher/api-client'
import {
  computed,
  effectScope,
  nextTick,
  readonly,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getBackups: vi.fn() }))
vi.mock('~/services/api', () => ({ api: { backups: api } }))
const visibility = ref('visible')
vi.mock('@vueuse/core', () => ({ useDocumentVisibility: () => visibility }))
let mount: () => Promise<void>
let unmount: () => void
let scope: ReturnType<typeof effectScope>
let store: typeof import('./useBackups')

function snapshot(names = ['old-a', 'old-b']): BackupStatus {
  return {
    settings: {
      enabled: true,
      time: '04:00',
      keepDaily: 2,
      keepWeekly: 0,
      mode: 'key',
    },
    dir: {
      path: '/backups',
      source: 'default',
      available: true,
      sameVolumeAsDatabase: true,
    },
    state: { timezone: 'UTC', nextAt: '2026-11-17T04:00:00Z' },
    items: names.map(name => ({
      name,
      createdAt: '2026-11-16T04:00:00Z',
      reason: 'scheduled',
      version: '1.0.0',
      size: 100,
      encrypted: false,
      dirKind: 'main',
    })),
  }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  visibility.value = 'visible'
  for (const [name, value] of Object.entries({
    ref,
    shallowRef,
    computed,
    readonly,
    watch,
    withErrorMode: (_mode: string, fn: () => unknown) => fn(),
    onMounted: (fn: typeof mount) => {
      mount = fn
    },
    onBeforeUnmount: (fn: typeof unmount) => {
      unmount = fn
    },
  }))
    vi.stubGlobal(name, value)
  api.getBackups.mockResolvedValue(snapshot())
  store = await import('./useBackups')
  scope = effectScope()
  scope.run(() => store.useBackupsPolling())
})
afterEach(() => {
  unmount()
  scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('discovers a completed scheduled backup and rotation while continuously visible and idle', async () => {
  await mount()
  const next = snapshot(['new', 'old-a'])
  next.state.nextAt = '2026-11-18T04:00:00Z'
  next.state.lastSuccessAt = '2026-11-17T04:00:01Z'
  next.dir.available = false
  api.getBackups.mockResolvedValue(next)
  await vi.advanceTimersByTimeAsync(29_999)
  expect(api.getBackups).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(api.getBackups).toHaveBeenCalledTimes(2)
  expect(store.useBackups().status.value).toEqual(next)
})

it.each(['running', 'checking'] as const)(
  'polls %s quickly then returns to idle cadence',
  async (kind) => {
    const busy = snapshot()
    if (kind === 'running') {
      busy.state.running = {
        reason: 'scheduled',
        startedAt: '2026-11-17T04:00:00Z',
      }
    }
    else {
      busy.restore = { state: 'checking', warnings: [] }
    }
    api.getBackups.mockResolvedValueOnce(busy)
    await mount()
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.getBackups).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(api.getBackups).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.getBackups).toHaveBeenCalledTimes(3)
  },
)

it('keeps refreshing when disabled, preserves the snapshot on error and retries', async () => {
  const disabled = snapshot()
  disabled.settings.enabled = false
  api.getBackups.mockResolvedValueOnce(disabled)
  await mount()
  api.getBackups.mockRejectedValueOnce(new Error('offline'))
  await vi.advanceTimersByTimeAsync(30_000)
  expect(store.useBackups().status.value).toEqual(disabled)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(api.getBackups).toHaveBeenCalledTimes(3)
  expect(store.useBackups().status.value?.settings.enabled).toBe(true)
})

it('pauses while hidden, refreshes on return, and stops after unmount', async () => {
  await mount()
  visibility.value = 'hidden'
  await nextTick()
  await vi.advanceTimersByTimeAsync(90_000)
  expect(api.getBackups).toHaveBeenCalledTimes(1)
  visibility.value = 'visible'
  await nextTick()
  await vi.advanceTimersByTimeAsync(0)
  expect(api.getBackups).toHaveBeenCalledTimes(2)
  unmount()
  scope.stop()
  await vi.advanceTimersByTimeAsync(90_000)
  expect(api.getBackups).toHaveBeenCalledTimes(2)
})

it('does not restart polling when the mounted request finishes after unmount', async () => {
  let resolve!: (value: BackupStatus) => void
  api.getBackups.mockReturnValueOnce(
    new Promise<BackupStatus>((done) => {
      resolve = done
    }),
  )
  const pending = mount()
  unmount()
  scope.stop()
  const busy = snapshot()
  busy.state.running = {
    reason: 'scheduled',
    startedAt: '2026-11-17T04:00:00Z',
  }
  resolve(busy)
  await pending
  await vi.advanceTimersByTimeAsync(90_000)
  expect(api.getBackups).toHaveBeenCalledTimes(1)
})

it('waits for a slow refresh before scheduling another request', async () => {
  await mount()
  let resolve!: (value: BackupStatus) => void
  api.getBackups.mockReturnValueOnce(
    new Promise<BackupStatus>((done) => {
      resolve = done
    }),
  )
  await vi.advanceTimersByTimeAsync(30_000)
  await vi.advanceTimersByTimeAsync(90_000)
  expect(api.getBackups).toHaveBeenCalledTimes(2)
  resolve(snapshot())
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(api.getBackups).toHaveBeenCalledTimes(3)
})
