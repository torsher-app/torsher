import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { metaCache } from '../../db/schema.ts'

/**
 * Свежая запись отдаётся без запроса в сеть. Если загрузка упала, отдаём
 * протухшую запись, когда она есть: каталог продолжает работать без источника.
 */
export async function withMetaCache<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const db = getDb()
  const entry = db.select().from(metaCache).where(eq(metaCache.key, key)).get()

  if (entry && Date.now() - entry.fetchedAt.getTime() < ttlMs)
    return JSON.parse(entry.json) as T

  let value: T

  try {
    value = await load()
  }
  catch (err) {
    if (entry)
      return JSON.parse(entry.json) as T

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
