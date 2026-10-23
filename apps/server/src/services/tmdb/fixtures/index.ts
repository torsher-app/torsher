import type {
  TmdbExtras,
  TmdbGenresResponse,
  TmdbImage,
  TmdbListResponse,
  TmdbMovie,
  TmdbPageResponse,
  TmdbPerson,
  TmdbSearchResponse,
  TmdbSeason,
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

// Идущий сериал: вышел первый сезон и 4 серии второго
export const tvOngoing = {
  ...tv,
  id: 2000,
  name: 'Долгая орбита',
  original_name: 'Long Orbit',
  status: 'Returning Series',
  last_air_date: '2026-10-17',
  origin_country: ['US', 'GB'],
  networks: [
    { id: 1, name: 'Канал 1' },
    { id: 2, name: 'Канал 2' },
    { id: 3, name: 'Канал 3' },
    { id: 4, name: 'Канал 4' },
  ],
  created_by: [{ id: 10, name: 'Анна Автор' }],
  last_episode_to_air: { season_number: 2, episode_number: 4 },
  seasons: [
    {
      season_number: 1,
      name: 'Сезон 1',
      episode_count: 8,
      air_date: '2025-01-10',
    },
    {
      season_number: 2,
      name: 'Сезон 2',
      episode_count: 10,
      air_date: '2026-09-26',
    },
    { season_number: 3, name: 'Сезон 3', episode_count: 8, air_date: null },
  ],
  content_ratings: {
    results: [
      { iso_3166_1: 'DE', rating: '16' },
      { iso_3166_1: 'RU', rating: '' },
      { iso_3166_1: 'US', rating: 'TV-MA' },
    ],
  },
} as TmdbTv

export const season = {
  season_number: 2,
  name: 'Сезон 2',
  episodes: [
    {
      episode_number: 1,
      name: 'Пробуждение',
      overview: 'Экипаж просыпается.',
      air_date: '2026-09-26',
      runtime: 52,
      still_path: '/still1.jpg',
    },
    {
      episode_number: 2,
      name: 'Эпизод 2',
      overview: '',
      air_date: '2026-10-03',
      runtime: null,
      still_path: null,
    },
    {
      episode_number: 5,
      name: 'Эпизод 5',
      overview: '',
      air_date: null,
      runtime: null,
      still_path: null,
    },
  ],
} as TmdbSeason

export const seasonEnglish = {
  ...season,
  episodes: season.episodes.map(episode => ({
    ...episode,
    overview: `Episode ${episode.episode_number} in English.`,
  })),
} as TmdbSeason

export const tvExtras = {
  name: 'Долгая орбита',
  original_name: 'Long Orbit',
  overview: 'Лишнее поле: в кэш не попадает',
  aggregate_credits: {
    cast: Array.from({ length: 25 }, (_, index) => ({
      id: 500 + index,
      name: `Актёр ${index + 1}`,
      profile_path: index === 0 ? '/face.jpg' : null,
      // Порядок титров не совпадает с порядком массива
      order: 24 - index,
      roles: [
        { character: 'Эпизод', episode_count: 1 },
        { character: `Герой ${index + 1}`, episode_count: 10 },
      ],
    })),
    crew: [
      { id: 900, name: 'Без должности', jobs: [] },
      {
        id: 901,
        name: 'Сценарист',
        profile_path: null,
        jobs: [
          { job: 'Writer', episode_count: 4 },
          { job: 'Story Editor', episode_count: 10 },
        ],
      },
      {
        id: 902,
        name: 'Главный сценарист',
        profile_path: null,
        jobs: [{ job: 'Writer', episode_count: 12 }],
      },
      {
        id: 903,
        name: 'Режиссёр серии',
        profile_path: '/dir.jpg',
        jobs: [{ job: 'Director', episode_count: 2 }],
      },
      {
        id: 904,
        name: 'Создатель',
        profile_path: '/creator.jpg',
        jobs: [{ job: 'Executive Producer', episode_count: 30 }],
      },
    ],
  },
  created_by: [{ id: 904, name: 'Создатель ', profile_path: '/creator.jpg' }],
  recommendations: {
    results: [
      {
        id: 2000,
        media_type: 'tv',
        name: 'Долгая орбита',
        poster_path: '/self.jpg',
      },
      {
        id: 1396,
        media_type: 'tv',
        name: 'Во все тяжкие',
        original_name: 'Breaking Bad',
        first_air_date: '2008-01-20',
        poster_path: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
      },
      { id: 3000, media_type: 'tv', name: 'Без постера', poster_path: null },
    ],
  },
  alternative_titles: {
    results: [
      { iso_3166_1: 'US', title: 'Long Orbit' },
      { iso_3166_1: 'US', title: 'The Long Orbit' },
      { iso_3166_1: 'RU', title: 'Орбита' },
      { iso_3166_1: 'UA', title: 'орбита' },
      { iso_3166_1: 'RU', title: '  ' },
    ],
  },
  genres: [
    { id: 18, name: 'драма' },
    { id: 10765, name: 'НФ и Фэнтези' },
  ],
  production_companies: [{ id: 11073, name: 'Sony Pictures Television' }],
  networks: [{ id: 49, name: 'HBO ' }],
  keywords: {
    results: [
      { id: 9882, name: 'space' },
      { id: 1, name: '  ' },
    ],
  },
} as unknown as TmdbExtras

export const movieExtras = {
  title: 'Матрица',
  original_title: 'The Matrix',
  genres: [{ id: 878, name: 'фантастика' }],
  production_companies: Array.from({ length: 8 }, (_, index) => ({
    id: 100 + index,
    name: `Студия ${index + 1}`,
  })),
  keywords: {
    keywords: Array.from({ length: 25 }, (_, index) => ({
      id: 1000 + index,
      name: `keyword ${index + 1}`,
    })),
  },
  credits: {
    cast: [
      {
        id: 6384,
        name: 'Keanu Reeves',
        character: 'Neo',
        profile_path: '/keanu.jpg',
        order: 0,
      },
      {
        id: 2975,
        name: 'Laurence Fishburne',
        character: '',
        profile_path: null,
        order: 1,
      },
    ],
    crew: [
      { id: 9339, name: 'Lilly Wachowski', job: 'Director' },
      { id: 9340, name: 'Lana Wachowski', job: 'Director' },
      { id: 9339, name: 'Lilly Wachowski', job: 'Writer' },
      { id: 1, name: 'Composer', job: 'Original Music Composer' },
      { id: 2, name: 'Grip', job: 'Key Grip' },
      { id: 3, name: 'Producer A', job: 'Producer' },
      { id: 4, name: 'Producer B', job: 'Producer' },
      { id: 5, name: 'Producer C', job: 'Producer' },
      {
        id: 6,
        name: 'Producer D',
        job: 'Producer',
        profile_path: '/producer.jpg',
      },
    ],
  },
  recommendations: { results: [] },
  alternative_titles: { titles: [{ iso_3166_1: 'US', title: 'Matrix' }] },
} as TmdbExtras

// Персона из мультипоиска со своими известными тайтлами
export const searchWithPerson = {
  results: [
    {
      id: 603,
      media_type: 'movie',
      title: 'Матрица',
      original_title: 'The Matrix',
      release_date: '1999-03-31',
      poster_path: '/matrix.jpg',
    },
    {
      id: 6384,
      media_type: 'person',
      name: 'Keanu Reeves',
      known_for: [
        {
          id: 603,
          media_type: 'movie',
          title: 'Матрица',
          poster_path: '/matrix.jpg',
        },
        {
          id: 245891,
          media_type: 'movie',
          title: 'Джон Уик',
          poster_path: '/wick.jpg',
        },
      ],
    },
  ],
} as TmdbSearchResponse

// Ответы для поиска раздач: тайтлы вымышленные, ID внешних баз — нули с единицей
export const tvIdentity = {
  name: 'Quiet Harbor',
  original_name: 'Quiet Harbor',
  original_language: 'en',
  first_air_date: '2023-03-01',
  last_air_date: '2025-05-20',
  status: 'Ended',
  external_ids: { imdb_id: 'tt0000001', tvdb_id: 202 },
  alternative_titles: {
    results: [
      { iso_3166_1: 'RU', title: 'Тихая гавань: Сезоны' },
      { iso_3166_1: 'JP', title: '静かな港' },
      { iso_3166_1: 'US', title: 'quiet harbor' },
    ],
  },
  translations: {
    translations: [
      {
        iso_639_1: 'ru',
        iso_3166_1: 'RU',
        data: { name: 'Тихая гавань', overview: 'Длинное описание' },
      },
      { iso_639_1: 'en', iso_3166_1: 'US', data: { name: '' } },
      { iso_639_1: 'de', iso_3166_1: 'DE', data: { name: 'Stiller Hafen' } },
    ],
  },
}

export const movieIdentity = {
  title: 'The Paper Lantern',
  original_title: 'Le Lampion',
  original_language: 'fr',
  release_date: '2021-06-11',
  imdb_id: 'tt0000002',
  external_ids: { imdb_id: 'tt0000002' },
  alternative_titles: { titles: [] },
  translations: {
    translations: [
      { iso_639_1: 'ru', iso_3166_1: 'RU', data: { title: 'Бумажный фонарь' } },
    ],
  },
}

// Персона с фильмографией: роли, повторы, гостевые появления и тайтлы без постера
export const person = {
  id: 525,
  name: 'Кристофер Нолан',
  also_known_as: ['Chris Nolan'],
  profile_path: '/nolan.jpg',
  known_for_department: 'Directing',
  birthday: '1970-07-30',
  deathday: null,
  place_of_birth: ' London, England, UK ',
  biography: '',
  popularity: 8.5,
  combined_credits: {
    cast: [
      {
        id: 29751,
        media_type: 'movie',
        title: 'Документальный',
        poster_path: '/doc.jpg',
        genre_ids: [99],
        character: 'Self',
        popularity: 1.6,
      },
      {
        id: 7000,
        media_type: 'tv',
        name: 'Вечернее шоу',
        poster_path: '/talk.jpg',
        genre_ids: [10767],
        character: '',
        popularity: 30,
      },
      {
        id: 11660,
        media_type: 'movie',
        title: 'Преследование',
        original_title: 'Following',
        release_date: '1998-09-12',
        poster_path: '/following.jpg',
        genre_ids: [80],
        character: 'Прохожий',
        popularity: 2,
      },
    ],
    crew: [
      {
        id: 27205,
        media_type: 'movie',
        title: 'Начало',
        original_title: 'Inception',
        release_date: '2010-07-15',
        poster_path: '/inception.jpg',
        department: 'Directing',
        job: 'Director',
        popularity: 40,
      },
      {
        id: 27205,
        media_type: 'movie',
        title: 'Начало',
        original_title: 'Inception',
        release_date: '2010-07-15',
        poster_path: '/inception.jpg',
        department: 'Writing',
        job: 'Writer',
        popularity: 40,
      },
      {
        id: 157336,
        media_type: 'movie',
        title: 'Интерстеллар',
        original_title: 'Interstellar',
        release_date: '2014-11-05',
        poster_path: '/interstellar.jpg',
        department: 'Directing',
        job: 'Director',
        popularity: 60,
      },
      {
        id: 157336,
        media_type: 'movie',
        title: 'Интерстеллар',
        poster_path: '/interstellar.jpg',
        department: 'Writing',
        job: 'Screenplay',
        popularity: 60,
      },
      {
        id: 49026,
        media_type: 'movie',
        title: 'Тёмный рыцарь: Возрождение легенды',
        poster_path: '/tdkr.jpg',
        department: 'Writing',
        job: 'Story',
        popularity: 20,
      },
      {
        id: 1000,
        media_type: 'movie',
        title: 'Без постера',
        poster_path: null,
        department: 'Directing',
        job: 'Director',
        popularity: 99,
      },
      {
        id: 1001,
        media_type: 'movie',
        title: 'Спасибо',
        poster_path: '/thanks.jpg',
        department: 'Crew',
        job: 'Thanks',
        popularity: 5,
      },
      {
        id: 60625,
        media_type: 'tv',
        name: 'Мир Дикого Запада',
        first_air_date: '2016-10-02',
        poster_path: '/westworld.jpg',
        department: 'Production',
        job: 'Executive Producer',
        popularity: 25,
      },
    ],
  },
} as unknown as TmdbPerson

export const discoverPage = {
  page: 2,
  results: [
    {
      id: 603,
      title: 'Матрица',
      original_title: 'The Matrix',
      release_date: '1999-03-31',
      poster_path: '/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
      vote_average: 8.2,
      vote_count: 26000,
    },
    { id: 604, title: 'Без постера', poster_path: null },
  ],
  total_pages: 1200,
  total_results: 24000,
} as TmdbPageResponse

export const movieGenres = {
  genres: [
    { id: 28, name: 'боевик' },
    { id: 16, name: 'мультфильм' },
    { id: 35, name: 'комедия' },
  ],
} as TmdbGenresResponse
