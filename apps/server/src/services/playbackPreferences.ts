import type { SavedTrackPreferences } from './media/trackPreferences.ts'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/index.ts'
import { playbackPreferences } from '../db/schema.ts'

export function getPlaybackPreferences(profileId: string, titleId: string) {
  return getDb()
    .select()
    .from(playbackPreferences)
    .where(
      and(
        eq(playbackPreferences.profileId, profileId),
        eq(playbackPreferences.titleId, titleId),
      ),
    )
    .get()
}
export function savePlaybackPreferences(
  profileId: string,
  titleId: string,
  change: SavedTrackPreferences,
) {
  getDb()
    .insert(playbackPreferences)
    .values({ profileId, titleId, ...change })
    .onConflictDoUpdate({
      target: [playbackPreferences.profileId, playbackPreferences.titleId],
      set: change,
    })
    .run()
}
