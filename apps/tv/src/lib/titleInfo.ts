import type { TitleSeason } from '@torsher/api-client'

/** Годы показа: «2008», «2019–2022» или «2023 — н. в.» (подпись «н. в.» даёт вызывающий). */
export function formatYears(
  value: { year?: number, endYear?: number, ongoing?: boolean },
  ongoingLabel: string,
) {
  if (!value.year)
    return ''

  if (value.ongoing)
    return `${value.year} — ${ongoingLabel}`

  if (value.endYear && value.endYear !== value.year)
    return `${value.year}–${value.endYear}`

  return String(value.year)
}

/** Сезон вышел не целиком: подпись чипа «4 из 8» вместо числа серий. */
export function seasonAired(season: TitleSeason) {
  return season.airedEpisodeCount < season.episodeCount
    ? { aired: season.airedEpisodeCount, total: season.episodeCount }
    : undefined
}

// Дата TMDB YYYY-MM-DD — день по местному времени, а не полночь UTC
export function parseAirDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)

  return new Date(year!, month! - 1, day!)
}

/** Серия ещё не вышла: дата позже сегодняшнего дня. */
export function isUpcoming(airDate: string | undefined, now = new Date()) {
  if (!airDate)
    return false

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  return parseAirDate(airDate).getTime() > today.getTime()
}

function pad(value: number) {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * «пт, 24 окт» на языке интерфейса. Если у браузера нет данных локали
 * (урезанный ICU на ТВ), — числовая дата «24.10».
 */
export function formatAirDate(airDate: string, locale: string) {
  const date = parseAirDate(airDate)

  try {
    if (Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0) {
      return new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(date)
    }
  }
  catch {
    // Ниже — формат без Intl
  }

  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`
}
