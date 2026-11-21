import type { MineEntryMetadata } from '../../dto/minePersonal.ts'
import type { TmdbSeason } from '../tmdb/types.ts'
import { cachedTitleDetails } from '../tmdb/index.ts'
import { readMetaCache } from '../tmdb/cache.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'

function languages(language: string) {
  return new Set([language, 'en-US', 'ru-RU'])
}

export function localTitleDetails(id: string, language: string) {
  for (const locale of languages(language)) {
    const details = cachedTitleDetails(id, locale)
    if (details)
      return details
  }
}

function localEpisodeDetails(
  id: string,
  season: number,
  episode: number,
  language: string,
) {
  const ref = parseCatalogId(id)
  if (ref?.type !== 'tv')
    return

  let name: string | undefined
  for (const locale of languages(language)) {
    const data = readMetaCache<TmdbSeason>(
      `tmdb:tv:${ref.tmdbId}:season:${season}:${locale}`,
    )
    for (const item of data?.episodes ?? []) {
      if (item.episode_number !== episode)
        continue
      name ??= item.name
      const { runtime } = item
      if (
        typeof runtime === 'number'
        && Number.isInteger(runtime)
        && runtime > 0
      ) {
        return { name, runtime }
      }
    }
  }
  if (name !== undefined)
    return { name, runtime: null }
}

export function localMineMetadata(
  id: string,
  language: string,
  season = 0,
  episode = 0,
): MineEntryMetadata | null {
  const details = localTitleDetails(id, language)
  const exact = episode
    ? localEpisodeDetails(id, season, episode, language)
    : undefined
  if (!details && !exact)
    return null

  return {
    title: details?.title ?? id,
    year: details?.year ?? null,
    poster: details?.poster ?? null,
    episodeTitle: exact?.name ?? null,
    runtimeMinutes:
      exact?.runtime
      ?? (details?.kind === 'movie' ? (details.runtime ?? null) : null),
    genres: details?.genres ?? [],
    countries: details?.countries ?? [],
  }
}
