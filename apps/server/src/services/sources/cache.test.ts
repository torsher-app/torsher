import type { SearchOutcome } from './search.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedSearch, clearSearchCache, peekSearch } from './cache.ts'

function outcome(indexerCount: number): SearchOutcome {
  return { releases: [], unmatched: [], indexerCount, failed: [] }
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

  it.each([true, false])(
    'поздний обычный поиск не заменяет ручной запрос (%s)',
    async (normalFinishesFirst) => {
      const normal = Promise.withResolvers<SearchOutcome>()
      const manual = Promise.withResolvers<SearchOutcome>()
      const load = vi.fn(() => manual.promise)
      const options = { refresh: true, shouldPromote: () => true }
      const first = cachedSearch('title', () => normal.promise)
      const refreshed = cachedSearch('title', load, options)

      if (normalFinishesFirst) {
        normal.resolve(outcome(1))
        await first
        expect(cachedSearch('title', load, options)).toBe(refreshed)
        expect(peekSearch('title')).toBeUndefined()
      }

      manual.resolve(outcome(2))
      await refreshed
      normal.resolve(outcome(1))
      await first

      expect(load).toHaveBeenCalledTimes(1)
      expect(peekSearch('title')?.outcome.indexerCount).toBe(2)
    },
  )
})
