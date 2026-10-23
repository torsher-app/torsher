import type {
  Card,
  CatalogDiscoverQuery,
  CatalogTag,
  CatalogType,
} from '../../dto/catalog.ts'
import type { TmdbMediaType } from './mappers.ts'
import type { TmdbGenresResponse, TmdbPageResponse } from './types.ts'
import { withRatings } from '../ratings/index.ts'
import { withMetaCache } from './cache.ts'
import { tmdbGet } from './client.ts'
import { capitalized, listResultToCard } from './mappers.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const LIST_TTL_MS = DAY_MS
const GENRES_TTL_MS = 7 * DAY_MS

// Дальше TMDB страницы discover не отдаёт
export const MAX_PAGES = 500
// Без порога голосов «от 8» и сортировка по оценке выдают тайтлы с одним голосом
export const MIN_VOTES = 100

const ANIMATION_GENRE = '16'

interface TypeSpec {
  media: TmdbMediaType
  genre?: string
  originalLanguage?: string
}

/**
 * Тип каталога — набор параметров discover. «Аниме» — сериалы-анимация на
 * японском: без жанра в выдачу попадают японские игровые сериалы.
 */
const TYPES: Record<CatalogType, TypeSpec> = {
  movies: { media: 'movie' },
  series: { media: 'tv' },
  cartoons: { media: 'movie', genre: ANIMATION_GENRE },
  cartoonSeries: { media: 'tv', genre: ANIMATION_GENRE },
  anime: { media: 'tv', genre: ANIMATION_GENRE, originalLanguage: 'ja' },
}

export type DiscoverFilter = Partial<
  Omit<CatalogDiscoverQuery, 'type' | 'language' | 'page'>
> & { type: CatalogType }

export interface DiscoverRequest {
  path: string
  media: TmdbMediaType
  // Без языка и страницы: их добавляет вызывающий
  params: Record<string, string>
}

/** YYYY-MM-DD по UTC: граница дат для сортировки «новые» */
export function dateOf(now: Date) {
  return now.toISOString().slice(0, 10)
}

/**
 * Фильтр каталога → запрос TMDB discover. `undefined` — фильтр, которого
 * у этого типа нет: каналы (`network:`) есть только у сериалов.
 */
export function discoverRequest(
  filter: DiscoverFilter,
  today: string,
): DiscoverRequest | undefined {
  const spec = TYPES[filter.type]
  const movie = spec.media === 'movie'
  const date = movie ? 'primary_release_date' : 'first_air_date'
  const params: Record<string, string> = { sort_by: 'popularity.desc' }
  const genres = [spec.genre, filter.genre].filter(
    (genre, index, list): genre is string =>
      !!genre && list.indexOf(genre) === index,
  )
  const language = spec.originalLanguage ?? filter.originalLanguage

  if (genres.length > 0)
    params.with_genres = genres.join(',')

  if (language)
    params.with_original_language = language

  if (filter.country)
    params.with_origin_country = filter.country

  if (filter.keyword)
    params.with_keywords = filter.keyword

  if (filter.studio) {
    const [kind, id] = filter.studio.split(':') as [string, string]

    if (kind === 'network' && movie)
      return undefined

    params[kind === 'network' ? 'with_networks' : 'with_companies'] = id
  }

  if (filter.year !== undefined) {
    params[movie ? 'primary_release_year' : 'first_air_date_year'] = String(
      filter.year,
    )
  }

  if (filter.decade !== undefined) {
    params[`${date}.gte`] = `${filter.decade}-01-01`
    params[`${date}.lte`] = `${filter.decade + 9}-12-31`
  }

  if (filter.rating !== undefined) {
    params['vote_average.gte'] = String(filter.rating)
    params['vote_count.gte'] = String(MIN_VOTES)
  }

  if (filter.sort === 'rating') {
    params.sort_by = 'vote_average.desc'
    params['vote_count.gte'] = String(MIN_VOTES)
  }

  // Без верхней границы первыми шли бы анонсы без постеров и описаний
  if (filter.sort === 'date') {
    const lte = params[`${date}.lte`]

    params.sort_by = `${date}.desc`
    params[`${date}.lte`] = lte && lte < today ? lte : today
  }

  return { path: `/discover/${spec.media}`, media: spec.media, params }
}

function cacheKey(path: string, params: Record<string, string>) {
  const query = new URLSearchParams(params)

  query.sort()

  return `tmdb:list:${path}?${query.toString()}`
}

export interface DiscoverPage {
  items: Card[]
  page: number
  totalPages: number
  total: number
}

/** Страница каталога; `undefined` — фильтр не подходит к типу. */
export async function discoverTitles(
  query: CatalogDiscoverQuery,
  now = new Date(),
): Promise<DiscoverPage | undefined> {
  const request = discoverRequest(query, dateOf(now))

  if (!request)
    return undefined

  const params = {
    ...request.params,
    language: query.language,
    include_adult: 'false',
    page: String(query.page),
  }
  const response = await withMetaCache(
    cacheKey(request.path, params),
    LIST_TTL_MS,
    () => tmdbGet<TmdbPageResponse>(request.path, params),
  )
  const items = response.results.flatMap(
    result => listResultToCard(result, request.media) ?? [],
  )

  return {
    items: await withRatings(items),
    page: response.page,
    totalPages: Math.min(response.total_pages, MAX_PAGES),
    total: response.total_results,
  }
}

/** Жанры типа на языке профиля по алфавиту; жанр, заданный типом, не предлагается. */
export async function getGenres(
  type: CatalogType,
  language: string,
): Promise<CatalogTag[]> {
  const spec = TYPES[type]
  const response = await withMetaCache(
    `tmdb:genres:${spec.media}:${language}`,
    GENRES_TTL_MS,
    () =>
      tmdbGet<TmdbGenresResponse>(`/genre/${spec.media}/list`, { language }),
  )

  return response.genres
    .filter(genre => String(genre.id) !== spec.genre)
    .map(genre => ({
      id: String(genre.id),
      name: capitalized(genre.name.trim()),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, language))
}
