import type { MineRecommendationsQuery } from '../../dto/mineRecommendations.ts'
import type { Profile } from '../../db/schema.ts'
import { sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { cachedTitleAges } from '../tmdb/certification.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { DAY_MS } from './calendar.ts'
import { journalRead } from './journal.ts'

interface TitleSignal {
  title_id: string
  rating: number | null
  rated_at: number | null
  favorite_at: number | null
  watchlist_at: number | null
  dropped_at: number | null
  watched_marked_at: number | null
}

export interface RecommendationSeed {
  id: string
  strength: number
  at: number
  rating: number | null
  favorite: boolean
  watched: boolean
}

const seedLimit = 12
const recentLimit = 6

function chooseSeeds(seeds: RecommendationSeed[], now: number) {
  const strengthOrder = (a: RecommendationSeed, b: RecommendationSeed) =>
    b.strength - a.strength || b.at - a.at || a.id.localeCompare(b.id)
  const stable = [...seeds].sort(strengthOrder)
  const recent = seeds
    .filter(seed => seed.at >= now - 365 * DAY_MS)
    .sort((a, b) => b.at - a.at || strengthOrder(a, b))
  const selected = new Map<string, RecommendationSeed>()
  for (let i = 0; i < recentLimit; i++) {
    const longTerm = stable.find(seed => !selected.has(seed.id))
    if (longTerm)
      selected.set(longTerm.id, longTerm)
    const lately = recent.find(seed => !selected.has(seed.id))
    if (lately)
      selected.set(lately.id, lately)
  }
  for (const seed of stable) {
    if (selected.size >= seedLimit)
      break
    selected.set(seed.id, seed)
  }
  return [...selected.values()]
}

function strengthOf(
  own: TitleSignal | undefined,
  watched: boolean,
  rewatch: boolean,
) {
  const rating = own?.rating
  const ratingWeight
    = rating && rating >= 6
      ? rating >= 8
        ? 65 + rating * 3
        : 30 + rating * 3
      : 0
  return Math.max(
    ratingWeight,
    own?.favorite_at != null ? 89 : 0,
    rewatch ? 58 : 0,
    watched ? 24 : 0,
  )
}

export function recommendationSignals(
  profile: Profile,
  language: string,
  timeZone: string,
  now: number,
  kind: MineRecommendationsQuery['kind'] = 'all',
) {
  const db = getDb()
  const profileId = profile.id
  const own = new Map(
    db
      .all<TitleSignal>(
        sql`
    SELECT title_id, rating, rated_at, favorite_at, watchlist_at, dropped_at, watched_marked_at
    FROM profile_titles WHERE profile_id = ${profileId}
  `,
      )
      .map(row => [row.title_id, row]),
  )
  const hidden = new Set(
    db
      .all<{ title_id: string }>(
        sql`
    SELECT title_id FROM mine_title_preferences WHERE profile_id = ${profileId} AND not_interested = 1
  `,
      )
      .map(row => row.title_id),
  )
  const activity = db.all<{
    title_id: string
    watching: number
    watched_at: number | null
    played_at: number | null
  }>(sql`
    SELECT title_id, max(watching) watching, max(watched_at) watched_at, max(played_at) played_at FROM (
      SELECT title_id, (position > 0) AS watching, watched_at,
        CASE WHEN position > 0 OR watched_at IS NOT NULL THEN updated_at END AS played_at
      FROM title_progress WHERE profile_id = ${profileId}
      UNION ALL
      SELECT title_id, 0, watched_at, NULL
      FROM cycle_playback_facts WHERE profile_id = ${profileId} AND watched_at IS NOT NULL
    ) GROUP BY title_id
  `)
  const active = new Map(activity.map(row => [row.title_id, row]))
  const blocked = new Set(hidden)
  const negative = new Set(hidden)
  const watchlist = new Map<string, number>()
  for (const row of own.values()) {
    const progress = active.get(row.title_id)
    const dropped
      = row.dropped_at !== null
        && (progress?.played_at == null || row.dropped_at >= progress.played_at)
    if (dropped || (row.rating !== null && row.rating <= 5))
      negative.add(row.title_id)
    if (dropped || row.rating !== null || row.watched_marked_at !== null)
      blocked.add(row.title_id)
    if (row.watchlist_at !== null)
      watchlist.set(row.title_id, row.watchlist_at)
  }
  for (const row of activity) {
    if (row.watching || row.watched_at !== null)
      blocked.add(row.title_id)
  }
  const seen = new Set(
    db
      .all<{ title_id: string }>(
        sql`
    SELECT DISTINCT title_id FROM diary_seen WHERE profile_id = ${profileId}
  `,
      )
      .map(row => row.title_id),
  )
  for (const titleId of seen) blocked.add(titleId)
  for (const row of db.all<{ title_id: string }>(sql`
    SELECT title_id FROM rewatch_cycles WHERE profile_id = ${profileId} AND state != 'ended'
  `)) {
    blocked.add(row.title_id)
  }

  const history = journalRead(
    {
      profileId,
      language,
      filter: { kind: 'all', rewatch: 'any', date: 'any' },
    },
    timeZone,
    now,
  )
  const diary = new Map(
    db
      .all<{ title_id: string, last_day: string, repeated: number }>(
        sql`
    ${history.scope()}
    SELECT title_id, max(local_day) AS last_day, max(rewatch) AS repeated FROM result GROUP BY title_id
  `,
      )
      .map(row => [row.title_id, row]),
  )
  const ids = [
    ...new Set([...own.keys(), ...active.keys(), ...diary.keys(), ...seen]),
  ].filter(id => !negative.has(id) && parseCatalogId(id))
  const ages
    = profile.ageLimit === null ? undefined : cachedTitleAges(ids, now)
  const seeds = ids.flatMap((id) => {
    if (
      profile.ageLimit !== null
      && (ages?.get(id) ?? Infinity) >= profile.ageLimit
    ) {
      return []
    }
    const row = own.get(id)
    const event = diary.get(id)
    const playedAt = active.get(id)?.watched_at
    const watched
      = !!event
        || seen.has(id)
        || playedAt != null
        || row?.watched_marked_at != null
    const strength = strengthOf(row, watched, !!event?.repeated)
    if (!strength)
      return []
    return [
      {
        id,
        strength,
        rating: row?.rating ?? null,
        favorite: row?.favorite_at != null,
        watched,
        at: Math.max(
          row?.rated_at ?? 0,
          row?.favorite_at ?? 0,
          row?.watched_marked_at ?? 0,
          playedAt ?? 0,
          event?.last_day ? Date.parse(`${event.last_day}T12:00:00Z`) : 0,
        ),
      },
    ]
  })
  const compatible
    = kind === 'all'
      ? seeds
      : seeds.filter(
          seed =>
            parseCatalogId(seed.id)?.type
            === (kind === 'movie' ? 'movie' : 'tv'),
        )
  return {
    seeds: chooseSeeds(compatible, now),
    blocked,
    watchlist,
    hasPersonalSignals: seeds.length > 0,
  }
}
