// Только поля ответов TMDB, которые читает маппинг: https://developer.themoviedb.org/reference

export interface TmdbMultiResult {
  id: number
  media_type: 'movie' | 'tv' | 'person'
  title?: string
  original_title?: string
  release_date?: string
  name?: string
  original_name?: string
  first_air_date?: string
  poster_path?: string | null
}

export interface TmdbSearchResponse {
  results: TmdbMultiResult[]
}

/** Элемент списка: в trending/all есть media_type, в списках фильмов и сериалов — нет. */
export type TmdbListResult = Omit<TmdbMultiResult, 'media_type'> & {
  media_type?: TmdbMultiResult['media_type']
}

export interface TmdbListResponse {
  results: TmdbListResult[]
}

export interface TmdbImage {
  file_path: string
  // null — картинка без текста, годится для любого языка
  iso_639_1: string | null
  vote_average: number
}

interface TmdbDetailsBase {
  id: number
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  genres: { id: number, name: string }[]
  vote_average: number
  vote_count: number
  // Есть, если детали запрошены с append_to_response=images
  images?: { logos: TmdbImage[] }
}

export interface TmdbMovie extends TmdbDetailsBase {
  title: string
  original_title: string
  release_date: string
  runtime: number | null
}

export interface TmdbTvSeason {
  season_number: number
  name: string
  episode_count: number
  air_date: string | null
}

export interface TmdbTv extends TmdbDetailsBase {
  name: string
  original_name: string
  first_air_date: string
  seasons: TmdbTvSeason[]
}
