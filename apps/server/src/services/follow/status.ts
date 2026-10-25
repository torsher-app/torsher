import type { Follow } from '../../db/schema.ts'
import type { TitleFollowResponse } from '../../dto/follow.ts'
import type { EpisodeWithState } from './wanted.ts'
import type { VideoClass } from '@torsher/release-parser'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, followSeasons } from '../../db/schema.ts'
import { getPinnedVoice } from '../sources/voices.ts'
import { cutoffStepOf } from './decide.ts'
import { waitTargets } from './episodes.ts'
import { QUALITY_LADDERS } from './rank.ts'
import { episodeKey, WANTED_STATES } from './wanted.ts'
import { seasonVoice } from './voice.ts'

type FollowStatus = Pick<
  NonNullable<TitleFollowResponse['follow']>,
  'season' | 'voice' | 'quality' | 'waiting' | 'counts'
>

/** Сезон статуса: первой нужной серии, иначе следующей невышедшей, иначе курсора */
function statusSeason(follow: Follow, states: EpisodeWithState[]) {
  if (follow.kind === 'movie')
    return 0

  const wanted = states.find(item => WANTED_STATES.has(item.state))
  const upcoming = states.find(item => item.state === 'upcoming')

  return (wanted ?? upcoming)?.season ?? follow.startSeason
}

/** Ступень cutoff по качеству — так же, как её считает решатель */
function seasonQuality(follow: Follow, season: number) {
  const db = getDb()
  const best = db
    .select({ best: followSeasons.bestQualitySeen })
    .from(followSeasons)
    .where(
      and(
        eq(followSeasons.followId, follow.id),
        eq(followSeasons.season, season),
      ),
    )
    .get()
    ?.best as VideoClass | null | undefined
  const seen = db
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
  const step = cutoffStepOf(follow.qualityPreset, best ?? undefined, seen)

  return {
    value: QUALITY_LADDERS[follow.qualityPreset][step]!,
    lowered: step > 0,
  }
}

/**
 * Что витрина пишет о слежении в карточке: своя студия и cutoff сезона,
 * ближайшая отложенная серия и чего она ждёт, число серий по состояниям
 */
export function followStatus(
  follow: Follow,
  states: EpisodeWithState[],
): FollowStatus {
  const season = statusSeason(follow, states)
  const voice = seasonVoice(follow, season)
  const targets = waitTargets(follow.id)
  const waiting = states
    .filter(item => item.state === 'waiting' && item.waitUntil)
    .sort((a, b) => a.waitUntil!.getTime() - b.waitUntil!.getTime())[0]
  const target = waiting && targets.get(episodeKey(waiting))
  const count = (state: EpisodeWithState['state']) =>
    states.filter(item => item.state === state).length

  return {
    season,
    voice: voice
      ? { ...voice, pinned: !!getPinnedVoice(follow.titleId, season) }
      : null,
    quality: seasonQuality(follow, season),
    waiting: waiting
      ? {
          season: waiting.season,
          episode: waiting.episode,
          ...target,
          until: waiting.waitUntil!.toISOString(),
        }
      : null,
    counts: {
      downloading: count('downloading'),
      noSpace: count('no_space'),
      missing: count('missing'),
      searching: count('searching'),
    },
  }
}
