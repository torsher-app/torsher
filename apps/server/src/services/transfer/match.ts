import type { ImportEntry, ImportKind } from './formats.ts'
import { titleKey } from '@torsher/release-parser'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleExternalIds } from '../../db/schema.ts'
import { rememberImdbId } from '../ratings/externalIds.ts'
import { getTitleIdentity } from '../tmdb/identity.ts'
import { withMetaCache } from '../tmdb/cache.ts'
import { tmdbGet } from '../tmdb/client.ts'
import { findByExternalId } from '../tmdb/find.ts'
import { parseCatalogId, toCatalogId } from '../tmdb/mappers.ts'

const SEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Сколько первых результатов поиска сверять по всем названиям тайтла
const DEEP_CHECK = 3
const YEAR_TOLERANCE = 1

export type MatchResult
  = | { status: 'matched', titleId: string }
    | { status: 'unsure', suggestion: string }
    | { status: 'notFound' }

interface SearchResult {
  id: number
  title?: string
  original_title?: string
  release_date?: string
  name?: string
  original_name?: string
  first_air_date?: string
}

/** Одинаковые строки разных файлов сопоставляются один раз */
export function matchKey(entry: ImportEntry) {
  if (entry.tmdbId && entry.kind)
    return `tmdb:${entry.kind}:${entry.tmdbId}`

  if (entry.imdbId)
    return `imdb:${entry.imdbId}`

  if (entry.tmdbId)
    return `tmdb:${entry.tmdbId}`

  return `title:${entry.kind ?? ''}:${entry.year ?? ''}:${titleKey(entry.title)}:${titleKey(entry.originalTitle ?? '')}`
}

function knownTitleOfImdb(imdbId: string, kind?: ImportKind) {
  const rows = getDb()
    .select()
    .from(titleExternalIds)
    .where(eq(titleExternalIds.imdbId, imdbId))
    .all()
  const row
    = rows.find(
      item => kind && item.type === (kind === 'movie' ? 'movie' : 'tv'),
    ) ?? rows[0]

  return row ? toCatalogId(row.type, row.tmdbId) : undefined
}

async function byImdbId(imdbId: string, kind?: ImportKind) {
  const known = knownTitleOfImdb(imdbId, kind)

  if (known)
    return known

  const found = await findByExternalId(imdbId, 'imdb_id', kind)
  const ref = found && parseCatalogId(found)

  if (ref)
    rememberImdbId(ref, imdbId)

  return found
}

function yearOf(date: string | undefined) {
  const year = Number(date?.slice(0, 4))

  return Number.isInteger(year) && year > 0 ? year : undefined
}

async function search(kind: ImportKind, query: string) {
  const path = kind === 'movie' ? '/search/movie' : '/search/tv'
  const normalized = query.trim().toLowerCase()
  const response = await withMetaCache(
    `tmdb:search:${path}:${normalized}`,
    SEARCH_TTL_MS,
    () =>
      tmdbGet<{ results: SearchResult[] }>(path, {
        query: normalized,
        include_adult: 'false',
      }).then(found => ({
        results: found.results.slice(0, 10).map(item => ({
          id: item.id,
          title: item.title,
          original_title: item.original_title,
          release_date: item.release_date,
          name: item.name,
          original_name: item.original_name,
          first_air_date: item.first_air_date,
        })),
      })),
  )

  return response.results.map(item => ({
    titleId: toCatalogId(kind === 'movie' ? 'movie' : 'tv', item.id),
    names: [
      item.title,
      item.original_title,
      item.name,
      item.original_name,
    ].filter((name): name is string => !!name),
    year: yearOf(item.release_date ?? item.first_air_date),
  }))
}

// Кандидат без даты выхода при известном годе — не совпадение: у TMDB
// так выглядят анонсы и любительские записи с тем же названием
function closeYear(year: number | undefined, wanted: number | undefined) {
  if (wanted === undefined)
    return true

  if (year === undefined)
    return false

  return Math.abs(year - wanted) <= YEAR_TOLERANCE
}

/**
 * По названию и году. Совпадение — ключ названия из файла равен ключу
 * одного из названий кандидата (как у раздач: письменность не важна), и год
 * рядом. Само применяется только единственное такое совпадение с годом.
 */
async function byTitle(entry: ImportEntry): Promise<MatchResult> {
  const wanted = new Set(
    [entry.title, entry.originalTitle]
      .filter((name): name is string => !!name)
      .map(titleKey)
      .filter(Boolean),
  )

  if (wanted.size === 0)
    return { status: 'notFound' }

  const kinds: ImportKind[] = entry.kind ? [entry.kind] : ['movie', 'series']
  const candidates = []

  for (const kind of kinds) {
    for (const name of new Set([entry.title, entry.originalTitle])) {
      if (name)
        candidates.push(...(await search(kind, name)))
    }
  }

  const unique = [
    ...new Map(candidates.map(item => [item.titleId, item])).values(),
  ]
  const exact = new Set<string>()

  for (const [index, candidate] of unique.entries()) {
    if (!closeYear(candidate.year, entry.year))
      continue

    let names = candidate.names

    // Русское или альтернативное название есть только в переводах тайтла
    if (
      index < DEEP_CHECK
      && !names.some(name => wanted.has(titleKey(name)))
    ) {
      const identity = await getTitleIdentity(candidate.titleId).catch(
        () => undefined,
      )

      names = identity?.names.map(item => item.value) ?? names
    }

    if (names.some(name => wanted.has(titleKey(name))))
      exact.add(candidate.titleId)
  }

  if (exact.size === 1 && entry.year !== undefined)
    return { status: 'matched', titleId: [...exact][0]! }

  const suggestion
    = [...exact][0]
      ?? unique.find(item => closeYear(item.year, entry.year))?.titleId

  return suggestion ? { status: 'unsure', suggestion } : { status: 'notFound' }
}

/** Тайтл каталога для строки файла: ID надёжнее названия */
export async function matchEntry(entry: ImportEntry): Promise<MatchResult> {
  if (entry.tmdbId && entry.kind) {
    return {
      status: 'matched',
      titleId: toCatalogId(
        entry.kind === 'movie' ? 'movie' : 'tv',
        entry.tmdbId,
      ),
    }
  }

  if (entry.imdbId) {
    const titleId = await byImdbId(entry.imdbId, entry.kind)

    if (titleId)
      return { status: 'matched', titleId }
  }

  // TMDB ID без вида пишет формат импорта Letterboxd, а там только фильмы
  if (entry.tmdbId)
    return { status: 'matched', titleId: toCatalogId('movie', entry.tmdbId) }

  return byTitle(entry)
}
