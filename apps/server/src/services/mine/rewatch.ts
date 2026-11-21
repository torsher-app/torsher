import { sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'

function canonicalTrakt(
  origin: ReturnType<typeof sql>,
  key: ReturnType<typeof sql>,
) {
  return sql`
    ${origin} = 'trakt' AND substr(${key}, 1, 3) = 'id:'
    AND substr(${key}, 4, 1) GLOB '[1-9]'
    AND substr(${key}, 4) NOT GLOB '*[^0-9]*'
    AND (length(${key}) < 22 OR (length(${key}) = 22 AND substr(${key}, 4) <= '9223372036854775807'))
  `
}

/**
 * Affected groups come from the visible date window. Their prior Trakt facts
 * come from the whole history. Origin keys are unique per profile and source,
 * so a strictly earlier matching row is necessarily a different Trakt event.
 */
export function effectiveRewatchCtes(profileId: string, timeZone: string) {
  const scopedTrakt = canonicalTrakt(sql`s.origin`, sql`s.origin_key`)
  return sql`
    trakt_groups AS MATERIALIZED (
      SELECT title_id, season, episode, max(precision_rank = 1) AS needs_local_instants
      FROM scoped s WHERE s.recorded_rewatch = 0 AND s.precision_rank > 0 AND ${scopedTrakt}
      GROUP BY title_id, season, episode
    ),
    trakt_prior AS MATERIALIZED (
      SELECT g.title_id, g.season, g.episode, min(p.instant) AS first_instant, min(p.day) AS first_day,
        min(CASE WHEN g.needs_local_instants AND p.precision = 'instant' THEN mine_day_at(p.instant, ${timeZone}) END) AS first_instant_day
      FROM trakt_groups g
      JOIN diary_entries p ON p.profile_id = ${profileId} AND p.title_id = g.title_id
        AND p.season = g.season AND p.episode = g.episode
      WHERE p.precision IN ('day', 'instant') AND ${canonicalTrakt(sql`p.origin`, sql`p.origin_key`)}
      GROUP BY g.title_id, g.season, g.episode
    ),
    effective AS MATERIALIZED (
      SELECT s.*, CASE WHEN s.recorded_rewatch = 1 THEN 1
        WHEN s.precision_rank > 0 AND ${scopedTrakt}
          AND (p.first_day < s.local_day
            OR (s.precision_rank = 1 AND p.first_instant_day < s.local_day)
            OR (s.precision_rank = 2 AND p.first_instant < s.instant_sort - ((s.instant_sort % 60000 + 60000) % 60000)))
          THEN 1 ELSE 0 END AS rewatch
      FROM scoped s LEFT JOIN trakt_prior p ON p.title_id = s.title_id AND p.season = s.season AND p.episode = s.episode
    )
  `
}

export function rewatchForEntry(
  profileId: string,
  entryId: string,
  timeZone: string,
) {
  return (
    getDb().get<{ rewatch: number }>(sql`
    WITH scoped AS MATERIALIZED (
      SELECT title_id, season, episode, origin, origin_key, rewatch AS recorded_rewatch,
        CASE precision WHEN 'instant' THEN mine_day_at(instant, ${timeZone}) ELSE COALESCE(day, '') END AS local_day,
        CASE precision WHEN 'instant' THEN 2 WHEN 'day' THEN 1 ELSE 0 END AS precision_rank,
        COALESCE(instant, 0) AS instant_sort
      FROM diary_entries WHERE profile_id = ${profileId} AND id = ${entryId}
    ), ${effectiveRewatchCtes(profileId, timeZone)}
    SELECT rewatch FROM effective
  `)?.rewatch === 1
  )
}
