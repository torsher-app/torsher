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

describe('check all availability summary', () => {
  async function loadSources(items: Indexer[]) {
    api.getIndexers.mockResolvedValue({ items })
    api.getIndexerManagers.mockResolvedValue({ items: [] })
    const { useSources } = await import('./useSources')
    const sources = useSources()
    await sources.load()
    api.postIndexerTest.mockImplementation(async (id: string) =>
      items.find(item => item.id === id),
    )
    return sources
  }

  function source(id: string, overrides: Partial<Indexer> = {}): Indexer {
    return {
      id,
      enabled: true,
      missing: false,
      checkStatus: 'ok',
      ...overrides,
    } as Indexer
  }

  it('checks all enabled endpoints but counts only working sources, excluding missing', async () => {
    const sources = await loadSources([
      source('one'),
      source('two'),
      source('three'),
      source('gone', { missing: true }),
      source('disabled', { enabled: false }),
    ])
    expect(await sources.checkAll()).toEqual({ passed: 3, total: 4 })
    expect(api.postIndexerTest.mock.calls.map(([id]) => id).sort()).toEqual([
      'gone',
      'one',
      'three',
      'two',
    ])
    expect(sources.attentionCount.value).toBe(1)
    expect(
      sources.indexers.value.find(item => item.id === 'gone'),
    ).toMatchObject({ missing: true, checkStatus: 'ok' })
    expect(sources.checkRun.value).toBeNull()
    expect(sources.isChecking('gone')).toBe(false)
  })

  it('uses returned availability and excludes failed checks without stopping the run', async () => {
    const sources = await loadSources([
      source('working'),
      source('gone'),
      source('disabled'),
      source('timeout'),
      source('request-error'),
    ])
    api.postIndexerTest.mockImplementation(async (id: string) => {
      if (id === 'request-error')
        throw new Error('request failed')
      return source(id, {
        missing: id === 'gone',
        enabled: id !== 'disabled',
        checkStatus: id === 'timeout' ? 'timeout' : 'ok',
      })
    })
    expect(await sources.checkAll()).toEqual({ passed: 1, total: 5 })
    expect(sources.checkRun.value).toBeNull()
    expect(sources.isChecking('request-error')).toBe(false)
  })
})
