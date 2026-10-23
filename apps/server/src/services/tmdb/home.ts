import type { HomeMode, HomeRow, HomeRowId } from '../../dto/home.ts'
import type { TmdbMediaType } from './mappers.ts'
import type { TmdbListResponse } from './types.ts'
import { withMetaCache } from './cache.ts'
import { TmdbError, tmdbGet } from './client.ts'
import { listResultToBackdrop, listResultToCard, regionOf } from './mappers.ts'

const LIST_TTL_MS = 24 * 60 * 60 * 1000
const TOP_COUNT = 10
// Одна страница TMDB
const ROW_LIMIT = 20

interface RowSpec {
  kind: HomeRow['kind']
  path: string
  // Списки фильмов и сериалов не пишут media_type у элементов
  type?: TmdbMediaType
  params?: Record<string, string>
  // Список TMDB умеет фильтровать по региону (кинопрокат, даты выхода)
  regional?: boolean
  // Ряд есть только для этого языка
  language?: string
}

// Тренды TMDB не принимают регион: «Топ-10» — общий тренд дня на языке профиля
const ROWS: Record<HomeRowId, RowSpec> = {
  trending: { kind: 'top10', path: '/trending/all/day' },
  trendingMovies: { kind: 'top10', path: '/trending/movie/day', type: 'movie' },
  trendingSeries: { kind: 'top10', path: '/trending/tv/day', type: 'tv' },
  popularMovies: {
    kind: 'posters',
    path: '/movie/popular',
    type: 'movie',
    regional: true,
  },
  popularSeries: { kind: 'posters', path: '/tv/popular', type: 'tv' },
  russianSeries: {
    kind: 'posters',
    path: '/discover/tv',
    type: 'tv',
    params: { with_original_language: 'ru', sort_by: 'popularity.desc' },
    language: 'ru-RU',
  },
  nowPlaying: {
    kind: 'posters',
    path: '/movie/now_playing',
    type: 'movie',
    regional: true,
  },
  onTheAir: { kind: 'posters', path: '/tv/on_the_air', type: 'tv' },
  topRatedMovies: {
    kind: 'posters',
    path: '/movie/top_rated',
    type: 'movie',
    regional: true,
  },
  topRatedSeries: { kind: 'posters', path: '/tv/top_rated', type: 'tv' },
}

// «Фильмы» и «Сериалы» — подмножества главной
const LAYOUT: Record<HomeMode, HomeRowId[]> = {
  all: [
    'trending',
    'popularMovies',
    'popularSeries',
    'russianSeries',
    'nowPlaying',
    'onTheAir',
    'topRatedMovies',
    'topRatedSeries',
  ],
  movies: ['trendingMovies', 'popularMovies', 'nowPlaying', 'topRatedMovies'],
  series: [
    'trendingSeries',
    'popularSeries',
    'russianSeries',
    'onTheAir',
    'topRatedSeries',
  ],
}

async function loadResults(spec: RowSpec, language: string) {
  const params: Record<string, string> = {
    language,
    include_adult: 'false',
    ...spec.params,
  }

  if (spec.regional)
    params.region = regionOf(language)

  const query = new URLSearchParams(params)

  query.sort()

  const response = await withMetaCache(
    `tmdb:list:${spec.path}?${query.toString()}`,
    LIST_TTL_MS,
    () => tmdbGet<TmdbListResponse>(spec.path, params),
  )

  return response.results
}

/** Карточки списка TMDB с постером: без постера тайтл в ряду выглядит дырой. */
async function loadList(spec: RowSpec, language: string) {
  return (await loadResults(spec, language))
    .flatMap(result => listResultToCard(result, spec.type) ?? [])
    .filter(item => item.poster)
}

async function loadRow(
  id: HomeRowId,
  spec: RowSpec,
  language: string,
): Promise<HomeRow> {
  const items = (await loadList(spec, language)).slice(
    0,
    spec.kind === 'top10' ? TOP_COUNT : ROW_LIMIT,
  )

  return { id, kind: spec.kind, title: `home.rows.${id}`, items }
}

/** Тренд дня — тот же список и та же запись кэша, что у «Топ-10» главной. */
export function getTrendingCards(language: string) {
  return loadList(ROWS.trending, language)
}

/** Кадры тренда дня для заставки: тот же список и та же запись кэша. */
export async function getTrendingBackdrops(language: string) {
  return (await loadResults(ROWS.trending, language)).flatMap(
    result => listResultToBackdrop(result, ROWS.trending.type) ?? [],
  )
}

/**
 * Ряды главной из списков TMDB. Пустые ряды и ряды, чей список не загрузился,
 * не отдаются; ошибка — только если не загрузилось ничего.
 */
export async function getHomeRows(
  mode: HomeMode,
  language: string,
): Promise<HomeRow[]> {
  const ids = LAYOUT[mode].filter((id) => {
    const only = ROWS[id].language

    return !only || only === language
  })

  const results = await Promise.allSettled(
    ids.map(id => loadRow(id, ROWS[id], language)),
  )

  const rows: HomeRow[] = []
  const errors: unknown[] = []

  for (const result of results) {
    if (result.status === 'fulfilled')
      rows.push(result.value)
    else errors.push(result.reason)
  }

  // Без токена не загрузится ни один ряд: это настройка, а не сбой сети
  const configError = errors.find(
    err => err instanceof TmdbError && err.kind === 'config',
  )

  if (configError)
    throw configError

  if (rows.length === 0 && errors.length > 0)
    throw errors[0]

  return rows.filter(row => row.items.length > 0)
}
