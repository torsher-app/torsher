import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  followEpisodes,
  followProfiles,
  follows,
  titleProgress,
} from '../../db/schema.ts'
import { watchedEpisodes } from '../mine/status.ts'
import { episodeKey } from './wanted.ts'

/**
 * Значок «слежу» на постерах: тайтлы, за которыми следит профиль, и сколько
 * серий автоматика положила в библиотеку, а профиль не досмотрел
 */
export function followBadges(profileId: string, titleIds: string[]) {
  const badges = new Map<string, number>()

  if (!titleIds.length)
    return badges

  const db = getDb()
  const followed = db
    .select({ id: follows.id, titleId: follows.titleId })
    .from(followProfiles)
    .innerJoin(follows, eq(follows.id, followProfiles.followId))
    .where(
      and(
        eq(followProfiles.profileId, profileId),
        inArray(follows.titleId, [...new Set(titleIds)]),
        inArray(follows.state, ['active', 'paused']),
      ),
    )
    .all()

  if (!followed.length)
    return badges

  const downloaded = db
    .select({
      followId: followEpisodes.followId,
      season: followEpisodes.season,
      episode: followEpisodes.episode,
    })
    .from(followEpisodes)
    .where(
      and(
        inArray(
          followEpisodes.followId,
          followed.map(item => item.id),
        ),
        isNotNull(followEpisodes.downloadedAt),
      ),
    )
    .all()
  const progress = db
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        inArray(
          titleProgress.titleId,
          followed.map(item => item.titleId),
        ),
      ),
    )
    .all()

  for (const { id, titleId } of followed) {
    const watched = watchedEpisodes(
      progress.filter(point => point.titleId === titleId),
    )

    badges.set(
      titleId,
      downloaded.filter(
        row =>
          row.followId === id
          && row.season > 0
          && !watched.has(episodeKey(row)),
      ).length,
    )
  }

  return badges
}
