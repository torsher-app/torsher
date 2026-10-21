import type { TmdbRef } from './mappers.ts'
import type { TmdbAltTitle } from './types.ts'
import { withMetaCache } from './cache.ts'
import { tmdbGet } from './client.ts'
import { parseCatalogId } from './mappers.ts'

const IDENTITY_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Языки, на которых названия встречаются в именах раздач
const NAME_LANGUAGES = new Set(['ru', 'en', 'uk'])
const READABLE_TITLE
  = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{N}\p{P}\p{S}\s]+$/u
const ENDED_STATUSES = new Set(['Ended', 'Canceled'])

interface TmdbTranslation {
  iso_639_1: string
  iso_3166_1: string
  data?: { title?: string, name?: string }
}

/** Ответ TMDB для поиска раздач, урезанный до того, что читает маппинг */
export interface TmdbIdentityResponse {
  title?: string
  original_title?: string
  name?: string
  original_name?: string
  original_language?: string
  release_date?: string
  first_air_date?: string
  last_air_date?: string
  status?: string
  imdb_id?: string | null
  external_ids?: { imdb_id?: string | null, tvdb_id?: number | null }
  // titles у фильма, results у сериала
  alternative_titles?: { titles?: TmdbAltTitle[], results?: TmdbAltTitle[] }
  translations?: { translations?: TmdbTranslation[] }
}

export type TitleNameKind = 'official' | 'original' | 'alternative'

export interface TitleName {
  value: string
  /** ISO 639-1; у других названий TMDB язык неизвестен. */
  lang: string | null
  kind: TitleNameKind
}

/** Всё, что нужно поиску раздач о тайтле: ID у внешних баз, годы, названия */
export interface TitleIdentity {
  kind: 'movie' | 'series'
  tmdbId: number
  imdbId?: string
  tvdbId?: number
  year?: number
  /** Год последнего эфира завершённого сериала. */
  endYear?: number
  names: TitleName[]
}

function yearOf(date: string | undefined) {
  const year = Number(date?.slice(0, 4))

  return Number.isInteger(year) && year > 0 ? year : undefined
}

/** Переводы TMDB несут описания на десятках языков: в кэш идут только названия */
export function trimIdentity(
  response: TmdbIdentityResponse,
): TmdbIdentityResponse {
  const translations = (response.translations?.translations ?? [])
    .filter(item => NAME_LANGUAGES.has(item.iso_639_1))
    .map(item => ({
      iso_639_1: item.iso_639_1,
      iso_3166_1: item.iso_3166_1,
      data: { title: item.data?.title, name: item.data?.name },
    }))

  return {
    title: response.title,
    original_title: response.original_title,
    name: response.name,
    original_name: response.original_name,
    original_language: response.original_language,
    release_date: response.release_date,
    first_air_date: response.first_air_date,
    last_air_date: response.last_air_date,
    status: response.status,
    imdb_id: response.imdb_id,
    external_ids: response.external_ids,
    alternative_titles: response.alternative_titles,
    translations: { translations },
  }
}

export function identityOf(
  response: TmdbIdentityResponse,
  ref: TmdbRef,
): TitleIdentity {
  const names: TitleName[] = []
  const seen = new Set<string>()

  function add(
    value: string | undefined,
    lang: string | null,
    kind: TitleNameKind,
  ) {
    const trimmed = value?.trim()
    const key = trimmed?.toLowerCase()

    if (!trimmed || !key || seen.has(key) || !READABLE_TITLE.test(trimmed))
      return

    seen.add(key)
    names.push({ value: trimmed, lang, kind })
  }

  const translations = response.translations?.translations ?? []

  // Русское название первым: по нему ищется большинство русских раздач
  for (const lang of ['ru', 'en', 'uk']) {
    for (const item of translations.filter(t => t.iso_639_1 === lang))
      add(item.data?.title || item.data?.name, lang, 'official')
  }

  add(
    response.original_title ?? response.original_name,
    response.original_language ?? null,
    'original',
  )
  // Название без перевода — английское (запрос идёт на en-US)
  add(response.title ?? response.name, 'en', 'official')

  const alternatives
    = response.alternative_titles?.titles
      ?? response.alternative_titles?.results
      ?? []

  for (const alt of alternatives) add(alt.title, null, 'alternative')

  const isMovie = ref.type === 'movie'
  const imdbId = response.imdb_id ?? response.external_ids?.imdb_id

  return {
    kind: isMovie ? 'movie' : 'series',
    tmdbId: ref.tmdbId,
    imdbId: imdbId || undefined,
    tvdbId: response.external_ids?.tvdb_id || undefined,
    year: yearOf(isMovie ? response.release_date : response.first_air_date),
    endYear:
      !isMovie && response.status && ENDED_STATUSES.has(response.status)
        ? yearOf(response.last_air_date)
        : undefined,
    names,
  }
}

/** `undefined` — ID не из каталога; отсутствие тайтла в TMDB — `TmdbError`. */
export async function getTitleIdentity(
  id: string,
): Promise<TitleIdentity | undefined> {
  const ref = parseCatalogId(id)

  if (!ref)
    return undefined

  const response = await withMetaCache(
    `tmdb:${ref.type}:${ref.tmdbId}:identity`,
    IDENTITY_TTL_MS,
    async () =>
      trimIdentity(
        await tmdbGet<TmdbIdentityResponse>(`/${ref.type}/${ref.tmdbId}`, {
          language: 'en-US',
          append_to_response: 'alternative_titles,translations,external_ids',
        }),
      ),
  )

  return identityOf(response, ref)
}
