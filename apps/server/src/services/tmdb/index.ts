import type {
  Card,
  SeasonDetails,
  TitleDetails,
  TitleExtras,
} from '../../dto/catalog.ts'
import type { TmdbRef } from './mappers.ts'
import type {
  TmdbExtras,
  TmdbListResponse,
  TmdbMovie,
  TmdbSearchResponse,
  TmdbSeason,
  TmdbTv,
} from './types.ts'
import {
  ratingsOf,
  rememberImdbIdIfChanged,
  withRatings,
} from '../ratings/index.ts'
import { TMDB_PROVIDER } from '../ratings/tmdb.ts'
import { withMetaCache } from './cache.ts'
import { tmdbGet } from './client.ts'
import { getTrendingCards } from './home.ts'
import {
  extrasToDto,
  movieToDetails,
  parseCatalogId,
  searchResultsToCards,
  seasonToDetails,
  similarCards,
  trimExtras,
  tvAiring,
  tvToDetails,
} from './mappers.ts'

export { fetchTmdbImage, TmdbError } from './client.ts'
export { getHomeRows, getTrendingBackdrops } from './home.ts'
export { getTitleIdentity } from './identity.ts'
export type { TitleIdentity, TitleName, TitleNameKind } from './identity.ts'

const HOUR_MS = 60 * 60 * 1000
const SEARCH_TTL_MS = HOUR_MS
const DETAILS_TTL_MS = 7 * 24 * HOUR_MS
// Названия и даты серий идущего сезона меняются чаще деталей
const SEASON_TTL_MS = 24 * HOUR_MS
const TRENDING_LIMIT = 12

/**
 * В кэше лежит сырой ответ: при смене набора append_to_response версия
 * меняется, иначе до конца TTL отдавались бы ответы без новых полей.
 */
const DETAILS_KEY_VERSION = 'v3'

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

  return withRatings(searchResultsToCards(response.results))
}

export async function getTrending(language: string): Promise<Card[]> {
  return withRatings(
    (await getTrendingCards(language)).slice(0, TRENDING_LIMIT),
  )
}

// Логотипы, возрастной рейтинг и IMDb ID приходят вместе с деталями одним
// запросом; у фильма IMDb ID есть в самих деталях
function detailsParams(ref: TmdbRef, language: string) {
  const iso = language.slice(0, 2)
  const imageLanguages = iso === 'en' ? 'en,null' : `${iso},null,en`
  const append
    = ref.type === 'movie' ? 'release_dates' : 'content_ratings,external_ids'

  return {
    language,
    append_to_response: `images,${append}`,
    include_image_language: imageLanguages,
  }
}

interface LoadedTitle {
  details: TitleDetails
  // Только у сериала
  airing?: ReturnType<typeof tvAiring>
  imdbId?: string | null
}

async function loadTitle(ref: TmdbRef, language: string): Promise<LoadedTitle> {
  const key = `tmdb:${ref.type}:${ref.tmdbId}:${language}:${DETAILS_KEY_VERSION}`
  const params = detailsParams(ref, language)

  if (ref.type === 'movie') {
    const movie = await withMetaCache(key, DETAILS_TTL_MS, () =>
      tmdbGet<TmdbMovie>(`/movie/${ref.tmdbId}`, params))

    rememberImdbIdIfChanged(ref, movie.imdb_id)

    return { details: movieToDetails(movie, language), imdbId: movie.imdb_id }
  }

  const tv = await withMetaCache(key, DETAILS_TTL_MS, () =>
    tmdbGet<TmdbTv>(`/tv/${ref.tmdbId}`, params))

  rememberImdbIdIfChanged(ref, tv.external_ids?.imdb_id)

  return {
    details: tvToDetails(tv, language),
    airing: tvAiring(tv),
    imdbId: tv.external_ids?.imdb_id,
  }
}

/**
 * Детали и, у сериала, последняя вышедшая и следующая серии — из той же записи
 * кэша, что и карточка. Описание на запасном языке не добирается: это для
 * списков и статуса, не для первого экрана.
 */
export async function getTitleSummary(id: string, language: string) {
  const ref = parseCatalogId(id)

  return ref ? loadTitle(ref, language) : undefined
}

/** `undefined` — ID не из каталога; отсутствие тайтла в TMDB — `TmdbError`. */
export async function getTitle(
  id: string,
  language: string,
): Promise<TitleDetails | undefined> {
  const ref = parseCatalogId(id)

  if (!ref)
    return undefined

  const { details, imdbId } = await loadTitle(ref, language)

  if (!details.overview && language !== FALLBACK_LANGUAGE) {
    try {
      details.overview = (
        await loadTitle(ref, FALLBACK_LANGUAGE)
      ).details.overview
    }
    catch {
      // Без описания карточка всё равно полезна
    }
  }

  const tmdb = details.ratings.find(
    rating => rating.provider === TMDB_PROVIDER,
  )

  details.ratings = await ratingsOf({
    key: details.id,
    kind: details.kind,
    tmdbId: ref.tmdbId,
    imdbId: imdbId || undefined,
    title: details.title,
    originalTitle: details.originalTitle,
    year: details.year,
    tmdbVote: tmdb && { value: tmdb.value, votes: tmdb.votes },
  })

  return details
}

function loadSeason(tmdbId: number, number: number, language: string) {
  return withMetaCache(
    `tmdb:tv:${tmdbId}:season:${number}:${language}`,
    SEASON_TTL_MS,
    () => tmdbGet<TmdbSeason>(`/tv/${tmdbId}/season/${number}`, { language }),
  )
}

/** `undefined` — ID не сериала из каталога; нет сезона в TMDB — `TmdbError`. */
export async function getSeason(
  id: string,
  number: number,
  language: string,
): Promise<SeasonDetails | undefined> {
  const ref = parseCatalogId(id)

  if (ref?.type !== 'tv')
    return undefined

  const season = seasonToDetails(
    await loadSeason(ref.tmdbId, number, language),
  )
  const missing = season.episodes.some(episode => !episode.overview)

  if (missing && language !== FALLBACK_LANGUAGE) {
    try {
      const fallback = seasonToDetails(
        await loadSeason(ref.tmdbId, number, FALLBACK_LANGUAGE),
      )
      const overviews = new Map(
        fallback.episodes.map(episode => [episode.number, episode.overview]),
      )

      for (const episode of season.episodes)
        episode.overview ||= overviews.get(episode.number) ?? ''
    }
    catch {
      // Серии без описания всё равно полезны
    }
  }

  return season
}

/** `undefined` — ID не из каталога; отсутствие тайтла в TMDB — `TmdbError`. */
export async function getTitleExtras(
  id: string,
  language: string,
): Promise<TitleExtras | undefined> {
  const ref = parseCatalogId(id)

  if (!ref)
    return undefined

  const credits = ref.type === 'movie' ? 'credits' : 'aggregate_credits'
  const extras = await withMetaCache(
    `tmdb:${ref.type}:${ref.tmdbId}:${language}:extras`,
    DETAILS_TTL_MS,
    async () =>
      trimExtras(
        await tmdbGet<TmdbExtras>(`/${ref.type}/${ref.tmdbId}`, {
          language,
          append_to_response: `${credits},recommendations,alternative_titles`,
        }),
      ),
  )
  const dto = extrasToDto(extras, ref, language)

  if (dto.similar.length === 0) {
    try {
      const similar = await withMetaCache(
        `tmdb:${ref.type}:${ref.tmdbId}:${language}:similar`,
        DETAILS_TTL_MS,
        () =>
          tmdbGet<TmdbListResponse>(`/${ref.type}/${ref.tmdbId}/similar`, {
            language,
          }),
      )

      dto.similar = similarCards(similar.results, ref)
    }
    catch {
      // Без «Похожего» карточка всё равно полезна
    }
  }

  await withRatings(dto.similar)

  return dto
}
