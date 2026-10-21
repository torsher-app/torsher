import type { StoredTorrent } from './eviction.ts'
import { describe, expect, it } from 'vitest'
import { evictionQueue, planEviction } from './eviction.ts'
import { defaultPolicy, GIB } from './policy.ts'

function item(id: string, values: Partial<StoredTorrent> = {}): StoredTorrent {
  return {
    id,
    retention: 'cache',
    size: 10 * GIB,
    lastUsedAt: 0,
    protected: false,
    ...values,
  }
}

describe('вытеснение кэша', () => {
  it('в пределах лимита и запаса ничего не трогает', () => {
    const plan = planEviction({
      torrents: [item('a'), item('b')],
      cacheLimit: 50 * GIB,
      minFree: 20 * GIB,
      free: 100 * GIB,
    })

    expect(plan).toMatchObject({ evict: [], ok: true, cacheUsed: 20 * GIB })
  })

  it('кэш больше лимита — уходят давно не смотренные, пока не влезет', () => {
    const plan = planEviction({
      torrents: [
        item('new', { lastUsedAt: 300 }),
        item('old', { lastUsedAt: 100 }),
        item('mid', { lastUsedAt: 200 }),
      ],
      cacheLimit: 15 * GIB,
      minFree: 20 * GIB,
      free: 100 * GIB,
    })

    expect(plan.evict).toEqual(['old', 'mid'])
    expect(plan).toMatchObject({
      ok: true,
      cacheUsed: 10 * GIB,
      free: 120 * GIB,
    })
  })

  it('закреплённые, просматриваемые и пустые не вытесняются, лимит считает только кэш', () => {
    const plan = planEviction({
      torrents: [
        item('kept', { retention: 'keep', size: 500 * GIB }),
        item('watching', { protected: true }),
        item('empty', { size: 0 }),
        item('old', { lastUsedAt: 1 }),
      ],
      cacheLimit: 15 * GIB,
      minFree: 20 * GIB,
      free: 100 * GIB,
    })

    expect(plan.evict).toEqual(['old'])
    expect(plan.ok).toBe(true)
  })

  it('мало свободного места — вытесняет кэш даже в пределах лимита', () => {
    const plan = planEviction({
      torrents: [item('a', { lastUsedAt: 1 }), item('b', { lastUsedAt: 2 })],
      cacheLimit: 100 * GIB,
      minFree: 20 * GIB,
      free: 15 * GIB,
    })

    expect(plan.evict).toEqual(['a'])
    expect(plan).toMatchObject({ ok: true, free: 25 * GIB })
  })

  it('под просмотр освобождает место, но не вытесняет саму раздачу', () => {
    const plan = planEviction({
      torrents: [
        item('target', { lastUsedAt: 0 }),
        item('other', { lastUsedAt: 5 }),
      ],
      cacheLimit: 100 * GIB,
      minFree: 20 * GIB,
      free: 25 * GIB,
      need: { bytes: 8 * GIB, torrentId: 'target', cache: true },
    })

    expect(plan.evict).toEqual(['other'])
    expect(plan.ok).toBe(true)
  })

  it('места не хватит даже после вытеснения — причина и сколько доступно', () => {
    const noSpace = planEviction({
      torrents: [item('a', { size: 2 * GIB })],
      cacheLimit: 100 * GIB,
      minFree: 20 * GIB,
      free: 21 * GIB,
      need: { bytes: 8 * GIB, torrentId: 'x', cache: true },
    })

    expect(noSpace).toMatchObject({
      evict: ['a'],
      ok: false,
      shortage: 'no_space',
      available: 3 * GIB,
    })

    const cacheLimit = planEviction({
      torrents: [item('kept', { retention: 'keep' })],
      cacheLimit: 5 * GIB,
      minFree: 20 * GIB,
      free: 500 * GIB,
      need: { bytes: 8 * GIB, torrentId: 'x', cache: true },
    })

    expect(cacheLimit).toMatchObject({
      ok: false,
      shortage: 'cache_limit',
      available: 5 * GIB,
    })
  })

  it('закреплённой раздаче лимит кэша не мешает', () => {
    const plan = planEviction({
      torrents: [],
      cacheLimit: 5 * GIB,
      minFree: 20 * GIB,
      free: 500 * GIB,
      need: { bytes: 80 * GIB, torrentId: 'x', cache: false },
    })

    expect(plan.ok).toBe(true)
  })

  it('очередь: только кэш, по давности просмотра', () => {
    const queue = evictionQueue([
      item('b', { lastUsedAt: 2 }),
      item('kept', { retention: 'keep' }),
      item('a', { lastUsedAt: 1 }),
    ])

    expect(queue.map(entry => entry.id)).toEqual(['a', 'b'])
  })
})

describe('значения по умолчанию', () => {
  it('большой том — 200 ГБ кэша и 20 ГБ запаса', () => {
    expect(defaultPolicy(4000 * GIB)).toEqual({
      cacheLimit: 200 * GIB,
      minFree: 20 * GIB,
      custom: false,
    })
  })

  it('маленький диск — половина под кэш и десятая часть в запас', () => {
    expect(defaultPolicy(100 * GIB)).toEqual({
      cacheLimit: 50 * GIB,
      minFree: 10 * GIB,
      custom: false,
    })
  })
})
