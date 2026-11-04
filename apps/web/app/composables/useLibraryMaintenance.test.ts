import { effectScope, nextTick, ref, shallowRef, watch } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'

const mockApi = vi.hoisted(() => ({
  getLibraryMaintenanceConfig: vi.fn(),
  getLibraryMaintenanceStatus: vi.fn(),
  previewLibraryMaintenance: vi.fn(),
  saveLibraryMaintenanceConfig: vi.fn(),
}))
vi.mock('~/services/api', () => ({ api: { libraryMaintenance: mockApi } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('отбрасывает config и preview предыдущего тайтла после переключения', async () => {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onBeforeUnmount', vi.fn())
  vi.stubGlobal(
    'withErrorMode',
    (_mode: string, action: () => Promise<unknown>) => action(),
  )
  const { useLibraryMaintenance } = await import('./useLibraryMaintenance')
  const oldConfig = deferred<unknown>()
  const oldPreview = deferred<unknown>()
  mockApi.getLibraryMaintenanceConfig
    .mockReturnValueOnce(oldConfig.promise)
    .mockResolvedValueOnce({ rule: { titleId: 'new', revision: 2 } })
  mockApi.getLibraryMaintenanceStatus.mockResolvedValue({ suppressions: [] })
  mockApi.previewLibraryMaintenance.mockReturnValueOnce(oldPreview.promise)
  const scope = effectScope()
  const id = ref('old')
  const state = scope.run(() => useLibraryMaintenance(() => id.value))!
  const loadingOld = state.load()
  const previewingOld = state.evaluate({
    enabled: false,
    days: 30,
    keepLast: null,
    profileIds: ['profile'],
  })
  id.value = 'new'
  await nextTick()
  await state.load()
  oldConfig.resolve({ rule: { titleId: 'old', revision: 1 } })
  oldPreview.resolve({ groups: [{ titleId: 'old' }] })
  await Promise.all([loadingOld, previewingOld])
  expect(state.config.value?.rule.titleId).toBe('new')
  expect(state.preview.value).toBeNull()
  expect(state.busy.value).toBe(false)
  scope.stop()
})
