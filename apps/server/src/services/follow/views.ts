import type { Follow } from '../../db/schema.ts'
import type {
  FollowDetails,
  FollowSummary,
  TitleFollowResponse,
} from '../../dto/follow.ts'
import type { TitleSummary } from '../mine/cards.ts'
import type { EpisodeWithState, FollowEpisodeState } from './wanted.ts'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes } from '../../db/schema.ts'
import { mapLimit } from '../../utils/mapLimit.ts'
import { DETAILS_CONCURRENCY, summaryOf } from '../mine/cards.ts'
import { episodeProgress, isProgressWatched } from '../sources/progress.ts'
import { followEpisodeStates, movieState } from './episodes.ts'
import {
  followById,
  followOf,
  isSubscribed,
  listFollows,
  scheduleOf,
  subscribersOf,
} from './index.ts'
import { unsureCounts } from './panel.ts'
import { requestedSearch } from './search.ts'
import { followStatus } from './status.ts'
import { compareEpisodes, episodeKey, wantedEpisodes } from './wanted.ts'

type NextEpisode = FollowSummary['next']

function startOf(follow: Follow) {
  return { season: follow.startSeason, episode: follow.startEpisode }
}

function rulesView(follow: Follow, next: NextEpisode) {
  return {
    id: follow.id,
    kind: follow.kind,
    state: follow.state,
    start: startOf(follow),
    voiceStudio: follow.voiceStudio,
    voiceStrict: follow.voiceStrict,
    requireRussian: follow.requireRussian,
    waitHours: follow.waitHours,
    qualityPreset: follow.qualityPreset,
    mode: follow.mode,
    next,
  }
}

/** Анонсированная серия TMDB, если она не раньше курсора */
function announcedNext(follow: Follow, summary: TitleSummary | undefined) {
  const next = summary?.airing?.next

  if (
    follow.kind !== 'series'
    || !next
    || compareEpisodes(next, startOf(follow)) < 0
  ) {
    return null
  }

  return { season: next.season, episode: next.episode, airDate: next.airDate }
}

/** Краткое «Следить» для деталей тайтла */
export function titleFollowBrief(titleId: string, profileId: string) {
  const follow = followOf(titleId)

  return follow
    ? {
        id: follow.id,
        state: follow.state,
        subscribed: isSubscribed(follow.id, profileId),
        start: startOf(follow),
        mode: follow.mode,
      }
    : null
}

/** Первая готовая серия, которую профиль не досмотрел */
function readyFor(
  states: EpisodeWithState[],
  profileId: string,
  titleId: string,
) {
  const watched = new Set(
    episodeProgress(profileId, titleId)
      .filter(isProgressWatched)
      .map(episodeKey),
  )
  const ready = states.find(
    item => item.state === 'ready' && !watched.has(episodeKey(item)),
  )

  return ready ? { season: ready.season, episode: ready.episode } : null
}

/** «Следить» тайтла для витрины: правила, подписка, статус */
export async function titleFollowView(
  titleId: string,
  profileId: string,
  canEdit: boolean,
  language: string,
): Promise<TitleFollowResponse> {
  const follow = followOf(titleId)
  const series = titleId.startsWith('tmdb:tv:')
  const summary
    = series || follow ? await summaryOf(titleId, language) : undefined
  const states = follow ? await statesOf(follow, summary, language) : []

  return {
    follow: follow
      ? {
          ...rulesView(follow, announcedNext(follow, summary)),
          subscribed: isSubscribed(follow.id, profileId),
          profileCount: subscribersOf(follow.id).length,
          ...followStatus(follow, states),
          ready: readyFor(states, profileId, titleId),
        }
      : null,
    canEdit,
  }
}

async function statesOf(
  follow: Follow,
  summary: TitleSummary | undefined,
  language: string,
): Promise<EpisodeWithState[]> {
  if (follow.kind === 'movie')
    return movieState(follow, summary?.details.status === 'released')

  return summary
    ? followEpisodeStates(follow, scheduleOf(summary), language)
    : []
}

const COUNT_KEYS: Record<FollowEpisodeState, keyof FollowSummary['counts']> = {
  upcoming: 'upcoming',
  searching: 'searching',
  waiting: 'waiting',
  downloading: 'downloading',
  no_space: 'noSpace',
  missing: 'missing',
  in_library: 'inLibrary',
  ready: 'ready',
}

function countsOf(states: EpisodeWithState[]) {
  const counts: FollowSummary['counts'] = {
    upcoming: 0,
    searching: 0,
    waiting: 0,
    downloading: 0,
    noSpace: 0,
    missing: 0,
    inLibrary: 0,
    ready: 0,
  }

  for (const item of states) {
    counts[COUNT_KEYS[item.state]]++
  }

  return counts
}

function nearestWait(states: EpisodeWithState[]) {
  const times = states
    .map(item => item.waitUntil?.getTime())
    .filter(time => time !== undefined)

  return times.length ? new Date(Math.min(...times)).toISOString() : undefined
}

async function summaryView(
  follow: Follow,
  language: string,
  unsure: Map<string, number>,
): Promise<FollowSummary & { states: EpisodeWithState[] }> {
  const summary = await summaryOf(follow.titleId, language)
  const states = await statesOf(follow, summary, language)
  const upcoming = states.find(item => item.state === 'upcoming')

  return {
    ...rulesView(
      follow,
      follow.kind === 'series' && upcoming
        ? {
            season: upcoming.season,
            episode: upcoming.episode,
            airDate: upcoming.airDate,
          }
        : null,
    ),
    titleId: follow.titleId,
    title: summary?.details.title ?? null,
    poster: summary?.details.poster,
    year: summary?.details.year,
    profiles: subscribersOf(follow.id),
    wanted: wantedEpisodes(states).length,
    counts: countsOf(states),
    unsure: unsure.get(follow.id) ?? 0,
    waitUntil: nearestWait(states),
    createdAt: follow.createdAt.toISOString(),
    updatedAt: follow.updatedAt.toISOString(),
    states,
  }
}

/** Список «Слежу» для панели */
export async function followSummaries(language: string) {
  const unsure = unsureCounts()
  const views = await mapLimit(listFollows(), DETAILS_CONCURRENCY, follow =>
    summaryView(follow, language, unsure))

  return views.map(({ states: _states, ...view }) => view)
}

/** Карточка слежения в панели: серии с курсора и их состояния */
export async function followDetailsOf(
  id: string,
  language: string,
): Promise<FollowDetails | undefined> {
  const follow = followById(id)

  if (!follow)
    return undefined

  const { states, ...view } = await summaryView(
    follow,
    language,
    unsureCounts(follow.id),
  )
  const candidates = new Map(
    getDb()
      .select({
        season: followEpisodes.season,
        episode: followEpisodes.episode,
        decisions: followEpisodes.decisions,
      })
      .from(followEpisodes)
      .where(eq(followEpisodes.followId, follow.id))
      .all()
      .map(row => [episodeKey(row), row.decisions?.length ?? 0]),
  )

  return {
    ...view,
    episodes: states.map(item => ({
      season: item.season,
      episode: item.episode,
      airDate: item.airDate,
      state: item.state,
      waitUntil: item.waitUntil?.toISOString(),
      candidates: candidates.get(episodeKey(item)) ?? 0,
    })),
    lastSearchAt: follow.lastSearchAt?.toISOString() ?? null,
    nextSearchAt: follow.nextSearchAt?.toISOString() ?? null,
    searchRequested: requestedSearch(follow.id) === 'manual',
  }
}
