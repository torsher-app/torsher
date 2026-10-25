import { nextAired } from '../mine/newEpisodes.ts'

export interface EpisodeRef {
  season: number
  episode: number
}

/** Серия из расписания TMDB: вышла ли и когда выходит (`YYYY-MM-DD`) */
export interface ScheduledEpisode extends EpisodeRef {
  aired: boolean
  airDate?: string
}

/**
 * Состояние серии «Следить»: `upcoming` — ещё не вышла, `searching` — вышла,
 * в библиотеке её нет и она не качается, `downloading` — качается целиком,
 * `in_library` — лежит в библиотеке
 */
export type FollowEpisodeState
  = 'upcoming' | 'searching' | 'downloading' | 'in_library'

export interface EpisodeWithState extends ScheduledEpisode {
  state: FollowEpisodeState
}

/** Сезон из деталей TMDB */
export interface ScheduleSeason {
  number: number
  episodeCount: number
  airedEpisodeCount: number
}

/** Что известно о выходе сериала: сезоны, последняя вышедшая и следующая серии */
export interface SeriesSchedule {
  seasons: ScheduleSeason[]
  last?: EpisodeRef
  next?: EpisodeRef
}

export function episodeKey(ref: EpisodeRef) {
  return `${ref.season}:${ref.episode}`
}

export function compareEpisodes(a: EpisodeRef, b: EpisodeRef) {
  return a.season - b.season || a.episode - b.episode
}

/** Дата в часовом поясе сервера (`TZ`): по ней серия считается вышедшей */
export function localDay(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

function regularSeasons(schedule: SeriesSchedule) {
  return schedule.seasons
    .filter(season => season.number > 0)
    .sort((a, b) => a.number - b.number)
}

/**
 * Первая невышедшая серия: анонсированная, иначе следующая после последней
 * вышедшей, иначе первая серия следующего сезона.
 */
export function firstUnaired(schedule: SeriesSchedule): EpisodeRef {
  if (schedule.next)
    return schedule.next

  const seasons = regularSeasons(schedule)
  const last = schedule.last

  if (!last)
    return { season: seasons[0]?.number ?? 1, episode: 1 }

  const season = seasons.find(item => item.number === last.season)

  return season && last.episode < season.episodeCount
    ? { season: last.season, episode: last.episode + 1 }
    : { season: last.season + 1, episode: 1 }
}

/** Сезон последней вышедшей серии ещё выходит */
function ongoingSeason(schedule: SeriesSchedule) {
  const last = schedule.last

  if (!last)
    return undefined

  const season = schedule.seasons.find(item => item.number === last.season)
  const more
    = schedule.next?.season === last.season
      || (!!season && season.airedEpisodeCount < season.episodeCount)

  return more ? last.season : undefined
}

/** Курсоры для выбора «С какой серии» */
export function cursorOptions(schedule: SeriesSchedule) {
  const seasons = regularSeasons(schedule)

  return {
    new: firstUnaired(schedule),
    season: {
      season: schedule.last?.season ?? seasons[0]?.number ?? 1,
      episode: 1,
    },
    beginning: { season: seasons[0]?.number ?? 1, episode: 1 },
  }
}

/**
 * Курсор при включении: профиль смотрел — следующая непросмотренная вышедшая
 * серия после самой дальней просмотренной; не смотрел, а сезон идёт — начало
 * текущего сезона; иначе только новые серии.
 */
export function defaultCursor(
  schedule: SeriesSchedule,
  watched: Set<string>,
): EpisodeRef {
  if (watched.size) {
    const next = nextAired(regularSeasons(schedule), watched)

    return next
      ? { season: next.season, episode: next.episode }
      : firstUnaired(schedule)
  }

  const ongoing = ongoingSeason(schedule)

  return ongoing === undefined
    ? firstUnaired(schedule)
    : { season: ongoing, episode: 1 }
}

/**
 * Серии сезонов с курсора по TMDB. Загруженный сезон даёт даты, и серия
 * считается вышедшей по `air_date` в поясе сервера; без него — по числу
 * вышедших серий из деталей.
 */
export function scheduledEpisodes(
  schedule: SeriesSchedule,
  loaded: Map<number, { number: number, airDate?: string }[]>,
  from: EpisodeRef,
  today: string,
): ScheduledEpisode[] {
  return regularSeasons(schedule)
    .filter(season => season.number >= from.season)
    .flatMap((season) => {
      const episodes = loaded.get(season.number)

      if (episodes) {
        return episodes.map(item => ({
          season: season.number,
          episode: item.number,
          aired: !!item.airDate && item.airDate <= today,
          airDate: item.airDate,
        }))
      }

      return Array.from({ length: season.episodeCount }, (_, index) => ({
        season: season.number,
        episode: index + 1,
        aired: index < season.airedEpisodeCount,
      }))
    })
    .filter(item => compareEpisodes(item, from) >= 0)
    .sort(compareEpisodes)
}

/**
 * Состояние серий с курсора. Библиотека и закачка сильнее расписания: серия
 * с трекера раньше TMDB уже может лежать в библиотеке.
 */
export function episodeStates(input: {
  cursor: EpisodeRef
  episodes: ScheduledEpisode[]
  library: Set<string>
  downloading: Set<string>
}): EpisodeWithState[] {
  return input.episodes
    .filter(item => compareEpisodes(item, input.cursor) >= 0)
    .map((item) => {
      const key = episodeKey(item)
      const state: FollowEpisodeState = input.library.has(key)
        ? 'in_library'
        : input.downloading.has(key)
          ? 'downloading'
          : item.aired
            ? 'searching'
            : 'upcoming'

      return { ...item, state }
    })
}

/** Нужные серии: вышли, а в библиотеке их нет и они не качаются */
export function wantedEpisodes(states: EpisodeWithState[]) {
  return states.filter(item => item.state === 'searching')
}
