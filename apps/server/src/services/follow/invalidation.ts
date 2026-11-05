import type { Follow } from '../../db/schema.ts'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, follows, titleProgress } from '../../db/schema.ts'
import { permitsCandidate } from './voice.ts'
import { isStarted } from './upgrade.ts'
import { stateInputs } from './episodes.ts'
import { episodeKey } from './wanted.ts'

/** Existing watching/manual/library choices do not belong to a new voice rule. */
export function protectedVoiceEpisodes(follow: Follow) {
  const protectedKeys = new Set(
    getDb()
      .select()
      .from(titleProgress)
      .where(eq(titleProgress.titleId, follow.titleId))
      .all()
      .filter(row => row.watchedAt || isStarted(row.position, row.duration))
      .map(episodeKey),
  )
  const { library, downloading } = stateInputs(follow, follow.kind)
  return new Set([...protectedKeys, ...library, ...downloading])
}

/** Preserve started, watched, manual/library versions; re-evaluate only automation. */
export function invalidateVoicePicks(follow: Follow) {
  const db = getDb()
  const protectedKeys = protectedVoiceEpisodes(follow)
  let changed = false
  for (const row of db
    .select()
    .from(followEpisodes)
    .where(eq(followEpisodes.followId, follow.id))
    .all()) {
    if (
      !row.picked
      || row.torrentId
      || row.downloadedAt
      || protectedKeys.has(episodeKey(row))
      || permitsCandidate(follow, row.picked, row.season)
    ) {
      continue
    }
    db.update(followEpisodes)
      .set({
        picked: null,
        pickedAt: null,
        pending: null,
        waitUntil: null,
        stateNote: null,
      })
      .where(
        and(
          eq(followEpisodes.followId, follow.id),
          eq(followEpisodes.season, row.season),
          eq(followEpisodes.episode, row.episode),
        ),
      )
      .run()
    changed = true
  }
  if (changed) {
    db.update(follows)
      .set({
        nextSearchAt: null,
        lastSearchAt: null,
        ...(follow.state === 'done' && { state: 'active' as const }),
      })
      .where(eq(follows.id, follow.id))
      .run()
  }
}
