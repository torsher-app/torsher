import type { ParsedRelease } from '@torsher/release-parser'
import type { FoundRelease } from '../sources/rank.ts'
import { and, eq, lte, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { follows, followSeasons, trackerEpisodes } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { tmdbEpisodeCounts } from '../tmdb/index.ts'

// Диапазон дальше TMDB больше этого — скорее ошибка разбора, чем серии
const MAX_AHEAD = 100

type MatchedRelease = Pick<FoundRelease, 'title' | 'parsed' | 'match'>

/**
 * Сезон явного диапазона серий: один сезон в названии, без сезона — первый,
 * если в TMDB у сериала не больше одного сезона. Сезон дальше следующего за
 * последним известным — ошибка разбора.
 */
function rangeSeason(parsed: ParsedRelease, counts: Map<number, number>) {
  const regular = [...counts.keys()].filter(number => number > 0)
  const season
    = parsed.seasons.length === 1
      ? parsed.seasons[0]!
      : !parsed.seasons.length && regular.length <= 1
          ? 1
          : undefined

  if (season === undefined || season <= 0)
    return undefined

  return season <= Math.max(0, ...regular) + 1 ? season : undefined
}

/** «из 12» — подсказка размера сезона слежения; запоминается наибольшее */
function saveExpectedTotal(
  db: Pick<ReturnType<typeof getDb>, 'insert'>,
  followId: string,
  season: number,
  total: number,
  now: Date,
) {
  db.insert(followSeasons)
    .values({ followId, season, expectedTotal: total, updatedAt: now })
    .onConflictDoUpdate({
      target: [followSeasons.followId, followSeasons.season],
      set: {
        expectedTotal: sql`max(coalesce(${followSeasons.expectedTotal}, 0), ${total})`,
        updatedAt: now,
      },
    })
    .run()
}

/**
 * Серии из уверенно сопоставленных раздач сериала, которых нет в TMDB: номер
 * больше числа серий сезона или сезона в TMDB нет. Берётся только явный
 * диапазон из названия; «из N» серий не создаёт. Первое появление и название
 * раздачи — от первой раздачи с серией.
 */
export async function recordTrackerEpisodes(
  titleId: string,
  releases: MatchedRelease[],
  now = new Date(),
) {
  const ranged = releases.filter(
    release => release.match.confidence === 'high' && release.parsed.episodes,
  )

  if (!ranged.length)
    return

  let counts: Map<number, number> | undefined

  try {
    counts = await tmdbEpisodeCounts(titleId)
  }
  catch (err) {
    logFor('catalog').warn(
      { err, titleId },
      'Title details unavailable for tracker episodes',
    )
    return
  }

  if (!counts)
    return

  const follow = getDb()
    .select({ id: follows.id })
    .from(follows)
    .where(eq(follows.titleId, titleId))
    .get()

  getDb().transaction((tx) => {
    for (const release of ranged) {
      const range = release.parsed.episodes!
      const season = rangeSeason(release.parsed, counts)

      if (season === undefined)
        continue

      if (follow && range.total && range.total >= range.to)
        saveExpectedTotal(tx, follow.id, season, range.total, now)

      const known = counts.get(season) ?? 0

      if (range.to - known > MAX_AHEAD)
        continue

      for (
        let episode = Math.max(range.from, known + 1);
        episode <= range.to;
        episode++
      ) {
        tx.insert(trackerEpisodes)
          .values({
            titleId,
            season,
            episode,
            firstSeenAt: now,
            releaseTitle: release.title,
          })
          .onConflictDoNothing()
          .run()
      }
    }
  })
}

/**
 * Серии, которые TMDB уже знает, с трекера больше не нужны: показ и так
 * берёт их из TMDB. Тайтл, чьи детали не загрузились, ждёт следующей чистки.
 */
export async function purgeTrackerEpisodes() {
  const db = getDb()
  const titles = db
    .selectDistinct({ titleId: trackerEpisodes.titleId })
    .from(trackerEpisodes)
    .all()

  for (const { titleId } of titles) {
    let counts: Map<number, number> | undefined

    try {
      counts = await tmdbEpisodeCounts(titleId)
    }
    catch {
      continue
    }

    if (!counts) {
      db.delete(trackerEpisodes)
        .where(eq(trackerEpisodes.titleId, titleId))
        .run()
      continue
    }

    for (const [season, count] of counts) {
      db.delete(trackerEpisodes)
        .where(
          and(
            eq(trackerEpisodes.titleId, titleId),
            eq(trackerEpisodes.season, season),
            lte(trackerEpisodes.episode, count),
          ),
        )
        .run()
    }
  }
}
