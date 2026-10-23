import type { TitleStatus } from '../../dto/mine.ts'
import { isWatched } from '../torrents/playback.ts'

export interface ProgressPoint {
  season: number
  episode: number
  position: number
  duration: number | null
  updatedAt: Date
}

export interface StatusInput {
  kind: 'movie' | 'series'
  progress: ProgressPoint[]
  rating?: number | null
  droppedAt?: Date | null
  // Только у сериала, из деталей TMDB
  seasons?: { number: number, airedEpisodeCount: number }[]
  ongoing?: boolean
  lastAired?: { season: number }
  next?: { season: number }
}

/** Время последнего просмотра тайтла: от него отсчитывается «Брошено» */
export function lastWatchedAt(progress: ProgressPoint[]) {
  let last: Date | undefined

  for (const point of progress) {
    if (point.position > 0 && (!last || point.updatedAt > last))
      last = point.updatedAt
  }

  return last
}

/**
 * «Брошено» действует, пока после отметки тайтл не смотрели снова. Отметка
 * в ту же миллисекунду, что и просмотр, сделана после него — она действует.
 */
export function isDropped(
  droppedAt: Date | null | undefined,
  watchedAt: Date | undefined,
) {
  return !!droppedAt && (!watchedAt || droppedAt >= watchedAt)
}

export function watchedEpisodes(progress: ProgressPoint[]) {
  return new Set(
    progress
      .filter(
        point =>
          point.season > 0 && isWatched(point.position, point.duration),
      )
      .map(point => `${point.season}:${point.episode}`),
  )
}

/**
 * Статус считается по просмотрам, руками ставится только «Брошено». Фильм
 * «Просмотрено», если досмотрен или оценён. Сериал, у которого просмотрено
 * всё вышедшее: завершён — «Просмотрено», идёт текущий сезон — «Смотрю»,
 * иначе — «Ждём новый сезон».
 */
export function titleStatus(input: StatusInput): TitleStatus | null {
  if (isDropped(input.droppedAt, lastWatchedAt(input.progress)))
    return 'dropped'

  if (input.kind === 'movie') {
    const point = input.progress.find(item => item.season === 0)

    if (input.rating || (point && isWatched(point.position, point.duration)))
      return 'watched'

    return point && point.position > 0 ? 'watching' : null
  }

  const started = input.progress.some(
    point => point.season > 0 && point.position > 0,
  )

  if (!started)
    return null

  const watched = watchedEpisodes(input.progress)
  const aired = (input.seasons ?? []).flatMap(season =>
    Array.from(
      { length: season.airedEpisodeCount },
      (_, index) => `${season.number}:${index + 1}`,
    ),
  )

  if (!aired.length || aired.some(key => !watched.has(key)))
    return 'watching'

  if (!input.ongoing)
    return 'watched'

  const airingSeason
    = input.next
      && input.lastAired
      && input.next.season === input.lastAired.season

  return airingSeason ? 'watching' : 'waiting'
}
