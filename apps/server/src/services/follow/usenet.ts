import type { VideoClass } from '@torsher/release-parser'
import type { Follow } from '../../db/schema.ts'
import type { NzbTarget } from '../newznab/search.ts'
import { videoResolution } from '@torsher/release-parser'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, followSeasons } from '../../db/schema.ts'
import { suppressedEpisodes } from '../libraryMaintenance/suppression.ts'
import { withDownloadAdmission } from '../newznab/admission.ts'
import {
  candidateCurrent,
  downloadNewznabCandidate,
  hasNewznabIndexers,
  searchNewznab,
} from '../newznab/search.ts'
import {
  preferredAudio,
  russianVoices,
  SCREEN_COPIES,
  SIZE_CORRIDOR,
  voiceMatches,
} from '../sources/rank.ts'
import {
  blockedUsenetReleaseKeys,
  enqueueUsenet,
  readyUsenet,
} from '../usenet/index.ts'
import { followAudio, followSourceProfile } from './audio.ts'
import { isDigitalSource } from './availability.ts'
import { cutoffStepOf, isAtCutoff, positionOf } from './decide.ts'
import { followStates, movieAvailability } from './pass.ts'
import { topicRefreshEpisodes } from './topics.ts'
import { seasonVoice, voiceGuard } from './voice.ts'
import { episodeKey } from './wanted.ts'

const cursors = new Map<string, string>()
const HOUR_MS = 3_600_000

async function missingTargets(follow: Follow, now: Date) {
  const suppressed = suppressedEpisodes(follow.titleId)
  const refreshing = topicRefreshEpisodes(follow.titleId)
  return (await followStates(follow, now)).filter(
    item =>
      (item.state === 'searching' || item.state === 'missing')
      && !suppressed.has(episodeKey(item))
      && !refreshing.has(episodeKey(item))
      && (follow.kind === 'movie' || item.aired),
  )
}

export function canSearchUsenet(follow: Follow) {
  return (
    follow.state === 'active'
    && follow.mode === 'download'
    && readyUsenet(true)
    && hasNewznabIndexers()
  )
}

function windowStart(follow: Follow, target: NzbTarget, now: Date) {
  const db = getDb()
  const where = and(
    eq(followEpisodes.followId, follow.id),
    eq(followEpisodes.season, target.season),
    eq(followEpisodes.episode, target.episode),
  )
  const row = db
    .select({ at: followEpisodes.firstSeenAt })
    .from(followEpisodes)
    .where(where)
    .get()
  if (row)
    return row.at
  db.insert(followEpisodes)
    .values({
      followId: follow.id,
      season: target.season,
      episode: target.episode,
      firstSeenAt: now,
    })
    .onConflictDoNothing()
    .run()
  return now
}

/** One film or episode per targeted pass, after Torznab has settled. */
export async function searchFollowUsenet(
  follow: Follow,
  reserved: ReadonlySet<string>,
  now: Date,
) {
  if (!canSearchUsenet(follow))
    return { searched: false }
  const missing = (await missingTargets(follow, now)).filter(
    item => !reserved.has(episodeKey(item)),
  )
  if (!missing.length)
    return { searched: false }
  const previous = cursors.get(follow.id)
  const index = missing.findIndex(item => episodeKey(item) === previous)
  const { season, episode } = missing[(index + 1) % missing.length]!
  if (cursors.size > 500)
    cursors.clear()
  cursors.set(follow.id, episodeKey({ season, episode }))
  const target = { titleId: follow.titleId, season, episode }
  const current = voiceGuard(follow, [season])
  const result = await searchNewznab(target, { automation: true })
  if (!result || !current() || !readyUsenet(true))
    return { searched: true }

  const blocked = blockedUsenetReleaseKeys(follow.titleId)
  const availability = await movieAvailability(follow, now)
  const voice = seasonVoice(follow, season)
  const profile = followSourceProfile(follow)
  const ctx = {
    kind: follow.kind,
    preset: follow.qualityPreset,
    profile,
    voiceMode: follow.voiceMode,
    pinned: voice,
    originalLanguage: result.identity.originalLanguage,
    russianOriginal: result.identity.originalLanguage === 'ru',
  }
  const db = getDb()
  const savedSeason = db
    .select()
    .from(followSeasons)
    .where(
      and(
        eq(followSeasons.followId, follow.id),
        eq(followSeasons.season, season),
      ),
    )
    .get()
  const considered = db
    .select({ episode: followEpisodes.episode })
    .from(followEpisodes)
    .where(
      and(
        eq(followEpisodes.followId, follow.id),
        eq(followEpisodes.season, season),
      ),
    )
    .all()
    .length
  const seasonContext = {
    season,
    voice,
    cutoffStep: cutoffStepOf(
      follow.qualityPreset,
      (savedSeason?.bestQualitySeen as VideoClass | null) ?? undefined,
      considered,
    ),
  }

  const choices = result.candidates
    .flatMap((candidate) => {
      const { parsed } = candidate
      if (
        blocked.has(candidate.releaseKey)
        || !candidateCurrent(candidate, true)
        || (parsed.source && SCREEN_COPIES.has(parsed.source))
        || (availability
          && !availability.available
          && !isDigitalSource(parsed.source))
      ) {
        return []
      }
      if (
        follow.audio === 'ru'
        && follow.requireRussian
        && !russianVoices(parsed, ctx).length
      ) {
        return []
      }
      const audio = preferredAudio(parsed, ctx)
      if (
        !audio
        || (followAudio(follow) === 'ru'
          && (follow.voiceStrict || follow.voiceMode === 'only')
          && voice?.studio
          && !audio.voices.some(track => voiceMatches(track, voice)))
      ) {
        return []
      }
      const resolution = videoResolution(parsed)
      const corridor
        = resolution && SIZE_CORRIDOR[follow.kind][resolution.value]
      if (
        corridor
        && candidate.size
        && (candidate.size < corridor[0] / 2 || candidate.size > corridor[1] * 2)
      ) {
        return []
      }
      const position = positionOf(
        { parsed, voices: audio.voices, resolution },
        seasonContext,
        ctx,
      )
      return Number.isFinite(position.step) ? [{ candidate, position }] : []
    })
    .sort(
      (a, b) =>
        (a.position.audioPriority ?? 0) - (b.position.audioPriority ?? 0)
        || Number(b.position.voiceAtCutoff) - Number(a.position.voiceAtCutoff)
        || a.position.step - b.position.step
        || (a.position.typePriority ?? 0) - (b.position.typePriority ?? 0)
        || a.candidate.rank - b.candidate.rank
        || a.candidate.releaseKey.localeCompare(b.candidate.releaseKey),
    )

  if (!choices.length || !current())
    return { searched: true }
  const deadline = new Date(
    windowStart(follow, target, now).getTime() + follow.waitHours * HOUR_MS,
  )
  const selected
    = deadline <= now
      ? choices[0]
      : choices.find(item => isAtCutoff(item.position, seasonContext))
  if (!selected)
    return { searched: true, nextAt: deadline }

  await withDownloadAdmission(follow.titleId, async () => {
    const { candidate } = selected
    const available = (await missingTargets(follow, new Date())).some(
      item => episodeKey(item) === episodeKey(target),
    )
    if (
      !available
      || !current()
      || !readyUsenet(true)
      || !candidateCurrent(candidate, true)
    ) {
      return
    }
    await enqueueUsenet(
      { ...candidate, origin: 'follow', followId: follow.id },
      () => downloadNewznabCandidate(candidate, true),
      () =>
        current()
        && candidateCurrent(candidate, true)
        && !suppressedEpisodes(follow.titleId).has(episodeKey(target)),
    )
  })
  return { searched: true }
}
