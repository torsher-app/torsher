import type { TmdbMovie, TmdbTv } from './types.ts'
import type { TmdbRef } from './mappers.ts'
import { sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { TMDB_MAX_CACHE_AGE_MS } from './cache.ts'
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

/** A malformed cached certification cannot grant access. */
function ageOnCache(json: string | null) {
  if (json === null)
    return undefined
  try {
    const raw = JSON.parse(json) as TmdbMovie | TmdbTv
    return certificationAge(raw)
  }
  catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError)
      return undefined
    throw error
  }
}

/** Constant-key lookups only: streaming never loads the TMDB catalog graph. */
export function cachedTitleAge(id: string, now = Date.now()) {
  const ref = parseCatalogId(id)
  if (!ref)
    return undefined
  const ru = titleDetailsCacheKey(ref, 'ru-RU')
  const en = titleDetailsCacheKey(ref, 'en-US')
  const cached = getDb().get<{ json: string }>(sql`
    SELECT json FROM meta_cache
    WHERE key IN (${ru}, ${en}) AND fetched_at > ${now - TMDB_MAX_CACHE_AGE_MS}
    ORDER BY key = ${ru} DESC LIMIT 1
  `)
  return ageOnCache(cached?.json ?? null)
}

/** One round trip for a journal scope, with the same precedence as the streaming guard. */
export function cachedTitleAges(ids: string[], now = Date.now()) {
  const keys = ids.flatMap((id) => {
    const ref = parseCatalogId(id)
    return ref
      ? [
          {
            id,
            ru: titleDetailsCacheKey(ref, 'ru-RU'),
            en: titleDetailsCacheKey(ref, 'en-US'),
          },
        ]
      : []
  })
  const from = now - TMDB_MAX_CACHE_AGE_MS
  const entries = getDb().all<{ title_id: string, json: string | null }>(sql`
    SELECT json_extract(k.value, '$.id') AS title_id, COALESCE(ru.json, en.json) AS json
    FROM json_each(${JSON.stringify(keys)}) k
    LEFT JOIN meta_cache ru ON ru.key = json_extract(k.value, '$.ru') AND ru.fetched_at > ${from}
    LEFT JOIN meta_cache en ON en.key = json_extract(k.value, '$.en') AND en.fetched_at > ${from}
  `)
  const ages = new Map<string, number>()
  for (const { title_id, json } of entries) {
    const age = ageOnCache(json)
    if (age !== undefined)
      ages.set(title_id, age)
  }
  return ages
}

/** Only cold classification loads the catalog module; streaming stays synchronous. */
export async function loadTitleAge(id: string) {
  const { titleAge, TmdbError } = await import('./index.ts')
  try {
    return await titleAge(id)
  }
  catch (err) {
    if (
      err instanceof TmdbError
      || err instanceof SyntaxError
      || err instanceof TypeError
    ) {
      return undefined
    }
    throw err
  }
}
