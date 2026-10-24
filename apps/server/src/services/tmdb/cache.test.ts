import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { metaCache } from '../../db/schema.ts'
import {
  purgeExpiredMetaCache,
  TMDB_MAX_CACHE_AGE_MS,
  withMetaCache,
} from './cache.ts'

const TTL_MS = 60_000

beforeAll(async () => {
  await migrateDb()
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

  it('не отдаёт запись старше предела хранения, даже если загрузка упала', async () => {
    vi.useFakeTimers()
    await withMetaCache('expired', TTL_MS, async () => ({ value: 1 }))
    vi.advanceTimersByTime(TMDB_MAX_CACHE_AGE_MS)

    await expect(
      withMetaCache('expired', TTL_MS, async () => {
        throw new Error('network')
      }),
    ).rejects.toThrow('network')
    expect(cachedKeys()).not.toContain('expired')
  })

  it('пробрасывает ошибку, если записи нет', async () => {
    await expect(
      withMetaCache('missing', TTL_MS, async () => {
        throw new Error('network')
      }),
    ).rejects.toThrow('network')
  })
})

function cachedKeys() {
  return getDb()
    .select({ key: metaCache.key })
    .from(metaCache)
    .all()
    .map(row => row.key)
}

describe('purgeExpiredMetaCache', () => {
  it('удаляет только записи старше предела хранения', async () => {
    vi.useFakeTimers()
    await withMetaCache('purge:old', TTL_MS, async () => ({ value: 1 }))
    vi.advanceTimersByTime(TMDB_MAX_CACHE_AGE_MS - TTL_MS)
    await withMetaCache('purge:recent', TTL_MS, async () => ({ value: 2 }))
    vi.advanceTimersByTime(TTL_MS)

    purgeExpiredMetaCache()

    const keys = cachedKeys()

    expect(keys).not.toContain('purge:old')
    expect(keys).toContain('purge:recent')
  })
})
