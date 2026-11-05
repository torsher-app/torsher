import type { Follow, FollowPendingCandidate } from '../../db/schema.ts'
import type { voiceResolution } from '../../dto/follow.ts'
import type { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { follows } from '../../db/schema.ts'
import { getPinnedVoice } from '../sources/voices.ts'
import { preferredAudio, voiceMatches } from '../sources/rank.ts'
import { followAudio, followSourceProfile } from './audio.ts'
import { peekTitleIdentity } from '../tmdb/identity.ts'
import { versionOf } from './upgrade.ts'

export function savedVoicePolicy(follow: Follow) {
  if (!follow.voiceMode) {
    return {
      mode: 'legacy' as const,
      studio: follow.voiceStudio,
      strict: follow.voiceStrict,
    }
  }
  if (follow.voiceMode === 'prefer' || follow.voiceMode === 'only')
    return { mode: follow.voiceMode, studio: follow.voiceStudio! }
  return { mode: follow.voiceMode }
}

export function resolveVoice(
  follow: Follow,
  season: number,
): z.output<typeof voiceResolution> {
  const active = followAudio(follow) === 'ru'
  const base = { season, active, sourceSeason: null }
  if (!active || follow.voiceMode === 'any')
    return { ...base, source: 'none' }
  if (
    (follow.voiceMode === 'prefer' || follow.voiceMode === 'only')
    && follow.voiceStudio
  ) {
    return { ...base, source: 'explicit', studio: follow.voiceStudio }
  }
  for (let number = season; number >= (season > 0 ? 1 : 0); number--) {
    const pinned = getPinnedVoice(follow.titleId, number)
    if (pinned) {
      return {
        ...base,
        ...pinned,
        source: number === season ? 'season_pin' : 'inherited_pin',
        sourceSeason: number,
      }
    }
  }
  if (!follow.voiceMode && follow.voiceStudio)
    return { ...base, source: 'explicit', studio: follow.voiceStudio }
  return {
    ...base,
    source: 'profile',
    type: followSourceProfile(follow).voiceTypes[0],
  }
}

export function seasonVoice(follow: Follow, season: number) {
  const resolved = resolveVoice(follow, season)
  // Profile types remain the cutoff, not a season pin.
  return resolved.source === 'none' || resolved.source === 'profile'
    ? undefined
    : { studio: resolved.studio, type: resolved.type }
}

/** Snapshot all effective rules and pins before asynchronous work. */
export function voiceFingerprint(row: Follow, seasons: number[]) {
  return JSON.stringify({
    mode: row.mode,
    policy: savedVoicePolicy(row),
    profile: followSourceProfile(row),
    wait: row.waitHours,
    quality: row.qualityPreset,
    audio: row.audio,
    requireRussian: row.requireRussian,
    pins: [...new Set(seasons)]
      .sort((a, b) => a - b)
      .map(season => resolveVoice(row, season)),
  })
}

export function voiceGuard(follow: Follow, seasons: number[]) {
  const expected = voiceFingerprint(follow, seasons)
  return () => {
    const current = getDb()
      .select()
      .from(follows)
      .where(eq(follows.id, follow.id))
      .get()
    return (
      !!current
      && current.state === follow.state
      && voiceFingerprint(current, seasons) === expected
    )
  }
}

/** Reparse all tracks: candidate.studio is only the old selected track. */
export function permitsCandidate(
  follow: Follow,
  candidate: FollowPendingCandidate,
  season: number,
) {
  const profile = followSourceProfile(follow)
  const pinned = seasonVoice(follow, season)
  const ctx = {
    kind: follow.kind,
    profile,
    pinned,
    originalLanguage: peekTitleIdentity(follow.titleId)?.originalLanguage,
  }
  const version = versionOf({ title: candidate.title }, ctx)
  if (!preferredAudio(version.parsed, ctx))
    return false
  return (
    followAudio(follow) !== 'ru'
    || !(follow.voiceMode === 'only' || follow.voiceStrict)
    || !pinned?.studio
    || version.voices.some(voice => voiceMatches(voice, pinned))
  )
}
