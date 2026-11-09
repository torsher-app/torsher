import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { profileTitles } from '../../db/schema.ts'

/** Отдельная отметка тайтла не доказывает просмотр его серий или файлов. */
export function watchedMarkedTitles(profileId: string) {
  return new Set(
    getDb()
      .select({ titleId: profileTitles.titleId })
      .from(profileTitles)
      .where(
        and(
          eq(profileTitles.profileId, profileId),
          isNotNull(profileTitles.watchedMarkedAt),
        ),
      )
      .all()
      .map(row => row.titleId),
  )
}

export function hasWatchedMark(profileId: string, titleId: string) {
  return !!getDb()
    .select({ at: profileTitles.watchedMarkedAt })
    .from(profileTitles)
    .where(
      and(
        eq(profileTitles.profileId, profileId),
        eq(profileTitles.titleId, titleId),
      ),
    )
    .get()
    ?.at
}

/** В транзакции writer: новый просмотр или ручное снятие важнее отмены импорта. */
export function clearWatchedMark(profileId: string, titleId: string) {
  const db = getDb()
  const where = and(
    eq(profileTitles.profileId, profileId),
    eq(profileTitles.titleId, titleId),
  )
  const row = db.select().from(profileTitles).where(where).get()

  if (!row?.watchedMarkedAt)
    return

  if (!row.watchlistAt && !row.favoriteAt && !row.rating && !row.droppedAt) {
    db.delete(profileTitles).where(where).run()
    return
  }

  db.update(profileTitles)
    .set({
      watchedMarkedAt: null,
      // Даже два действия в одну миллисекунду различимы для undo guard.
      updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)),
    })
    .where(where)
    .run()
}
