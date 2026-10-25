import { describe, expect, it, vi } from 'vitest'
import { createPromiseCache } from './promiseCache.ts'

describe('createPromiseCache', () => {
  it('повторный запрос берёт готовый ответ', async () => {
    const cache = createPromiseCache<number>(10)
    const load = vi.fn().mockResolvedValue(1)

    await cache.get('a', load)

    expect(await cache.get('a', load)).toBe(1)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('параллельные запросы делят один промис', async () => {
    const cache = createPromiseCache<number>(10)
    const load = vi.fn().mockResolvedValue(1)

    await Promise.all([cache.get('a', load), cache.get('a', load)])

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('ошибку не кэширует', async () => {
    const cache = createPromiseCache<number>(10)
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(2)

    await expect(cache.get('a', load)).rejects.toThrow('network')
    expect(await cache.get('a', load)).toBe(2)
  })

  it('вытесняет самую давнюю запись', async () => {
    const cache = createPromiseCache<string>(2)
    const load = (key: string) => vi.fn().mockResolvedValue(key)
    const first = load('a')

    await cache.get('a', first)
    await cache.get('b', load('b'))
    await cache.get('a', first)
    await cache.get('c', load('c'))

    const again = load('b')

    await cache.get('a', first)
    await cache.get('b', again)

    expect(first).toHaveBeenCalledTimes(1)
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('forget убирает подходящие записи, остальные остаются', async () => {
    const cache = createPromiseCache<string>(10)
    const a = vi.fn().mockResolvedValue('a')
    const b = vi.fn().mockResolvedValue('b')

    await cache.get('t1:1', a)
    await cache.get('t2:1', b)
    cache.forget(key => key.startsWith('t1:'))
    await cache.get('t1:1', a)
    await cache.get('t2:1', b)

    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(1)
  })
})
