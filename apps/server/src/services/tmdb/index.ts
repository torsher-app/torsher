import type { Card, TitleDetails } from '../../dto/catalog.ts'
import type { TmdbRef } from './mappers.ts'
import type { TmdbMovie, TmdbSearchResponse, TmdbTv } from './types.ts'
import { withMetaCache } from './cache.ts'
import { tmdbGet } from './client.ts'
import {
  movieToDetails,
  parseCatalogId,
  searchResultToCard,
  tvToDetails,
} from './mappers.ts'

export { fetchTmdbImage, TmdbError } from './client.ts'
export { getHomeRows } from './home.ts'

const HOUR_MS = 60 * 60 * 1000
const SEARCH_TTL_MS = HOUR_MS
const DETAILS_TTL_MS = 7 * 24 * HOUR_MS

// У части тайтлов нет перевода описания: его берём с английской версии
const FALLBACK_LANGUAGE = 'en-US'

export async function searchTitles(
  query: string,
  language: string,
): Promise<Card[]> {
  const normalized = query.trim().toLowerCase()
  const response = await withMetaCache(
    `tmdb:search:${language}:${normalized}`,
    SEARCH_TTL_MS,
    () =>
      tmdbGet<TmdbSearchResponse>('/search/multi', {
        query: normalized,
        language,
        include_adult: 'false',
      }),
  )

  return response.results.flatMap(result => searchResultToCard(result) ?? [])
}

// Логотипы приходят вместе с деталями одним запросом и кэшируются с ними
function detailsParams(language: string) {
  const iso = language.slice(0, 2)
  const imageLanguages = iso === 'en' ? 'en,null' : `${iso},null,en`

  return {
    language,
    append_to_response: 'images',
    include_image_language: imageLanguages,
  }
}

async function loadDetails(ref: TmdbRef, language: string) {
  const key = `tmdb:${ref.type}:${ref.tmdbId}:${language}`
  const params = detailsParams(language)

  if (ref.type === 'movie') {
    const movie = await withMetaCache(key, DETAILS_TTL_MS, () =>
      tmdbGet<TmdbMovie>(`/movie/${ref.tmdbId}`, params))

    return movieToDetails(movie, language)
  }

  const tv = await withMetaCache(key, DETAILS_TTL_MS, () =>
    tmdbGet<TmdbTv>(`/tv/${ref.tmdbId}`, params))

  return tvToDetails(tv, language)
}

/** `undefined` — ID не из каталога; отсутствие тайтла в TMDB — `TmdbError`. */
export async function getTitle(
  id: string,
  language: string,
): Promise<TitleDetails | undefined> {
  const ref = parseCatalogId(id)

  if (!ref)
    return undefined

  const details = await loadDetails(ref, language)

  if (!details.overview && language !== FALLBACK_LANGUAGE) {
    try {
      details.overview = (await loadDetails(ref, FALLBACK_LANGUAGE)).overview
    }
    catch {
      // Без описания карточка всё равно полезна
    }
  }

  return details
}
