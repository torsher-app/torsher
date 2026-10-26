import type { SearchOutcome } from './search.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedSearch, clearSearchCache, peekSearch } from './cache.ts'

function outcome(indexerCount: number): SearchOutcome {
  return { releases: [], indexerCount, failed: [] }
}

beforeEach(() => {
  clearSearchCache()
})

describe('cachedSearch', () => {
  it('свежий результат отдаёт из памяти', async () => {
    const load = vi.fn(async () => outcome(2))

    await cachedSearch('title', load)
    await cachedSearch('title', load)

    expect(load).toHaveBeenCalledTimes(1)
    expect(peekSearch('title')?.outcome.indexerCount).toBe(2)
  })

  it('поиск без индексаторов не запоминает: подключённый позже индексатор ищет сразу', async () => {
    const load = vi
      .fn<() => Promise<SearchOutcome>>()
      .mockResolvedValueOnce(outcome(0))
      .mockResolvedValueOnce(outcome(1))

    expect((await cachedSearch('title', load)).outcome.indexerCount).toBe(0)
    expect(peekSearch('title')).toBeUndefined()
    expect((await cachedSearch('title', load)).outcome.indexerCount).toBe(1)
  })
})
