import { eq, lte } from 'drizzle-orm'
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
    if (entry)
      return JSON.parse(entry.json) as T

    if (found)
      db.delete(metaCache).where(eq(metaCache.key, key)).run()

    throw err
  }

  const json = JSON.stringify(value)
  const fetchedAt = new Date()

  db.insert(metaCache)
    .values({ key, json, fetchedAt })
    .onConflictDoUpdate({ target: metaCache.key, set: { json, fetchedAt } })
    .run()

  return value
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
