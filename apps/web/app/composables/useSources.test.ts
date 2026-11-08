import type { Indexer } from '@torsher/api-client'
import { computed, readonly, ref, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  postIndexer: vi.fn(),
  patchIndexer: vi.fn(),
  postIndexerTest: vi.fn(),
}))
vi.mock('~/services/api', () => ({ api: { indexers: api } }))

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
