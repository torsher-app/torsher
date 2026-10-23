import { and, desc, eq, gt } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleProgress } from '../../db/schema.ts'
import { isWatched } from '../torrents/playback.ts'
import { cardOf, summariesOf } from './cards.ts'

/**
 * История профиля для владельца: по тайтлу — последняя просмотренная серия
 * и время, свежие сверху. Журнала просмотров нет: пересмотр — та же строка
 * с новым временем.
 */
export async function profileHistory(
  profileId: string,
  page: { offset: number, limit: number, language: string },
) {
  const rows = getDb()
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        gt(titleProgress.position, 0),
      ),
    )
    // Отметка всего сериала пишет серии одним временем: последней считается дальняя
    .orderBy(
      desc(titleProgress.updatedAt),
      desc(titleProgress.season),
      desc(titleProgress.episode),
    )
    .all()
  const latest = new Map<string, (typeof rows)[number]>()

  for (const row of rows) {
    if (!latest.has(row.titleId))
      latest.set(row.titleId, row)
  }

  const entries = [...latest.values()]
  const slice = entries.slice(page.offset, page.offset + page.limit)
  const summaries = await summariesOf(
    slice.map(row => row.titleId),
    page.language,
  )

  return {
    total: entries.length,
    items: slice.flatMap((row, index) => {
      const summary = summaries[index]

      if (!summary)
        return []

      return [
        {
          title: cardOf(summary.details),
          season: row.season || null,
          episode: row.season ? row.episode : null,
          position: row.position,
          duration: row.duration,
          watched: isWatched(row.position, row.duration),
          watchedAt: row.updatedAt.toISOString(),
        },
      ]
    }),
  }
}
