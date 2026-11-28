import { eq, like, lte, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { metaCache } from '../../db/schema.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Предельный возраст данных TMDB у нас: их условия запрещают хранить
 * данные дольше 6 месяцев. Касается и записей кэша, и картинок у клиентов.
 */
export const TMDB_MAX_CACHE_AGE_MS = 180 * DAY_MS

/**
 * Свежая запись отдаётся без запроса в сеть. Если загрузка упала, отдаём
 * протухшую запись, когда она есть: каталог продолжает работать без источника.
 * Запись старше `TMDB_MAX_CACHE_AGE_MS` не отдаётся и при недоступном источнике.
 */
export async function withMetaCache<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  allowStale = true,
): Promise<T> {
  const db = getDb()
  const found = db.select().from(metaCache).where(eq(metaCache.key, key)).get()
  const age = found ? Date.now() - found.fetchedAt.getTime() : 0
  const entry = found && age < TMDB_MAX_CACHE_AGE_MS ? found : undefined

  if (entry && age < ttlMs)
    return JSON.parse(entry.json) as T

  let value: T

  try {
    value = await load()
  }
  catch (err) {
    if (entry && allowStale)
      return JSON.parse(entry.json) as T

    if (found && !entry)
      db.delete(metaCache).where(eq(metaCache.key, key)).run()

    throw err
  }

  storeMetaCache(key, value)

  return value
}

/** Записывает свежий ответ источника: так обновление обходит срок кэша */
export function storeMetaCache(key: string, value: unknown) {
  const json = JSON.stringify(value)
  const fetchedAt = new Date()

  getDb()
    .insert(metaCache)
    .values({ key, json, fetchedAt })
    .onConflictDoUpdate({ target: metaCache.key, set: { json, fetchedAt } })
    .run()
}

/** Запись кэша без запроса в сеть, любой свежести в пределах хранения */
export function readMetaCache<T>(
  key: string,
  now = Date.now(),
  maxAgeMs = TMDB_MAX_CACHE_AGE_MS,
) {
  const found = getDb()
    .select()
    .from(metaCache)
    .where(eq(metaCache.key, key))
    .get()

  return found
    && now - found.fetchedAt.getTime() < Math.min(maxAgeMs, TMDB_MAX_CACHE_AGE_MS)
    ? (JSON.parse(found.json) as T)
    : undefined
}

/** Indexed cache reads for a list of public keys, without one statement per key. */
export function readMetaCacheBatch<T>(keys: string[], now: number) {
  const values = new Map<string, { value: T, fetchedAt: number }>()
  if (!keys.length)
    return values

  const rows = getDb().all<{
    key: string
    json: string
    fetched_at: number
  }>(sql`
    SELECT cache.key, cache.json, cache.fetched_at
    FROM json_each(${JSON.stringify(keys)}) requested
    JOIN meta_cache cache ON cache.key = requested.value
    WHERE cache.fetched_at > ${now - TMDB_MAX_CACHE_AGE_MS}
  `)
  for (const row of rows) {
    try {
      values.set(row.key, {
        value: JSON.parse(row.json) as T,
        fetchedAt: row.fetched_at,
      })
    }
    catch (error) {
      if (!(error instanceof SyntaxError))
        throw error
    }
  }
  return values
}

/** Ключи кэша по шаблону `LIKE` */
export function metaCacheKeys(pattern: string) {
  return getDb()
    .select({ key: metaCache.key })
    .from(metaCache)
    .where(like(metaCache.key, pattern))
    .all()
    .map(row => row.key)
}

/**
 * Удаляет записи, достигшие предела (та же граница, что в `withMetaCache`).
 * Без неё запись, которую больше никто не запрашивает, осталась бы навсегда.
 */
export function purgeExpiredMetaCache(now = Date.now()) {
  const result = getDb()
    .delete(metaCache)
    .where(lte(metaCache.fetchedAt, new Date(now - TMDB_MAX_CACHE_AGE_MS)))
    .run()

  return result.changes
}
