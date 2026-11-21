import type { Card } from '../../dto/catalog.ts'
import type { TmdbRef } from '../tmdb/mappers.ts'
import type { PublicRequest } from '../tmdb/recommendations.ts'
import type {
  TmdbEpisode,
  TmdbListResult,
  TmdbMovie,
  TmdbSeason,
  TmdbTv,
} from '../tmdb/types.ts'
import { readMetaCacheBatch } from '../tmdb/cache.ts'
import { titleDetailsCacheKey } from '../tmdb/certification.ts'
import { seasonKey } from '../tmdb/index.ts'
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

interface MetadataCache {
  details: (ref: TmdbRef, language: string) => TmdbMovie | TmdbTv | undefined
  season: (
    ref: TmdbRef,
    season: number,
    language: string,
  ) => TmdbSeason | undefined
}

const scalarCache: MetadataCache = {
  details: (ref, language) => recommendationDetails(ref, language).read(),
  season: (ref, season, language) =>
    recommendationSeason(ref, season, language).read(),
}

function titleDetails(
  read: MetadataCache['details'],
  ref: TmdbRef,
  language: string,
) {
  const localized = read(ref, language)
  let fallback: TmdbMovie | TmdbTv | undefined
  for (const locale of locales(language)) {
    if (locale === language)
      continue
    fallback = read(ref, locale)
    if (fallback)
      break
  }
  return { localized, fallback }
}

function seriesSeasons(tv: TmdbTv | undefined, today: string) {
  const regular = (tv?.seasons ?? [])
    .filter(row => positive(row.season_number))
    .sort((a, b) => a.season_number - b.season_number)
  const season
    = regular.find((row) => {
      const air = catalogDay(row.air_date)
      return !air || air <= today
    })?.season_number ?? (tv && !regular.length ? 1 : undefined)
  return { season, hasRegularSeasons: regular.length > 0 }
}

export function batchRecommendationMetadata(
  ids: string[],
  language: string,
  today: string,
  now: number,
) {
  const languages = [...locales(language)]
  const refs = ids.flatMap(id => parseCatalogId(id) ?? [])
  const details = readMetaCacheBatch<TmdbMovie | TmdbTv>(
    refs.flatMap(ref =>
      languages.map(locale => titleDetailsCacheKey(ref, locale)),
    ),
    now,
  )
  const readDetails: MetadataCache['details'] = (ref, locale) =>
    details.get(titleDetailsCacheKey(ref, locale))?.value
  const seasons = readMetaCacheBatch<TmdbSeason>(
    refs.flatMap((ref) => {
      if (ref.type !== 'tv')
        return []
      const { localized, fallback } = titleDetails(readDetails, ref, language)
      const { season } = seriesSeasons(
        (localized ?? fallback) as TmdbTv | undefined,
        today,
      )
      return season === undefined
        ? []
        : languages.map(locale => seasonKey(ref.tmdbId, season, locale))
    }),
    now,
  )
  return {
    details: readDetails,
    season: (ref, season, locale) =>
      seasons.get(seasonKey(ref.tmdbId, season, locale))?.value,
    fresh: ({ key, ttlMs }: PublicRequest<unknown>) => {
      const entry = details.get(key) ?? seasons.get(key)
      return !!entry?.value && now - entry.fetchedAt < ttlMs
    },
  } satisfies MetadataCache & {
    fresh: (spec: PublicRequest<unknown>) => boolean
  }
}

function exactFirstEpisode(
  cache: MetadataCache,
  ref: TmdbRef,
  season: number,
  language: string,
  today: string,
) {
  const variants = new Map<number, TmdbEpisode[]>()
  for (const locale of locales(language)) {
    const raw = cache.season(ref, season, locale)
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
  cache: MetadataCache,
  ref: TmdbRef,
  language: string,
  movie: TmdbMovie | undefined,
) {
  if (positive(movie?.runtime))
    return movie.runtime
  for (const locale of locales(language)) {
    if (locale === language)
      continue
    const variant = cache.details(ref, locale) as TmdbMovie | undefined
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
  cache = scalarCache,
) {
  const ref = parseCatalogId(id)
  if (!ref)
    return

  const { localized, fallback } = titleDetails(cache.details, ref, language)
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
      runtimeMinutes: movieRuntime(cache, ref, language, movie),
      franchise: movie?.belongs_to_collection?.id,
      unavailable,
      hasDetails: !!details,
      season: undefined,
    }
  }

  const tv = details as TmdbTv | undefined
  const aired
    = catalogDay(tv?.first_air_date) ?? catalogDay(listed?.first_air_date)
  const { season, hasRegularSeasons } = seriesSeasons(tv, today)
  const unavailable
    = (aired !== undefined && aired > today)
      || (hasRegularSeasons && season === undefined)
      || (!aired
        && ['Planned', 'Pilot', 'In Production', 'Canceled'].includes(
          tv?.status ?? '',
        ))
  const exact
    = season === undefined
      ? undefined
      : exactFirstEpisode(cache, ref, season, language, today)
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
