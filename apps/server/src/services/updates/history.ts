import { desc } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { serverVersions } from '../../db/schema.ts'

/**
 * Запоминает версию при старте. Возвращает прежнюю, если версия сменилась;
 * на первом старте истории нет — и сообщения «обновлено» тоже.
 */
export function recordServerVersion() {
  const db = getDb()
  const last = db
    .select()
    .from(serverVersions)
    .orderBy(desc(serverVersions.id))
    .limit(1)
    .get()

  if (last?.version === config.version)
    return undefined

  db.insert(serverVersions)
    .values({ version: config.version, commit: config.commit })
    .run()

  return last?.version
}
