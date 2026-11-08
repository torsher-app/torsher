import process from 'node:process'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { metaCache, profiles } from '../../db/schema.ts'
import { storeMetaCache } from '../tmdb/cache.ts'
import { movie } from '../tmdb/fixtures/index.ts'
import { allowedTitleIds, titleAllowed, titleAllowedCached } from './access.ts'

let profileId: string
beforeAll(async () => {
  await migrateDb()
  profileId = getDb()
    .insert(profiles)
    .values({ name: 'Child', color: 'violet', ageLimit: 12 })
    .returning()
    .get()
    .id
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
function raw(id: number, rating = '6+') {
  return {
    ...movie,
    id,
    release_dates: {
      results: [
        { iso_3166_1: 'RU', release_dates: [{ certification: rating }] },
      ],
    },
  }
}
it('measures cold classification network concurrency and deduplication across simultaneous rows', async () => {
  let active = 0
  let peak = 0
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
    return Response.json(
      raw(Number(new URL(String(input)).pathname.split('/').at(-1))),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  const ids = Array.from(
    { length: 24 },
    (_, index) => `tmdb:movie:${910000 + index}`,
  )
  const started = performance.now()
  const rows = await Promise.all([
    allowedTitleIds(profileId, ids),
    allowedTitleIds(profileId, ids.slice(4)),
    allowedTitleIds(profileId, ids.slice(10)),
  ])
  expect(rows.map(row => row.size)).toEqual([24, 20, 14])
  expect(fetchMock).toHaveBeenCalledTimes(24)
  expect(peak).toBe(6)
  fetchMock.mockClear()
  for (const id of ids) expect(titleAllowedCached(profileId, id)).toBe(true)
  expect(fetchMock).not.toHaveBeenCalled()
  process.stdout.write(
    `Synthetic age classification: 24 requests, max concurrency ${peak}, ${Math.round(performance.now() - started)}ms; hot cache: 0 requests\n`,
  )
})
it('uses raw certifications in an existing English details cache without changing their country precedence', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  storeMetaCache('tmdb:movie:920001:en-US:v3', {
    ...raw(920001, '12+'),
    release_dates: {
      results: [
        { iso_3166_1: 'RU', release_dates: [{ certification: '12+' }] },
        { iso_3166_1: 'US', release_dates: [{ certification: 'G' }] },
      ],
    },
  })
  expect(await titleAllowed(profileId, 'tmdb:movie:920001')).toBe(false)
  expect(titleAllowedCached(profileId, 'tmdb:movie:920001')).toBe(false)
  expect(fetchMock).not.toHaveBeenCalled()
})
it('keeps original metadata timestamp on stale fallback and rejects data past the retention limit', async () => {
  const db = getDb()
  const key = 'tmdb:movie:920002:ru-RU:v3'
  const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
  storeMetaCache(key, raw(920002))
  db.update(metaCache)
    .set({ fetchedAt: stale })
    .where(eq(metaCache.key, key))
    .run()
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  expect(await titleAllowed(profileId, 'tmdb:movie:920002')).toBe(true)
  expect(
    db.select().from(metaCache).where(eq(metaCache.key, key)).get()!.fetchedAt,
  ).toEqual(stale)
  db.update(metaCache)
    .set({ fetchedAt: new Date(Date.now() - 181 * 24 * 60 * 60 * 1000) })
    .where(eq(metaCache.key, key))
    .run()
  expect(titleAllowedCached(profileId, 'tmdb:movie:920002')).toBe(false)
  expect(await titleAllowed(profileId, 'tmdb:movie:920002')).toBe(false)
})
