import { localDay } from '../../utils/localDay.ts'

// По дате в поясе сервера серия считается вышедшей
export { localDay }

export interface EpisodeRef {
  season: number
  episode: number
}

/** Серия из расписания TMDB: вышла ли и когда выходит (`YYYY-MM-DD`) */
export interface ScheduledEpisode extends EpisodeRef {
  aired: boolean
  airDate?: string
  /** Без даты в давно вышедшем сезоне: дат TMDB для него не грузим */
  old?: boolean
}

/**
 * Состояние серии «Следить»: `upcoming` — ещё не вышла, `searching` — вышла,
 * кандидатов нет, `waiting` — есть кандидат, ждём свою озвучку или качество
 * до конца окна, `no_space` — захват ждёт места на диске, `missing` — вышла
 * давно, раздач не нашли, `downloading` — качается целиком, `in_library` —
 * лежит в библиотеке, `ready` — режим `notify`: раздача выбрана, серию можно
 * смотреть стримом
 */
export type FollowEpisodeState
  = | 'upcoming'
    | 'searching'
    | 'waiting'
    | 'no_space'
    | 'missing'
    | 'downloading'
    | 'in_library'
    | 'ready'

/** Нужные серии: вышли, а в библиотеке их нет, они не качаются и не выбраны */
export const WANTED_STATES: ReadonlySet<FollowEpisodeState> = new Set([
  'searching',
  'waiting',
  'no_space',
  'missing',
])

export interface EpisodeWithState extends ScheduledEpisode {
  state: FollowEpisodeState
  /** До какого момента ждём лучший кандидат (`waiting`) */
  waitUntil?: Date
}

/** Что автоматика знает о серии сверх расписания (`follow_episodes`) */
export interface EpisodeFacts {
  /** Кандидат уже появлялся: от него идёт окно ожидания */
  seen: Set<string>
  /** Захват автоматики ждёт метаданные magnet */
  grabbing: Set<string>
  /** Режим `notify`: раздача выбрана */
  picked: Set<string>
  noSpace: Set<string>
  waitUntil: Map<string, Date>
}

// Столько дней после выхода серию ищут, потом она «не нашли»
export const MISSING_AFTER_DAYS = 60
const DAY_MS = 24 * 60 * 60 * 1000

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

export function parseEpisodeKey(key: string): EpisodeRef {
  const [season, episode] = key.split(':').map(Number) as [number, number]

  return { season, episode }
}

export function compareEpisodes(a: EpisodeRef, b: EpisodeRef) {
  return a.season - b.season || a.episode - b.episode
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

/** Серия загруженного сезона; `tracker` — её знают только раздачи */
export interface LoadedEpisode {
  number: number
  airDate?: string
  tracker?: boolean
}

/** Серия с трекера вышла: раздача с ней уже есть */
export function isAired(item: LoadedEpisode, today: string) {
  return !!item.tracker || (!!item.airDate && item.airDate <= today)
}

/**
 * Серии сезонов с курсора по TMDB. Загруженный сезон даёт даты, и серия
 * считается вышедшей по `air_date` в поясе сервера, а серия с трекера — сразу;
 * без него — по числу вышедших серий из деталей (с трекером).
 */
export function scheduledEpisodes(
  schedule: SeriesSchedule,
  loaded: Map<number, LoadedEpisode[]>,
  from: EpisodeRef,
  today: string,
): ScheduledEpisode[] {
  return regularSeasons(schedule)
    .filter(season => season.number >= from.season)
    .flatMap((season): ScheduledEpisode[] => {
      const episodes = loaded.get(season.number)

      if (episodes) {
        return episodes.map(item => ({
          season: season.number,
          episode: item.number,
          aired: isAired(item, today),
          airDate: item.airDate,
        }))
      }

      // Сезон без дат — давно вышедший, кроме сезона последней серии
      const old
        = season.airedEpisodeCount >= season.episodeCount
          && season.number !== schedule.last?.season

      return Array.from({ length: season.episodeCount }, (_, index) => ({
        season: season.number,
        episode: index + 1,
        aired: index < season.airedEpisodeCount,
        ...(old && { old }),
      }))
    })
    .filter(item => compareEpisodes(item, from) >= 0)
    .sort(compareEpisodes)
}

/** Вышла давно: дата раньше 60 дней назад, без даты — в старом сезоне */
function isLongAired(item: ScheduledEpisode, now: Date) {
  if (!item.airDate)
    return !!item.old

  return (
    item.airDate
    < localDay(new Date(now.getTime() - MISSING_AFTER_DAYS * DAY_MS))
  )
}

/**
 * Состояние серий с курсора. Библиотека и закачка сильнее расписания: серия
 * с трекера раньше TMDB уже может лежать в библиотеке. «Не нашли» — только
 * после поиска (`searched`) и если кандидатов не было никогда.
 */
export function episodeStates(input: {
  cursor: EpisodeRef
  episodes: ScheduledEpisode[]
  library: Set<string>
  downloading: Set<string>
  facts?: EpisodeFacts
  searched?: boolean
  now?: Date
}): EpisodeWithState[] {
  const { facts, now = new Date() } = input

  return input.episodes
    .filter(item => compareEpisodes(item, input.cursor) >= 0)
    .map((item) => {
      const key = episodeKey(item)
      const waitUntil = facts?.waitUntil.get(key)
      let state: FollowEpisodeState

      if (input.library.has(key)) {
        state = 'in_library'
      }
      else if (input.downloading.has(key) || facts?.grabbing.has(key)) {
        state = 'downloading'
      }
      else if (facts?.picked.has(key)) {
        state = 'ready'
      }
      else if (!item.aired) {
        state = 'upcoming'
      }
      else if (facts?.noSpace.has(key)) {
        state = 'no_space'
      }
      else if (waitUntil) {
        state = 'waiting'
      }
      else if (
        input.searched
        && !facts?.seen.has(key)
        && isLongAired(item, now)
      ) {
        state = 'missing'
      }
      else {
        state = 'searching'
      }

      return state === 'waiting'
        ? { ...item, state, waitUntil }
        : { ...item, state }
    })
}

/** Нужные серии: вышли, а в библиотеке их нет и они не качаются */
export function wantedEpisodes(states: EpisodeWithState[]) {
  return states.filter(item => WANTED_STATES.has(item.state))
}
