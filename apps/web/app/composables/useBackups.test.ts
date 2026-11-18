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

const api = vi.hoisted(() => ({
  getBackups: vi.fn(),
  putBackupSettings: vi.fn(),
  postBackup: vi.fn(),
  deleteBackup: vi.fn(),
  deleteBackupRestore: vi.fn(),
}))
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

it('rejects a polling snapshot older than saved settings and keeps them on a directory save', async () => {
  await mount()
  let finish!: (value: BackupStatus) => void
  api.getBackups.mockReturnValueOnce(
    new Promise<BackupStatus>((resolve) => {
      finish = resolve
    }),
  )
  const pending = store.useBackups().refresh()
  const saved = snapshot()
  saved.settings.time = '05:30'
  saved.settings.keepDaily = 7
  api.putBackupSettings.mockResolvedValue(saved)
  await store.useBackups().saveSettings({ time: '05:30', keepDaily: 7 })
  finish(snapshot())
  await pending
  expect(store.useBackups().status.value?.settings).toEqual(saved.settings)
  await store.useBackups().saveSettings({ dir: '/new-backups' })
  expect(api.putBackupSettings).toHaveBeenLastCalledWith({
    enabled: true,
    time: '05:30',
    keepDaily: 7,
    keepWeekly: 0,
    dir: '/new-backups',
  })
})

it('serializes backup responses from separate controls and builds queued directory saves from fresh settings', async () => {
  await mount()
  let finish!: (value: BackupStatus) => void
  api.postBackup.mockReturnValue(
    new Promise<BackupStatus>((resolve) => {
      finish = resolve
    }),
  )
  const backup = store.useBackups().backupNow()
  const saved = snapshot()
  saved.settings.time = '07:00'
  saved.settings.keepDaily = 9
  api.putBackupSettings.mockResolvedValue(saved)
  const schedule = store
    .useBackups()
    .saveSettings({ time: '07:00', keepDaily: 9 })
  const directory = store.useBackups().saveSettings({ dir: '/new-backups' })
  await nextTick()
  expect(api.putBackupSettings).not.toHaveBeenCalled()
  finish(snapshot())
  await Promise.all([backup, schedule, directory])
  expect(store.useBackups().status.value?.settings).toEqual(saved.settings)
  expect(api.putBackupSettings).toHaveBeenLastCalledWith({
    enabled: true,
    time: '07:00',
    keepDaily: 9,
    keepWeekly: 0,
    dir: '/new-backups',
  })
})

it('deletes and reads after an earlier settings PUT with an older list', async () => {
  await mount()
  const backups = store.useBackups()
  const saved = Promise.withResolvers<BackupStatus>()
  const older = snapshot()
  older.settings.time = '05:30'
  const current = { ...older, items: older.items.slice(1) }
  api.putBackupSettings.mockReturnValueOnce(saved.promise)
  api.deleteBackup.mockResolvedValueOnce(null)
  api.getBackups.mockResolvedValueOnce(current)

  const settings = backups.saveSettings({ time: '05:30' })
  const deletion = backups.removeBackup('old-a')
  await vi.advanceTimersByTimeAsync(0)
  expect(api.putBackupSettings).toHaveBeenCalledTimes(1)
  expect(api.deleteBackup).not.toHaveBeenCalled()
  expect(api.getBackups).toHaveBeenCalledTimes(1)
  saved.resolve(older)
  await Promise.all([settings, deletion])

  expect(api.deleteBackup).toHaveBeenCalledWith('old-a')
  expect(backups.status.value).toEqual(current)
})

it('preserves the item when DELETE is rejected', async () => {
  await mount()
  const backups = store.useBackups()
  api.deleteBackup.mockRejectedValueOnce(new Error('delete failed'))

  await expect(backups.removeBackup('old-a')).rejects.toThrow('delete failed')
  expect(backups.status.value).toEqual(snapshot())
  expect(api.getBackups).toHaveBeenCalledTimes(1)
})

it('keeps the confirmed deletion when the status request fails and an old poll arrives', async () => {
  await mount()
  const backups = store.useBackups()
  const earlier = Promise.withResolvers<BackupStatus>()
  api.getBackups.mockReturnValueOnce(earlier.promise)
  const poll = backups.refresh()
  api.deleteBackup.mockResolvedValueOnce(null)
  api.getBackups.mockRejectedValueOnce(new Error('status unavailable'))

  await backups.removeBackup('old-a')
  earlier.resolve(snapshot())
  await poll

  expect(backups.status.value).toEqual(snapshot(['old-b']))
  const restored = snapshot(['old-b'])
  api.getBackups.mockResolvedValueOnce(restored)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(api.getBackups).toHaveBeenCalledTimes(4)
  expect(backups.status.value).toEqual(restored)
})

it('dismisses restore and reads status after earlier settings settle', async () => {
  const initial = snapshot()
  initial.restore = { state: 'failed', warnings: [] }
  api.getBackups.mockResolvedValueOnce(initial)
  await mount()
  const backups = store.useBackups()
  const saved = Promise.withResolvers<BackupStatus>()
  const oldRestore = {
    ...initial,
    settings: { ...initial.settings, time: '05:30' },
  }
  const dismissed = { ...snapshot(), settings: oldRestore.settings }
  api.putBackupSettings.mockReturnValueOnce(saved.promise)
  api.deleteBackupRestore.mockResolvedValueOnce(null)
  api.getBackups.mockResolvedValueOnce(dismissed)

  const settings = backups.saveSettings({ time: '05:30' })
  const dismissal = backups.dismissRestore()
  await vi.advanceTimersByTimeAsync(0)
  expect(api.deleteBackupRestore).not.toHaveBeenCalled()
  saved.resolve(oldRestore)
  await Promise.all([settings, dismissal])
  expect(backups.status.value).toEqual(dismissed)
})

it('uploads without occupying the queue and reads status after in-flight settings settle', async () => {
  await mount()
  const backups = store.useBackups()
  const transfer = Promise.withResolvers<Response>()
  const fetch = vi.fn().mockReturnValueOnce(transfer.promise)
  vi.stubGlobal('fetch', fetch)
  const saved = Promise.withResolvers<BackupStatus>()
  const older = snapshot()
  older.settings.time = '05:30'
  const uploaded = {
    ...older,
    items: snapshot(['uploaded', 'old-a', 'old-b']).items,
  }
  const item = uploaded.items[0]!
  api.putBackupSettings.mockReturnValueOnce(saved.promise)
  api.getBackups.mockResolvedValueOnce(uploaded)

  const upload = backups.upload(new File(['backup'], 'uploaded'))
  const settings = backups.saveSettings({ time: '05:30' })
  await vi.advanceTimersByTimeAsync(0)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(api.putBackupSettings).toHaveBeenCalledTimes(1)
  transfer.resolve(Response.json(item))
  await vi.advanceTimersByTimeAsync(0)
  expect(api.getBackups).toHaveBeenCalledTimes(1)

  saved.resolve(older)
  await settings
  expect(await upload).toEqual(item)
  expect(backups.status.value).toEqual(uploaded)
})
