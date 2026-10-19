import type { Card, TitleDetails, TitleSeason } from '../../dto/catalog.ts'
import type {
  TmdbMovie,
  TmdbMultiResult,
  TmdbTv,
  TmdbTvSeason,
} from './types.ts'

export type TmdbMediaType = 'movie' | 'tv'

export interface TmdbRef {
  type: TmdbMediaType
  tmdbId: number
}

const POSTER_SIZE = 'w342'
const BACKDROP_SIZE = 'w1280'

const CATALOG_ID = /^tmdb:(movie|tv):(\d+)$/

/**
 * Каталожный ID тайтла, который ещё не сохранён в базу. Формат знает только
 * сервер: клиенты передают ID обратно как есть.
 */
export function toCatalogId(type: TmdbMediaType, tmdbId: number) {
  return `tmdb:${type}:${tmdbId}`
}

export function parseCatalogId(id: string): TmdbRef | undefined {
  const match = CATALOG_ID.exec(id)

  if (!match)
    return undefined

  return { type: match[1] as TmdbMediaType, tmdbId: Number(match[2]) }
}

// TMDB отдаёт путь с ведущим слешем: /abc.jpg
function imageUrl(size: string, path: string | null | undefined) {
  return path ? `/img/${size}${path}` : undefined
}

function yearOf(date: string | null | undefined) {
  const year = Number.parseInt(date?.slice(0, 4) ?? '', 10)

  return Number.isFinite(year) ? year : undefined
}

function ratingOf(average: number, count: number) {
  return count > 0 ? Math.round(average * 10) / 10 : undefined
}

/** Персоны из мультипоиска не попадают в каталог. */
export function searchResultToCard(result: TmdbMultiResult): Card | undefined {
  if (result.media_type === 'movie') {
    return {
      id: toCatalogId('movie', result.id),
      kind: 'movie',
      title: result.title ?? '',
      originalTitle: result.original_title ?? result.title ?? '',
      year: yearOf(result.release_date),
      poster: imageUrl(POSTER_SIZE, result.poster_path),
    }
  }

  if (result.media_type === 'tv') {
    return {
      id: toCatalogId('tv', result.id),
      kind: 'series',
      title: result.name ?? '',
      originalTitle: result.original_name ?? result.name ?? '',
      year: yearOf(result.first_air_date),
      poster: imageUrl(POSTER_SIZE, result.poster_path),
    }
  }

  return undefined
}

export function movieToDetails(movie: TmdbMovie): TitleDetails {
  return {
    id: toCatalogId('movie', movie.id),
    kind: 'movie',
    title: movie.title,
    originalTitle: movie.original_title,
    year: yearOf(movie.release_date),
    poster: imageUrl(POSTER_SIZE, movie.poster_path),
    backdrop: imageUrl(BACKDROP_SIZE, movie.backdrop_path),
    overview: movie.overview,
    genres: movie.genres.map(genre => genre.name),
    runtime: movie.runtime || undefined,
    rating: ratingOf(movie.vote_average, movie.vote_count),
  }
}

function toSeason(season: TmdbTvSeason): TitleSeason {
  return {
    number: season.season_number,
    name: season.name,
    episodeCount: season.episode_count,
    year: yearOf(season.air_date),
  }
}

/** Спецвыпуски (сезон 0) в ряд сезонов не попадают. */
export function tvToDetails(tv: TmdbTv): TitleDetails {
  return {
    id: toCatalogId('tv', tv.id),
    kind: 'series',
    title: tv.name,
    originalTitle: tv.original_name,
    year: yearOf(tv.first_air_date),
    poster: imageUrl(POSTER_SIZE, tv.poster_path),
    backdrop: imageUrl(BACKDROP_SIZE, tv.backdrop_path),
    overview: tv.overview,
    genres: tv.genres.map(genre => genre.name),
    rating: ratingOf(tv.vote_average, tv.vote_count),
    seasons: tv.seasons
      .filter(season => season.season_number > 0)
      .map(toSeason),
  }
}
