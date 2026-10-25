import type { TrackerEpisode } from './mappers.ts'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { trackerEpisodes } from '../../db/schema.ts'
import { localDay } from '../../utils/localDay.ts'

/** Серии тайтла с трекера: детали и сезоны TMDB показывают их вышедшими */
export function trackerEpisodesOf(titleId: string): TrackerEpisode[] {
  return getDb()
    .select({
      season: trackerEpisodes.season,
      episode: trackerEpisodes.episode,
      firstSeenAt: trackerEpisodes.firstSeenAt,
    })
    .from(trackerEpisodes)
    .where(eq(trackerEpisodes.titleId, titleId))
    .all()
    .map(row => ({
      season: row.season,
      episode: row.episode,
      seenOn: localDay(row.firstSeenAt),
    }))
}
