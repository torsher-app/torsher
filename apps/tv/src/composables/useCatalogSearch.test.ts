import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCatalogSearch } from './useCatalogSearch.ts'

const mocks = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('../api.ts', () => ({
  api: { catalog: { getCatalogSearch: mocks.search } },
  loadErrorOf: () => 'network',
}))
vi.mock('./useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en_US'),
}))
let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  scope = effectScope()
})
afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

it('rejects the old response during the debounce of the next query and after clearing', async () => {
  const query = ref('')
  const pending: ((value: object) => void)[] = []
  mocks.search.mockImplementation(
    () => new Promise(resolve => pending.push(resolve)),
  )
  const search = scope.run(() => useCatalogSearch(query))!
  query.value = 'first'
  await nextTick()
  await vi.advanceTimersByTimeAsync(300)
  query.value = 'second'
  await nextTick()
  pending[0]!({ items: [{ id: 'old' }], people: [] })
  await vi.advanceTimersByTimeAsync(1)
  expect(search.items.value).toEqual([])
  expect(search.status.value).toBe('loading')
  await vi.advanceTimersByTimeAsync(300)
  query.value = ''
  await nextTick()
  pending[1]!({ items: [{ id: 'second' }], people: [] })
  await vi.advanceTimersByTimeAsync(1)
  expect(search.items.value).toEqual([])
  expect(search.status.value).toBe('idle')
})

it('distinguishes failure from empty results and retries the same query', async () => {
  mocks.search
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [], people: [] })
  const query = ref('')
  const search = scope.run(() => useCatalogSearch(query))!
  query.value = 'missing'
  await nextTick()
  await vi.advanceTimersByTimeAsync(300)
  expect(search.status.value).toBe('error')
  await search.retry()
  expect(search.status.value).toBe('ready')
  expect(search.items.value).toEqual([])
  expect(mocks.search.mock.calls[1]![0].query).toBe('missing')
})
