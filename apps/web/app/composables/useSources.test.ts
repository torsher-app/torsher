import type { Indexer, IndexerManager } from '@torsher/api-client'
import { computed, readonly, ref, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  patchIndexerManager: vi.fn(),
  getIndexerManagers: vi.fn(),
  getIndexers: vi.fn(),
  postIndexer: vi.fn(),
  patchIndexer: vi.fn(),
  postIndexerTest: vi.fn(),
}))
vi.mock('~/services/api', () => ({
  api: { indexers: api, indexerManagers: api },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('readonly', readonly)
  vi.stubGlobal('withErrorMode', (_mode: string, action: () => unknown) =>
    action())
  api.patchIndexer.mockResolvedValue({
    id: 'source',
    checkStatus: null,
  } as Indexer)
  api.postIndexerTest.mockResolvedValue({
    id: 'source',
    checkStatus: 'ok',
  } as Indexer)
})
afterEach(() => vi.unstubAllGlobals())

describe('source credentials checks', () => {
  it.each(['sid=new-cookie', null])(
    'rechecks after cookie replacement/removal: %s',
    async (sessionCookie) => {
      const { useSources } = await import('./useSources')
      const checked = await useSources().updateIndexer('source', {
        sessionCookie,
      })
      expect(api.patchIndexer).toHaveBeenCalledWith('source', {
        sessionCookie,
      })
      expect(api.postIndexerTest).toHaveBeenCalledExactlyOnceWith('source')
      expect(checked?.checkStatus).toBe('ok')
    },
  )
  it('does not recheck an unrelated edit with an omitted cookie', async () => {
    const { useSources } = await import('./useSources')
    await useSources().updateIndexer('source', { name: 'Renamed' })
    expect(api.postIndexerTest).not.toHaveBeenCalled()
  })
})

describe('manager browser address', () => {
  it('updates the shared manager immediately and leaves API and indexers unchanged', async () => {
    const manager = {
      id: 'manager',
      kind: 'prowlarr',
      url: 'http://internal.example:9696',
      browserUrl: null,
      syncedAt: null,
      indexerCount: 0,
      missingCount: 0,
    } satisfies IndexerManager
    api.getIndexerManagers.mockResolvedValue({ items: [manager] })
    api.getIndexers.mockResolvedValue({ items: [] })
    const { useSources } = await import('./useSources')
    const sources = useSources()
    await sources.load()
    for (const browserUrl of ['https://manager.example/base/', null]) {
      api.patchIndexerManager.mockResolvedValue({ ...manager, browserUrl })
      await sources.saveManagerBrowserUrl(manager.id, browserUrl)
      expect(sources.managers.value[0]).toMatchObject({
        url: manager.url,
        browserUrl,
      })
      expect(api.patchIndexerManager).toHaveBeenLastCalledWith(manager.id, {
        browserUrl,
      })
    }
    expect(api.getIndexerManagers).toHaveBeenCalledTimes(1)
    expect(api.getIndexers).toHaveBeenCalledTimes(1)
    expect(api.postIndexerTest).not.toHaveBeenCalled()
  })
})
