import type {
  TmdbImage,
  TmdbListResponse,
  TmdbMovie,
  TmdbSearchResponse,
  TmdbTv,
} from '../types.ts'

// Сокращённые реальные ответы TMDB: лишние поля оставлены, чтобы маппинг их игнорировал

export const searchResponse = {
  page: 1,
  results: [
    {
      id: 603,
      media_type: 'movie',
      title: 'Матрица',
      original_title: 'The Matrix',
      release_date: '1999-03-31',
      poster_path: '/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
      popularity: 92.4,
    },
    {
      id: 1396,
      media_type: 'tv',
      name: 'Во все тяжкие',
      original_name: 'Breaking Bad',
      first_air_date: '2008-01-20',
      poster_path: null,
    },
    {
      id: 6384,
      media_type: 'person',
      name: 'Keanu Reeves',
    },
    {
      id: 1000001,
      media_type: 'movie',
      title: 'Анонс',
      original_title: 'Announced',
      release_date: '',
    },
  ],
  total_pages: 1,
  total_results: 4,
} as TmdbSearchResponse

export const movie = {
  id: 603,
  title: 'Матрица',
  original_title: 'The Matrix',
  release_date: '1999-03-31',
  runtime: 136,
  overview: 'Хакер Нео узнаёт правду о реальности.',
  poster_path: '/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
  backdrop_path: '/tlm8UkiQsitc8rSuIAscQDCnP8d.jpg',
  genres: [
    { id: 28, name: 'боевик' },
    { id: 878, name: 'фантастика' },
  ],
  vote_average: 8.217,
  vote_count: 26000,
  tagline: 'Добро пожаловать в реальный мир',
} as TmdbMovie

export const tv = {
  id: 1396,
  name: 'Во все тяжкие',
  original_name: 'Breaking Bad',
  first_air_date: '2008-01-20',
  overview: '',
  poster_path: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
  backdrop_path: null,
  genres: [{ id: 18, name: 'драма' }],
  vote_average: 8.9,
  vote_count: 0,
  seasons: [
    {
      season_number: 0,
      name: 'Спецматериалы',
      episode_count: 9,
      air_date: '2009-02-17',
    },
    {
      season_number: 1,
      name: 'Сезон 1',
      episode_count: 7,
      air_date: '2008-01-20',
    },
    { season_number: 2, name: 'Сезон 2', episode_count: 13, air_date: null },
  ],
} as TmdbTv

// Логотипы из append_to_response=images с include_image_language=ru,null,en
export const logos: TmdbImage[] = [
  { file_path: '/enLogo.png', iso_639_1: 'en', vote_average: 5.8 },
  { file_path: '/neutralLogo.png', iso_639_1: null, vote_average: 3.2 },
  { file_path: '/ruLogoWeak.png', iso_639_1: 'ru', vote_average: 1 },
  { file_path: '/ruLogo.png', iso_639_1: 'ru', vote_average: 5.3 },
  { file_path: '/ruLogo.svg', iso_639_1: 'ru', vote_average: 9 },
]

export const trendingAll = {
  page: 1,
  results: [
    {
      id: 603,
      media_type: 'movie',
      title: 'Матрица',
      original_title: 'The Matrix',
      release_date: '1999-03-31',
      poster_path: '/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
    },
    {
      id: 1396,
      media_type: 'tv',
      name: 'Во все тяжкие',
      original_name: 'Breaking Bad',
      first_air_date: '2008-01-20',
      poster_path: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
    },
    { id: 6384, media_type: 'person', name: 'Keanu Reeves' },
    {
      id: 1000001,
      media_type: 'movie',
      title: 'Анонс',
      original_title: 'Announced',
      release_date: '',
      poster_path: null,
    },
  ],
} as TmdbListResponse

// В списках фильмов и сериалов media_type нет
export const movieList = {
  page: 1,
  results: Array.from({ length: 25 }, (_, index) => ({
    id: 100 + index,
    title: `Фильм ${index + 1}`,
    original_title: `Movie ${index + 1}`,
    release_date: '2024-05-01',
    poster_path: `/movie${index + 1}.jpg`,
  })),
} as TmdbListResponse

export const tvList = {
  page: 1,
  results: [
    {
      id: 1396,
      name: 'Во все тяжкие',
      original_name: 'Breaking Bad',
      first_air_date: '2008-01-20',
      poster_path: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
    },
  ],
} as TmdbListResponse

export const emptyList = { page: 1, results: [] } as TmdbListResponse
