import type { Collection } from '@torsher/api-client'
import { ref, shallowRef } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  adminRemove: vi.fn(),
  viewerRemove: vi.fn(),
}))
vi.mock('~/services/api', () => ({
  api: {
    collections: {
      getCollections: mocks.list,
      deleteAdminCollectionTitle: mocks.adminRemove,
      deleteCollectionTitle: mocks.viewerRemove,
    },
  },
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('withErrorMode', (_mode: string, action: () => unknown) =>
    action())
  mocks.list.mockResolvedValue({
    items: [
      {
        id: 'collection',
        name: 'Shared',
        count: 2,
        showOnHome: true,
        hiddenFrom: [],
      } satisfies Collection,
    ],
  })
  mocks.adminRemove.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

it('uses the owner endpoint to remove a panel title and updates its count', async () => {
  const { useCollections } = await import('./useCollections')
  const store = useCollections()
  await store.load()
  await store.removeTitle('collection', 'tmdb:movie:902')
  expect(mocks.adminRemove).toHaveBeenCalledExactlyOnceWith(
    'collection',
    'tmdb:movie:902',
  )
  expect(mocks.viewerRemove).not.toHaveBeenCalled()
  expect(store.collections.value[0]?.count).toBe(1)
})
it('keeps the count when owner removal fails', async () => {
  const { useCollections } = await import('./useCollections')
  const store = useCollections()
  await store.load()
  mocks.adminRemove.mockRejectedValue(new Error('unavailable'))
  await expect(
    store.removeTitle('collection', 'tmdb:movie:903'),
  ).rejects.toThrow('unavailable')
  expect(store.collections.value[0]?.count).toBe(2)
})
