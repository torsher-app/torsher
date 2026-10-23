import { z } from 'zod'
import { posterRatingSources } from '../db/schema.ts'

// Язык в формате TMDB: en-US, ru-RU
export const tmdbLanguage = z
  .string()
  .regex(/^[a-z]{2}-[A-Z]{2}$/)
  .default('en-US')

export const catalogSearchQuery = z.object({
  query: z.string().trim().min(1).max(200),
  language: tmdbLanguage,
})

export const catalogTitleParams = z.object({
  id: z.string().min(1).max(100),
})

export const catalogTitleQuery = z.object({
  language: tmdbLanguage,
})

export const catalogSeasonParams = z.object({
  id: z.string().min(1).max(100),
  // Сезон 0 — спецвыпуски: в карточку они не попадают
  number: z.string().regex(/^[1-9]\d{0,2}$/),
})

// Оценка одного поставщика: клиент рисует список, не зная поставщиков
export const titleRating = z
  .object({
    // tmdb, imdb или id плагина
    provider: z.string(),
    // Название бренда: TMDB, IMDb — не переводится
    label: z.string(),
    // Шкала 0–10, один знак после запятой
    value: z.number(),
    votes: z.number().int().optional(),
  })
  .meta({ id: 'titleRating' })
export const posterRating = z
  .object({
    source: z.enum(posterRatingSources),
    // С одним знаком после запятой
    value: z.number(),
  })
  .meta({ id: 'posterRating' })

export const card = z
  .object({
    // Непрозрачный для клиентов ID каталога: клиент его не разбирает
    id: z.string(),
    kind: z.enum(['movie', 'series']),
    title: z.string(),
    originalTitle: z.string(),
    year: z.number().int().optional(),
    // Относительный URL прокси картинок: /api/img/<size>/<file>
    poster: z.string().optional(),
    // В порядке поставщиков; IMDb — если IMDb ID тайтла уже известен
    ratings: z.array(titleRating).optional(),
    // Оценки сервисов для плашки на постере — по настройке профиля, в порядке
    // поставщиков
    posterRatings: z.array(posterRating).optional(),
    // Своя оценка профиля, 1–10; на постере видна всегда
    ownRating: z.number().int().optional(),
  })
  .meta({ id: 'card' })

export const titleSeason = z
  .object({
    number: z.number().int(),
    name: z.string(),
    episodeCount: z.number().int(),
    // Сколько серий уже вышло: у идущего сезона меньше episodeCount
    airedEpisodeCount: z.number().int(),
    year: z.number().int().optional(),
  })
  .meta({ id: 'titleSeason' })

export const titleDetails = card
  .extend({
    overview: z.string(),
    genres: z.array(z.string()),
    // Минуты; только у фильмов
    runtime: z.number().int().optional(),
    // В порядке поставщиков: TMDB, IMDb, плагины
    ratings: z.array(titleRating),
    backdrop: z.string().optional(),
    // PNG логотипа с названием; без него клиент пишет название текстом
    logo: z.string().optional(),
    // Только у сериалов: идёт ли ещё и год последнего эфира у завершённого
    ongoing: z.boolean().optional(),
    endYear: z.number().int().optional(),
    // Возрастной рейтинг в регионе языка запроса: 16+, TV-MA, PG-13
    certification: z.string().optional(),
    // ISO 3166-1: название страны выбирает клиент
    countries: z.array(z.string()),
    // Канал у сериала, студии у фильма
    studios: z.array(z.string()),
    // Создатели сериала; режиссёры фильма — в extras
    creators: z.array(z.string()),
    seasons: z.array(titleSeason).optional(),
  })
  .meta({ id: 'titleDetails' })

export const episode = z
  .object({
    number: z.number().int(),
    title: z.string(),
    overview: z.string(),
    // YYYY-MM-DD; у анонсированной серии даты может не быть
    airDate: z.string().optional(),
    runtime: z.number().int().optional(),
    still: z.string().optional(),
  })
  .meta({ id: 'episode' })

export const seasonDetails = z
  .object({
    number: z.number().int(),
    name: z.string(),
    episodes: z.array(episode),
  })
  .meta({ id: 'seasonDetails' })

export const person = z
  .object({
    // Непрозрачный ID: клиент его не разбирает
    id: z.string(),
    name: z.string(),
    role: z.string().optional(),
    photo: z.string().optional(),
  })
  .meta({ id: 'person' })

// Должности съёмочной группы на карточке тайтла: текст по ключу пишет клиент
export const crewJob = z.enum([
  'director',
  'creator',
  'writer',
  'camera',
  'music',
  'producer',
])

export const crewMember = z
  .object({
    // Непрозрачный ID персоны, как у актёра
    id: z.string(),
    name: z.string(),
    photo: z.string().optional(),
    jobs: z.array(crewJob),
  })
  .meta({ id: 'crewMember' })

// Жанр, студия или тег тайтла: чип карточки ведёт в каталог с этим фильтром
export const catalogTag = z
  .object({
    // Непрозрачное значение фильтра каталога: клиент передаёт его как есть
    id: z.string(),
    name: z.string(),
  })
  .meta({ id: 'catalogTag' })

export const titleExtras = z
  .object({
    cast: z.array(person),
    // Режиссёр (у сериала — создатели), сценарий, оператор, композитор, продюсеры
    crew: z.array(crewMember),
    similar: z.array(card),
    // Другие названия тайтла: по ним его узнают и ищут раздачи
    aka: z.array(z.string()),
    directors: z.array(z.string()),
    // Чипы карточки: жанры, студии фильма или каналы сериала, keywords TMDB
    tags: z.object({
      genres: z.array(catalogTag),
      studios: z.array(catalogTag),
      keywords: z.array(catalogTag),
    }),
  })
  .meta({ id: 'titleExtras' })

export const catalogSearchResponse = z
  .object({
    items: z.array(card),
    // Люди с фото из того же поиска: ряд «Люди» над тайтлами
    people: z.array(person),
  })
  .meta({ id: 'catalogSearchResponse' })

export const catalogTrendingResponse = z
  .object({
    items: z.array(card),
  })
  .meta({ id: 'catalogTrendingResponse' })

// Тип каталога — набор параметров TMDB discover; жанр добавляется к нему через И
export const catalogTypes = [
  'movies',
  'series',
  'cartoons',
  'cartoonSeries',
  'anime',
] as const

export const catalogSorts = ['popularity', 'rating', 'date'] as const

export const catalogDiscoverQuery = z
  .object({
    type: z.enum(catalogTypes).default('movies'),
    // ID жанра из /catalog/genres
    genre: z
      .string()
      .regex(/^\d{1,9}$/)
      .optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    // Первый год десятилетия: 1990 — 1990–1999
    decade: z.coerce
      .number()
      .int()
      .min(1900)
      .max(2090)
      .multipleOf(10)
      .optional(),
    // Оценка TMDB от N
    rating: z.coerce.number().int().min(1).max(9).optional(),
    // ISO 639-1
    originalLanguage: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
    // ISO 3166-1
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    keyword: z
      .string()
      .regex(/^\d{1,9}$/)
      .optional(),
    // Значение из тегов тайтла: company:<id> или network:<id>
    studio: z
      .string()
      .regex(/^(?:company|network):\d{1,9}$/)
      .optional(),
    sort: z.enum(catalogSorts).default('popularity'),
    page: z.coerce.number().int().min(1).max(500).default(1),
    language: tmdbLanguage,
  })
  .refine(query => query.year === undefined || query.decade === undefined, {
    message: 'year and decade are mutually exclusive',
  })

export const catalogDiscoverResponse = z
  .object({
    items: z.array(card),
    page: z.number().int(),
    // Не больше 500: дальше TMDB страницы не отдаёт
    totalPages: z.number().int(),
    total: z.number().int(),
  })
  .meta({ id: 'catalogDiscoverResponse' })

export const catalogGenresQuery = z.object({
  type: z.enum(catalogTypes).default('movies'),
  language: tmdbLanguage,
})

export const catalogGenresResponse = z
  .object({
    items: z.array(catalogTag),
  })
  .meta({ id: 'catalogGenresResponse' })

// Кадр тайтла для заставки витрины
export const backdrop = z
  .object({
    id: z.string(),
    title: z.string(),
    year: z.number().int().optional(),
    backdrop: z.string(),
  })
  .meta({ id: 'backdrop' })

export const catalogBackdropsResponse = z
  .object({
    items: z.array(backdrop),
  })
  .meta({ id: 'catalogBackdropsResponse' })

export type TitleRating = z.output<typeof titleRating>
export const catalogPersonParams = z.object({
  id: z.string().min(1).max(100),
})

// Роль в фильмографии персоны: ряд на странице персоны
export const personRole = z.enum([
  'acting',
  'directing',
  'creator',
  'writing',
  'production',
  'camera',
  'music',
  'editing',
])

export const personCredit = card
  .extend({
    // Персонаж у актёра
    detail: z.string().optional(),
    // У профиля есть прогресс по тайтлу
    watched: z.boolean(),
  })
  .meta({ id: 'personCredit' })

export const personDetails = z
  .object({
    id: z.string(),
    name: z.string(),
    photo: z.string().optional(),
    // Чем персона известна: эта роль идёт первой
    knownFor: personRole.optional(),
    // Даты — YYYY-MM-DD
    birthday: z.string().optional(),
    deathday: z.string().optional(),
    placeOfBirth: z.string().optional(),
    biography: z.string(),
    credits: z.array(
      z.object({
        role: personRole,
        items: z.array(personCredit),
        // Тайтлов в роли всего: в items — только самые популярные
        total: z.number().int(),
      }),
    ),
  })
  .meta({ id: 'personDetails' })

export type Card = z.output<typeof card>
export type Backdrop = z.output<typeof backdrop>
export type TitleDetails = z.output<typeof titleDetails>
export type TitleSeason = z.output<typeof titleSeason>
export type Episode = z.output<typeof episode>
export type SeasonDetails = z.output<typeof seasonDetails>
export type Person = z.output<typeof person>
export type TitleExtras = z.output<typeof titleExtras>
export type CatalogTag = z.output<typeof catalogTag>
export type CatalogType = (typeof catalogTypes)[number]
export type CatalogSort = (typeof catalogSorts)[number]
export type CatalogDiscoverQuery = z.output<typeof catalogDiscoverQuery>
export type CrewJob = z.output<typeof crewJob>
export type CrewMember = z.output<typeof crewMember>
export type PersonRole = z.output<typeof personRole>
export type PersonCredit = z.output<typeof personCredit>
export type PersonDetails = z.output<typeof personDetails>
