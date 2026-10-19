import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateDb } from '../../db/index.ts'
import { withMetaCache } from './cache.ts'

const TTL_MS = 60_000

beforeAll(() => {
  migrateDb()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('withMetaCache', () => {
  it('отдаёт свежую запись без загрузки', async () => {
    const load = vi.fn().mockResolvedValue({ value: 1 })

    await withMetaCache('fresh', TTL_MS, load)
    const second = await withMetaCache('fresh', TTL_MS, load)

    expect(second).toEqual({ value: 1 })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('перезагружает протухшую запись', async () => {
    vi.useFakeTimers()
    await withMetaCache('stale', TTL_MS, async () => ({ value: 1 }))
    vi.advanceTimersByTime(TTL_MS + 1)

    const result = await withMetaCache('stale', TTL_MS, async () => ({
      value: 2,
    }))

    expect(result).toEqual({ value: 2 })
  })

  it('отдаёт протухшую запись, если загрузка упала', async () => {
    vi.useFakeTimers()
    await withMetaCache('offline', TTL_MS, async () => ({ value: 1 }))
    vi.advanceTimersByTime(TTL_MS + 1)

    const result = await withMetaCache('offline', TTL_MS, async () => {
      throw new Error('network')
    })

    expect(result).toEqual({ value: 1 })
  })

  it('пробрасывает ошибку, если записи нет', async () => {
    await expect(
      withMetaCache('missing', TTL_MS, async () => {
        throw new Error('network')
      }),
    ).rejects.toThrow('network')
  })
})
