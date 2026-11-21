import { sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'

function personalFacts(profileId: string, titleId?: string) {
  const title = titleId ? sql`AND title_id = ${titleId}` : sql``
  return sql`
    SELECT title_id AS titleId, season, episode FROM diary_seen
    WHERE profile_id = ${profileId} ${title}
    UNION
    SELECT title_id AS titleId, season, episode FROM cycle_playback_facts
    WHERE profile_id = ${profileId} AND watched_at IS NOT NULL ${title}
  `
}

export function personalSeenRows(profileId: string, titleId?: string) {
  return getDb().all<{ titleId: string, season: number, episode: number }>(
    personalFacts(profileId, titleId),
  )
}

/** Viewer marks only; this never supplies a playback position or resume target. */
export function seenEpisodesOf(profileId: string, titleId: string) {
  return getDb().all<{ season: number, episode: number }>(sql`
    SELECT season, episode FROM (${personalFacts(profileId, titleId)}) WHERE episode > 0
    UNION
    SELECT season, episode FROM title_progress
    WHERE profile_id = ${profileId} AND title_id = ${titleId}
      AND episode > 0 AND watched_at IS NOT NULL
    ORDER BY season, episode
  `)
}
