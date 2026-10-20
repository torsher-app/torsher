import { z } from 'zod'

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

export const card = z
  .object({
    // Непрозрачный для клиентов ID каталога: клиент его не разбирает
    id: z.string(),
    kind: z.enum(['movie', 'series']),
    title: z.string(),
    originalTitle: z.string(),
    year: z.number().int().optional(),
    // Относительный URL прокси картинок: /img/<size>/<file>
    poster: z.string().optional(),
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
    rating: z.number().optional(),
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

export const titleExtras = z
  .object({
    cast: z.array(person),
    similar: z.array(card),
    // Другие названия тайтла: по ним его узнают и ищут раздачи
    aka: z.array(z.string()),
    directors: z.array(z.string()),
  })
  .meta({ id: 'titleExtras' })

export const catalogSearchResponse = z
  .object({
    items: z.array(card),
  })
  .meta({ id: 'catalogSearchResponse' })

export const catalogTrendingResponse = z
  .object({
    items: z.array(card),
  })
  .meta({ id: 'catalogTrendingResponse' })

export type Card = z.output<typeof card>
export type TitleDetails = z.output<typeof titleDetails>
export type TitleSeason = z.output<typeof titleSeason>
export type Episode = z.output<typeof episode>
export type SeasonDetails = z.output<typeof seasonDetails>
export type Person = z.output<typeof person>
export type TitleExtras = z.output<typeof titleExtras>
