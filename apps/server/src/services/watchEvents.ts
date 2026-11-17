import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/index.ts'
import { watchEvents } from '../db/schema.ts'

/** Call inside the same transaction as both progress projections. */
export function acceptWatchEvent(
  profileId: string,
  resources: string[],
  event?: { clientId: string, sequence: number },
) {
  if (!event)
    return true
  const db = getDb()
  const where = (resource: string) =>
    and(
      eq(watchEvents.profileId, profileId),
      eq(watchEvents.clientId, event.clientId),
      eq(watchEvents.resource, resource),
    )
  if (
    resources.some((resource) => {
      const previous = db
        .select()
        .from(watchEvents)
        .where(where(resource))
        .get()
      return previous && previous.sequence >= event.sequence
    })
  ) {
    return false
  }
  for (const resource of resources) {
    db.insert(watchEvents)
      .values({ profileId, ...event, resource })
      .onConflictDoUpdate({
        target: [
          watchEvents.profileId,
          watchEvents.clientId,
          watchEvents.resource,
        ],
        set: { sequence: event.sequence },
      })
      .run()
  }
  return true
}
