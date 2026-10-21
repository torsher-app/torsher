import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { serverSettings } from '../../db/schema.ts'

export function getSetting<T>(key: string): T | undefined {
  const row = getDb()
    .select()
    .from(serverSettings)
    .where(eq(serverSettings.key, key))
    .get()

  return row?.value as T | undefined
}

export function setSetting(key: string, value: unknown) {
  const row = { value, updatedAt: new Date() }

  getDb()
    .insert(serverSettings)
    .values({ key, ...row })
    .onConflictDoUpdate({ target: serverSettings.key, set: row })
    .run()
}

export function deleteSetting(key: string) {
  getDb().delete(serverSettings).where(eq(serverSettings.key, key)).run()
}
