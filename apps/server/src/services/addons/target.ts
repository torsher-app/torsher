import type { HttpAddonType } from './index.ts'
import { lookupImdbId } from '../ratings/externalIds.ts'
import { tmdbEpisodeExists, TmdbError } from '../tmdb/index.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { AddonError } from './index.ts'

export const IMDB_ID = /^tt\d{7,12}$/
export const ADDON_CONCURRENCY = 4
export const ADDON_QUERY_MS = 5000

export interface AddonTarget {
  titleId: string
  type: HttpAddonType
  videoId: string
  season?: number
  episode?: number
}

interface EpisodeTarget {
  season: number
  episode: number
}

export function boundedAddonResult<T>(
  pending: Promise<T>,
  signal: AbortSignal,
) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new AddonError('timeout'))
    if (signal.aborted)
      abort()
    else signal.addEventListener('abort', abort, { once: true })
    void pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function addonTarget(
  titleId: string,
  episode: EpisodeTarget | undefined,
  language: string,
  signal: AbortSignal,
): Promise<AddonTarget | undefined> {
  const ref = parseCatalogId(titleId)
  if (!ref || !Number.isSafeInteger(ref.tmdbId) || ref.tmdbId < 1)
    return undefined
  if (ref.type === 'movie' ? episode !== undefined : episode === undefined)
    return undefined
  if (
    episode
    && (!Number.isSafeInteger(episode.season)
      || episode.season < 0
      || !Number.isSafeInteger(episode.episode)
      || episode.episode < 1)
  ) {
    return undefined
  }

  try {
    signal.throwIfAborted()
    const imdb = await boundedAddonResult(lookupImdbId(ref), signal)
    if (!imdb || !IMDB_ID.test(imdb))
      return undefined
    if (!episode)
      return { titleId, type: 'movie', videoId: imdb }
    signal.throwIfAborted()
    if (
      !(await boundedAddonResult(
        tmdbEpisodeExists(
          ref.tmdbId,
          episode.season,
          episode.episode,
          language,
        ),
        signal,
      ))
    ) {
      return undefined
    }

    return {
      titleId,
      type: 'series',
      videoId: `${imdb}:${episode.season}:${episode.episode}`,
      ...episode,
    }
  }
  catch (error) {
    if (error instanceof TmdbError && error.kind === 'not_found')
      return undefined
    throw error
  }
}
