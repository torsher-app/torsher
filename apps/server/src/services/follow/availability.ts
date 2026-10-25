import type { Source } from '@torsher/release-parser'
import type { MovieRelease } from '../tmdb/index.ts'
import { logFor } from '../logs/index.ts'
import { SCREEN_COPIES } from '../sources/rank.ts'
import { getMovieReleases } from '../tmdb/index.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// Типы `release_dates` TMDB: цифровой и физический релиз — фильм можно скачать
const RELEASED_TYPES = new Set([4, 5])
// Ограниченный прокат и прокат: без цифровой даты фильм доступен через 90 дней
const THEATRICAL_TYPES = new Set([2, 3])
const AFTER_THEATRICAL_DAYS = 90

/** Начало дня в поясе сервера */
function dayStart(day: string) {
  return new Date(`${day}T00:00:00`)
}

function earliest(releases: MovieRelease[], types: Set<number>) {
  return releases
    .filter(item => types.has(item.type))
    .map(item => item.date)
    .sort()[0]
}

/**
 * Когда фильм можно скачать, как Minimum Availability `Released` у Radarr:
 * цифровой или физический релиз в любой стране, без них — самый ранний прокат
 * + 90 дней, без проката — основная дата выхода + 90 дней. Без дат —
 * `undefined`: фильм недоступен, пока не появится раздача из цифры.
 */
export function availableFrom(
  releases: MovieRelease[],
  releaseDate?: string,
): Date | undefined {
  const released = earliest(releases, RELEASED_TYPES)

  if (released)
    return dayStart(released)

  const theatrical = earliest(releases, THEATRICAL_TYPES) ?? releaseDate

  if (!theatrical || !/^\d{4}-\d{2}-\d{2}$/.test(theatrical))
    return undefined

  return new Date(
    dayStart(theatrical).getTime() + AFTER_THEATRICAL_DAYS * DAY_MS,
  )
}

/**
 * Раздача из цифры или с диска, а не экранная копия: раз она есть, фильм уже
 * вышел. Источник не распознан — не доказательство.
 */
export function isDigitalSource(source: Source | undefined) {
  return !!source && !SCREEN_COPIES.has(source)
}

/** Доступность фильма по деталям TMDB; TMDB не ответил — не знаем */
export async function movieAvailableFrom(titleId: string) {
  try {
    const found = await getMovieReleases(titleId)

    return found && availableFrom(found.releases, found.releaseDate)
  }
  catch (err) {
    logFor('catalog').debug(
      { err, titleId },
      'Follow movie availability is unknown',
    )
    return undefined
  }
}
