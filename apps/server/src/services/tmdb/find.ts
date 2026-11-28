import { withMetaCache } from './cache.ts'
import { tmdbGet } from './client.ts'
import { toCatalogId } from './mappers.ts'

const FIND_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface FindResponse {
  movie_results?: Array<{ id: number }>
  tv_results?: Array<{ id: number }>
}

export type ExternalSource = 'imdb_id' | 'tvdb_id'

function validId(id: number) {
  return Number.isSafeInteger(id) && id > 0
}

function compactMatches(matches: Array<{ id: number }> | undefined) {
  return [...new Set(matches?.map(item => item.id).filter(validId))]
    .slice(0, 2)
    .map(id => ({ id }))
}

function findMatches(
  id: string,
  source: ExternalSource,
  allowStale = true,
  signal?: AbortSignal,
  beforeLoad?: () => void,
) {
  return withMetaCache(
    `tmdb:find:v2:${source}:${id}`,
    FIND_TTL_MS,
    () => {
      beforeLoad?.()
      return tmdbGet<FindResponse>(
        `/find/${id}`,
        { external_source: source },
        undefined,
        signal,
      ).then(response => ({
        movie_results: compactMatches(response.movie_results),
        tv_results: compactMatches(response.tv_results),
      }))
    },
    allowStale,
  )
}

/** Up to two distinct TV matches, enough to tell a unique match from ambiguity. */
export async function findTvCandidates(
  id: string,
  source: ExternalSource,
  signal: AbortSignal,
) {
  const found = await findMatches(id, source, false, signal)
  return found.tv_results.map(match => match.id).filter(validId)
}

/**
 * Тайтл каталога по внешнему ID через `/find`. Один ID у IMDb бывает и
 * фильмом, и сериалом только по ошибке TMDB: тогда решает `prefer`,
 * без него — фильм. Строгий режим получает единственное совпадение
 * указанного типа, сохраняя прежний порядок для импорта.
 */
export async function findByExternalId(
  id: string,
  source: ExternalSource,
  prefer?: 'movie' | 'series',
  strict = false,
  options?: {
    requireFresh?: boolean
    signal?: AbortSignal
    beforeLoad?: () => void
  },
) {
  const found = await findMatches(
    id,
    source,
    !options?.requireFresh,
    options?.signal,
    options?.beforeLoad,
  )
  if (strict) {
    if (!prefer)
      return undefined
    const matches = prefer === 'movie' ? found.movie_results : found.tv_results
    const id = matches?.length === 1 ? matches[0]?.id : undefined
    return id && Number.isSafeInteger(id) && id > 0
      ? toCatalogId(prefer === 'movie' ? 'movie' : 'tv', id)
      : undefined
  }

  const movie = found.movie_results?.[0]
  const tv = found.tv_results?.[0]

  if (tv && (prefer === 'series' || !movie))
    return toCatalogId('tv', tv.id)

  return movie ? toCatalogId('movie', movie.id) : undefined
}
