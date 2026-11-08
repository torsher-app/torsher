import type { CatalogDiscoverResponse } from '@torsher/api-client'
import { effectScope, nextTick, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import { useCatalogDiscover } from './useCatalogDiscover.ts'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../api.ts', () => ({
  api: { catalog: { getCatalogDiscover: mocks.get } },
  loadErrorOf: () => 'offline',
}))
vi.mock('./useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))

it('can explicitly load the next upstream page after an entirely filtered first page', async () => {
  mocks.get.mockResolvedValueOnce({
    items: [],
    total: 50,
    page: 1,
    totalPages: 3,
    totalIsApproximate: true,
  } satisfies CatalogDiscoverResponse)
  mocks.get.mockResolvedValueOnce({
    items: [{ id: 'tmdb:movie:1' }],
    total: 50,
    page: 2,
    totalPages: 3,
    totalIsApproximate: true,
  })
  const scope = effectScope()
  const catalog = scope.run(() =>
    useCatalogDiscover(ref({ type: 'movies', sort: 'popularity' })),
  )!
  await vi.waitFor(() => expect(catalog.status.value).toBe('ready'))
  expect(catalog.items.value).toEqual([])
  expect(catalog.hasMore.value).toBe(true)
  expect(catalog.totalIsApproximate.value).toBe(true)
  expect(mocks.get).toHaveBeenCalledTimes(1)
  await catalog.loadMore()
  await nextTick()
  expect(catalog.items.value.map(item => item.id)).toEqual(['tmdb:movie:1'])
  expect(mocks.get).toHaveBeenLastCalledWith(
    { type: 'movies', sort: 'popularity', page: 2, language: 'en-US' },
    { signal: undefined },
  )
  scope.stop()
})
