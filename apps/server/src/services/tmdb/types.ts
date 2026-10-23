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
  backdrop_path?: string | null
  vote_average?: number
  vote_count?: number
  // Только у персон: фото и известные фильмы и сериалы, с media_type
  profile_path?: string | null
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

/** Страница discover: сколько всего страниц и тайтлов под фильтром */
export interface TmdbPageResponse extends TmdbListResponse {
  page: number
  total_pages: number
  total_results: number
}

export interface TmdbImage {
  file_path: string
  // null — картинка без текста, годится для любого языка
  iso_639_1: string | null
  vote_average: number
}

export interface TmdbNamed {
  id: number
  name: string
}

export interface TmdbGenresResponse {
  genres: TmdbNamed[]
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

export interface TmdbEpisodeRef {
  season_number: number
  episode_number: number
  name?: string
  air_date?: string | null
  still_path?: string | null
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
  last_episode_to_air?: TmdbEpisodeRef | null
  next_episode_to_air?: TmdbEpisodeRef | null
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
  profile_path?: string | null
  // У фильма (credits) — одна должность
  job?: string
  // У сериала (aggregate_credits) — должности за все сезоны
  jobs?: { job: string, episode_count: number }[]
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
  aggregate_credits?: { cast: TmdbCastMember[], crew?: TmdbCrewMember[] }
  // Создатели сериала: поле самих деталей
  created_by?: TmdbCrewMember[]
  recommendations?: TmdbListResponse
  // titles у фильма, results у сериала
  alternative_titles?: { titles?: TmdbAltTitle[], results?: TmdbAltTitle[] }
  // Поля самих деталей: чипы карточки
  genres?: TmdbNamed[]
  production_companies?: TmdbNamed[]
  networks?: TmdbNamed[]
  // append_to_response=keywords: keywords у фильма, results у сериала
  keywords?: { keywords?: TmdbNamed[], results?: TmdbNamed[] }
}

/** Тайтл в фильмографии персоны: combined_credits, с media_type */
export interface TmdbPersonCredit extends TmdbMultiResult {
  popularity?: number
  genre_ids?: number[]
  // У роли в касте
  character?: string
  // У сериала — в скольких сериях
  episode_count?: number
  // У должности в группе
  department?: string
  job?: string
}

/** Персона с append_to_response=combined_credits, урезанная до читаемых полей */
export interface TmdbPerson {
  id: number
  name: string
  profile_path: string | null
  known_for_department?: string | null
  birthday?: string | null
  deathday?: string | null
  place_of_birth?: string | null
  biography: string
  combined_credits?: {
    cast: TmdbPersonCredit[]
    crew: TmdbPersonCredit[]
  }
}
