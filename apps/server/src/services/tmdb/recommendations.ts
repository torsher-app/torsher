import type { TmdbMediaType, TmdbRef } from './mappers.ts'
import type {
  TmdbGenresResponse,
  TmdbListResponse,
  TmdbMovie,
  TmdbSeason,
  TmdbTv,
} from './types.ts'
import { readMetaCache } from './cache.ts'
import { titleDetailsCacheKey } from './certification.ts'
import { discoverRequest, GENRES_TTL_MS, listCacheKey } from './discover.ts'
import {
  DETAILS_TTL_MS,
  detailsParams,
  SEASON_TTL_MS,
  seasonKey,
} from './index.ts'
import { capitalized } from './mappers.ts'

export const RECOMMENDATION_LIST_TTL_MS = 86_400_000

/** Only public TMDB inputs are represented in a cache key or transport request. */
export interface PublicRequest<T> {
  key: string
  path: string
  params: Record<string, string>
  ttlMs: number
  read: (fresh?: boolean) => T | undefined
}

function request<T>(
  key: string,
  path: string,
  params: Record<string, string>,
  ttlMs: number,
): PublicRequest<T> {
  return {
    key,
    path,
    params,
    ttlMs,
    read: (fresh) => {
      try {
        return readMetaCache<T>(key, Date.now(), fresh ? ttlMs : undefined)
      }
      catch (error) {
        if (error instanceof SyntaxError)
          return undefined
        throw error
      }
    },
  }
}

export function recommendationList(ref: TmdbRef, language: string) {
  const path = `/${ref.type}/${ref.tmdbId}/recommendations`
  const params = { language, page: '1' }
  return request<TmdbListResponse>(
    listCacheKey(path, params),
    path,
    params,
    RECOMMENDATION_LIST_TTL_MS,
  )
}

export function recommendationDiscover(
  media: TmdbMediaType,
  language: string,
  today: string,
  genre?: number,
  maxMinutes?: number,
) {
  const { path, params: filter } = discoverRequest(
    {
      type: media === 'movie' ? 'movies' : 'series',
      genre: genre === undefined ? undefined : String(genre),
    },
    today,
  )!
  const params: Record<string, string> = {
    ...filter,
    language,
    include_adult: 'false',
    page: '1',
    [media === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte']:
      today,
  }
  if (media === 'movie' && maxMinutes !== undefined)
    params['with_runtime.lte'] = String(maxMinutes)
  return request<TmdbListResponse>(
    listCacheKey(path, params),
    path,
    params,
    RECOMMENDATION_LIST_TTL_MS,
  )
}

export function recommendationDetails(ref: TmdbRef, language: string) {
  return request<TmdbMovie | TmdbTv>(
    titleDetailsCacheKey(ref, language),
    `/${ref.type}/${ref.tmdbId}`,
    detailsParams(ref, language),
    DETAILS_TTL_MS,
  )
}

export function recommendationSeason(
  ref: TmdbRef,
  season: number,
  language: string,
) {
  return request<TmdbSeason>(
    seasonKey(ref.tmdbId, season, language),
    `/tv/${ref.tmdbId}/season/${season}`,
    { language },
    SEASON_TTL_MS,
  )
}

export function recommendationGenres(type: TmdbMediaType, language: string) {
  return request<TmdbGenresResponse>(
    `tmdb:genres:${type}:${language}`,
    `/genre/${type}/list`,
    { language },
    GENRES_TTL_MS,
  )
}

export function cachedRecommendationGenres(language: string) {
  const genres = new Map<number, string>()
  for (const locale of new Set([language, 'en-US', 'ru-RU'])) {
    for (const media of ['movie', 'tv'] as const) {
      const catalog = recommendationGenres(media, locale).read()
      for (const { id, name } of Array.isArray(catalog?.genres)
        ? catalog.genres
        : []) {
        if (
          Number.isSafeInteger(id)
          && id > 0
          && typeof name === 'string'
          && name.trim()
          && !genres.has(id)
        ) {
          genres.set(id, capitalized(name.trim()))
        }
      }
    }
  }
  return genres
}
