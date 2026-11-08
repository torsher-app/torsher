import type { TmdbMovie, TmdbTv } from './types.ts'
import type { TmdbRef } from './mappers.ts'
import { readMetaCache } from './cache.ts'
import { parseCatalogId } from './mappers.ts'

const US: Record<string, number> = {
  'G': 0,
  'TV-G': 0,
  'TV-Y': 0,
  'TV-Y7': 7,
  'PG': 10,
  'TV-PG': 10,
  'PG-13': 13,
  'TV-14': 14,
  'R': 17,
  'TV-MA': 17,
  'NC-17': 18,
}

/** Fixed RU → US policy; an unrecognised nonempty rating fails closed. */
export function certificationAge(raw: TmdbMovie | TmdbTv): number | undefined {
  const entries
    = 'release_dates' in raw
      ? raw.release_dates?.results.flatMap(country =>
          country.release_dates.map(item => ({
            country: country.iso_3166_1,
            code: item.certification,
          })),
        )
      : (raw as TmdbTv).content_ratings?.results.map(item => ({
          country: item.iso_3166_1,
          code: item.rating,
        }))
  const codes = (country: string) =>
    (entries ?? [])
      .filter(item => item.country === country)
      .map(item => item.code.trim())
      .filter(Boolean)
  const ru = codes('RU')
  const selected = ru.length ? ru : codes('US')
  if (!selected.length)
    return undefined
  const ages = selected.map(code =>
    ru.length
      ? /^(?:0|6|12|16|18)\+?$/.test(code)
        ? Number.parseInt(code, 10)
        : undefined
      : US[code.toUpperCase()],
  )
  return ages.includes(undefined) ? undefined : Math.max(...(ages as number[]))
}

/** Version of raw details including release_dates/content_ratings. */
export const DETAILS_KEY_VERSION = 'v3'

export function titleDetailsCacheKey(ref: TmdbRef, language: string) {
  return `tmdb:${ref.type}:${ref.tmdbId}:${language}:${DETAILS_KEY_VERSION}`
}

/** Constant-key lookups only: streaming never loads the TMDB catalog graph. */
export function cachedTitleAge(id: string) {
  const ref = parseCatalogId(id)
  if (!ref)
    return undefined
  const raw
    = readMetaCache<TmdbMovie | TmdbTv>(titleDetailsCacheKey(ref, 'ru-RU'))
      ?? readMetaCache<TmdbMovie | TmdbTv>(titleDetailsCacheKey(ref, 'en-US'))
  return raw ? certificationAge(raw) : undefined
}

/** Only cold classification loads the catalog module; streaming stays synchronous. */
export async function loadTitleAge(id: string) {
  const { titleAge, TmdbError } = await import('./index.ts')
  try {
    return await titleAge(id)
  }
  catch (err) {
    if (err instanceof TmdbError)
      return undefined
    throw err
  }
}
