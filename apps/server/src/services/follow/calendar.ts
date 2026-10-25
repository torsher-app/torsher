import type { ScheduleItem } from '../../dto/follow.ts'
import type { Follow } from '../../db/schema.ts'
import type { ScheduledEpisode } from './wanted.ts'
import { mapLimit } from '../../utils/mapLimit.ts'
import { DETAILS_CONCURRENCY, summaryOf } from '../mine/cards.ts'
import { profileStates } from '../mine/index.ts'
import { getSeason } from '../tmdb/index.ts'
import { downloadingEpisodes, libraryEpisodes } from './episodes.ts'
import { followsOfProfile, isFollowing } from './index.ts'
import { episodeKey, episodeStates, localDay } from './wanted.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// «Недавние» — за две недели, как окно целевых поисков после выхода серии
const RECENT_DAYS = 14
const UPCOMING_DAYS = 30
const MAX_TITLES = 60
const MAX_ITEMS = 100

/**
 * «Расписание» профиля: серии того, за чем он следит, и сериалов со статусом
 * «Смотрю» и «Ждём новый сезон». Даты — из сезонов последней вышедшей и
 * следующей серии; «Сегодня» — среди ближайших.
 */
export async function profileSchedule(
  profileId: string,
  language: string,
  now = new Date(),
) {
  const today = localDay(now)
  const since = localDay(new Date(now.getTime() - RECENT_DAYS * DAY_MS))
  const until = localDay(new Date(now.getTime() + UPCOMING_DAYS * DAY_MS))
  const followed = new Map(
    followsOfProfile(profileId)
      .filter(follow => follow.kind === 'series' && isFollowing(follow))
      .map(follow => [follow.titleId, follow]),
  )
  const watching = (await profileStates(profileId, language))
    .filter(
      state =>
        state.kind === 'series'
        && (state.status === 'watching' || state.status === 'waiting'),
    )
    .map(state => state.titleId)
  const ids = [...new Set([...followed.keys(), ...watching])].slice(
    0,
    MAX_TITLES,
  )

  const items = (
    await mapLimit(ids, DETAILS_CONCURRENCY, id =>
      titleItems(id, followed.get(id), language, { since, until, today }))
  ).flat()

  return {
    upcoming: items
      .filter(item => item.airDate >= today)
      .sort((a, b) => a.airDate.localeCompare(b.airDate))
      .slice(0, MAX_ITEMS),
    recent: items
      .filter(item => item.airDate < today)
      .sort((a, b) => b.airDate.localeCompare(a.airDate))
      .slice(0, MAX_ITEMS),
  }
}

async function titleItems(
  titleId: string,
  follow: Follow | undefined,
  language: string,
  window: { since: string, until: string, today: string },
): Promise<ScheduleItem[]> {
  const summary = await summaryOf(titleId, language)

  if (!summary)
    return []

  const { last, next } = summary.airing ?? {}

  const seasons = new Set<number>()

  if (last?.airDate && last.airDate >= window.since)
    seasons.add(last.season)

  if (next?.airDate && next.airDate <= window.until)
    seasons.add(next.season)

  const loaded = await Promise.all(
    [...seasons].map(async (number) => {
      try {
        return await getSeason(titleId, number, language)
      }
      catch {
        return undefined
      }
    }),
  )
  const episodes = loaded.flatMap(season =>
    season
      ? season.episodes.flatMap(({ airDate, ...item }) =>
          airDate && airDate >= window.since && airDate <= window.until
            ? [{ ...item, airDate, season: season.number }]
            : [],
        )
      : [],
  )

  if (!episodes.length)
    return []

  const states = follow
    ? new Map(
        episodeStates({
          cursor: { season: follow.startSeason, episode: follow.startEpisode },
          episodes: episodes.map((item): ScheduledEpisode => ({
            season: item.season,
            episode: item.number,
            aired: item.airDate <= window.today,
            airDate: item.airDate,
          })),
          library: libraryEpisodes(titleId),
          downloading: downloadingEpisodes(titleId),
        }).map(item => [episodeKey(item), item.state]),
      )
    : undefined

  return episodes.map(item => ({
    titleId,
    title: summary.details.title,
    season: item.season,
    episode: item.number,
    episodeTitle: item.title || undefined,
    airDate: item.airDate,
    image: item.still ?? summary.details.backdrop,
    followed: !!follow,
    state:
      states?.get(episodeKey({ season: item.season, episode: item.number }))
      ?? null,
  }))
}
