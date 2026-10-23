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
  vote_average?: number
  vote_count?: number
  // Только у персон: их известные фильмы и сериалы, с media_type
  known_for?: TmdbMultiResult[]
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

interface TmdbNamed {
  id: number
  name: string
}

interface TmdbDetailsBase {
  id: number
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  genres: TmdbNamed[]
  vote_average: number
  vote_count: number
  production_countries?: { iso_3166_1: string }[]
  production_companies?: TmdbNamed[]
  // Есть, если детали запрошены с append_to_response=images
  images?: { logos: TmdbImage[] }
}

export interface TmdbMovie extends TmdbDetailsBase {
  title: string
  original_title: string
  release_date: string
  runtime: number | null
  imdb_id?: string | null
  // append_to_response=release_dates
  release_dates?: {
    results: {
      iso_3166_1: string
      release_dates: { certification: string }[]
    }[]
  }
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
  last_air_date?: string | null
  // Returning Series, Ended, Canceled, In Production, Planned, Pilot
  status?: string
  origin_country?: string[]
  networks?: TmdbNamed[]
  created_by?: TmdbNamed[]
  last_episode_to_air?: {
    season_number: number
    episode_number: number
  } | null
  seasons: TmdbTvSeason[]
  // append_to_response=external_ids
  external_ids?: { imdb_id?: string | null }
  // append_to_response=content_ratings
  content_ratings?: { results: { iso_3166_1: string, rating: string }[] }
}

export interface TmdbEpisode {
  episode_number: number
  name: string
  overview: string
  air_date: string | null
  runtime: number | null
  still_path: string | null
}

export interface TmdbSeason {
  season_number: number
  name: string
  episodes: TmdbEpisode[]
}

export interface TmdbCastMember {
  id: number
  name: string
  profile_path: string | null
  order: number
  // У фильма — одна роль
  character?: string
  // У сериала (aggregate_credits) — роли за все сезоны
  roles?: { character: string, episode_count: number }[]
}

export interface TmdbCrewMember {
  id: number
  name: string
  job?: string
}

export interface TmdbAltTitle {
  iso_3166_1: string
  title: string
}

/**
 * Детали с append_to_response для нижней части карточки, урезанные до того,
 * что читает маппинг: у долгих сериалов список актёров огромный.
 */
export interface TmdbExtras {
  title?: string
  original_title?: string
  name?: string
  original_name?: string
  // credits у фильма, aggregate_credits у сериала
  credits?: { cast: TmdbCastMember[], crew: TmdbCrewMember[] }
  aggregate_credits?: { cast: TmdbCastMember[] }
  recommendations?: TmdbListResponse
  // titles у фильма, results у сериала
  alternative_titles?: { titles?: TmdbAltTitle[], results?: TmdbAltTitle[] }
}
