import { withMetaCache } from './cache.ts'
import { tmdbGet } from './client.ts'
import { toCatalogId } from './mappers.ts'

const FIND_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface FindResponse {
  movie_results?: Array<{ id: number }>
  tv_results?: Array<{ id: number }>
}

export type ExternalSource = 'imdb_id' | 'tvdb_id'

/**
 * Тайтл каталога по внешнему ID через `/find`. Один ID у IMDb бывает и
 * фильмом, и сериалом только по ошибке TMDB: тогда решает `prefer`,
 * без него — фильм.
 */
export async function findByExternalId(
  id: string,
  source: ExternalSource,
  prefer?: 'movie' | 'series',
) {
  const found = await withMetaCache(
    `tmdb:find:${source}:${id}`,
    FIND_TTL_MS,
    () =>
      tmdbGet<FindResponse>(`/find/${id}`, { external_source: source }).then(
        response => ({
          movie_results: response.movie_results
            ?.slice(0, 1)
            .map(item => ({ id: item.id })),
          tv_results: response.tv_results
            ?.slice(0, 1)
            .map(item => ({ id: item.id })),
        }),
      ),
  )
  const movie = found.movie_results?.[0]
  const tv = found.tv_results?.[0]

  if (tv && (prefer === 'series' || !movie))
    return toCatalogId('tv', tv.id)

  return movie ? toCatalogId('movie', movie.id) : undefined
}
