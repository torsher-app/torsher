import type { Card } from '../../dto/catalog.ts'
import type { TmdbRef } from '../tmdb/mappers.ts'
import type {
  TmdbEpisode,
  TmdbListResult,
  TmdbMovie,
  TmdbTv,
} from '../tmdb/types.ts'
import {
  listResultToBackdrop,
  listResultToCard,
  parseCatalogId,
} from '../tmdb/mappers.ts'
import {
  recommendationDetails,
  recommendationSeason,
} from '../tmdb/recommendations.ts'

function locales(language: string) {
  return new Set([language, 'en-US', 'ru-RU'])
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function catalogDay(day: string | null | undefined) {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined
}

function fallbackDetails(ref: TmdbRef, language: string) {
  for (const locale of locales(language)) {
    if (locale === language)
      continue
    const value = recommendationDetails(ref, locale).read()
    if (value)
      return value
  }
}

function exactFirstEpisode(
  ref: TmdbRef,
  season: number,
  language: string,
  today: string,
) {
  const variants = new Map<number, TmdbEpisode[]>()
  for (const locale of locales(language)) {
    const raw = recommendationSeason(ref, season, locale).read()
    for (const row of Array.isArray(raw?.episodes) ? raw.episodes : []) {
      if (!positive(row.episode_number))
        continue
      const list = variants.get(row.episode_number) ?? []
      list.push(row)
      variants.set(row.episode_number, list)
    }
  }
  const first = [...variants]
    .sort(([a], [b]) => a - b)
    .find(([, rows]) => {
      const aired = rows.map(row => catalogDay(row.air_date)).find(Boolean)
      return aired !== undefined && aired <= today
    })
  if (first) {
    return {
      episode: { season, episode: first[0] },
      runtimeMinutes: first[1].map(row => row.runtime).find(positive) ?? null,
    }
  }
}

function movieRuntime(
  ref: TmdbRef,
  language: string,
  movie: TmdbMovie | undefined,
) {
  if (positive(movie?.runtime))
    return movie.runtime
  for (const locale of locales(language)) {
    const variant = recommendationDetails(ref, locale).read() as
      TmdbMovie | undefined
    if (positive(variant?.runtime))
      return variant.runtime
  }
  return null
}

export function recommendationMetadata(
  id: string,
  language: string,
  today: string,
  names: Map<number, string>,
  listed?: TmdbListResult,
) {
  const ref = parseCatalogId(id)
  if (!ref)
    return

  const localized = recommendationDetails(ref, language).read()
  const fallback = fallbackDetails(ref, language)
  const details = localized ?? fallback
  // A public list is already localized. Cached facts such as exact runtime
  // can come from another language without replacing its title or artwork.
  const display = [localized, listed, fallback].flatMap(row => row ?? [])
  const cards = display.flatMap(row => listResultToCard(row, ref.type) ?? [])
  const title = cards.find(card => card.title)?.title ?? id
  const card: Card = {
    id,
    kind: ref.type === 'movie' ? 'movie' : 'series',
    title,
    originalTitle:
      cards.find(card => card.originalTitle)?.originalTitle ?? title,
    year: cards.find(card => card.year !== undefined)?.year,
    poster: cards.find(card => card.poster)?.poster,
    ratings: cards.find(card => card.ratings?.length)?.ratings,
  }
  const declared = new Map<number, string>(
    Array.isArray(details?.genres)
      ? details.genres.map(genre => [genre.id, genre.name])
      : [],
  )
  const translated = new Map<number, string>(
    Array.isArray(localized?.genres)
      ? localized.genres.map(genre => [genre.id, genre.name])
      : [],
  )
  const ids = new Set(
    (declared.size ? [...declared.keys()] : (listed?.genre_ids ?? [])).filter(
      positive,
    ),
  )
  const genres = [...ids].flatMap((id) => {
    const name = translated.get(id) || names.get(id) || declared.get(id)
    return name ? [{ id, name }] : []
  })
  const backdrop
    = display
      .map(row => listResultToBackdrop(row, ref.type)?.backdrop)
      .find(Boolean) ?? null
  if (ref.type === 'movie') {
    const movie = details as TmdbMovie | undefined
    const released
      = catalogDay(movie?.release_date) ?? catalogDay(listed?.release_date)
    const unavailable
      = (released !== undefined && released > today)
        || [
          'Rumored',
          'Planned',
          'In Production',
          'Post Production',
          'Canceled',
        ].includes(movie?.status ?? '')
    return {
      ref,
      card,
      backdrop,
      genres,
      genreIds: [...ids],
      episode: null,
      runtimeMinutes: movieRuntime(ref, language, movie),
      franchise: movie?.belongs_to_collection?.id,
      unavailable,
      hasDetails: !!details,
      season: undefined,
    }
  }

  const tv = details as TmdbTv | undefined
  const aired
    = catalogDay(tv?.first_air_date) ?? catalogDay(listed?.first_air_date)
  const regular = (tv?.seasons ?? [])
    .filter(row => positive(row.season_number))
    .sort((a, b) => a.season_number - b.season_number)
  const season
    = regular.find((row) => {
      const air = catalogDay(row.air_date)
      return !air || air <= today
    })?.season_number ?? (tv && !regular.length ? 1 : undefined)
  const unavailable
    = (aired !== undefined && aired > today)
      || (regular.length > 0 && season === undefined)
      || (!aired
        && ['Planned', 'Pilot', 'In Production', 'Canceled'].includes(
          tv?.status ?? '',
        ))
  const exact
    = season === undefined
      ? undefined
      : exactFirstEpisode(ref, season, language, today)
  return {
    ref,
    card,
    backdrop,
    genres,
    genreIds: [...ids],
    episode: exact?.episode ?? null,
    runtimeMinutes: exact?.runtimeMinutes ?? null,
    franchise: undefined,
    unavailable,
    hasDetails: !!details,
    season,
  }
}
