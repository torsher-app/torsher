import { z } from 'zod'

// Язык в формате TMDB: en-US, ru-RU
const tmdbLanguage = z
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
    seasons: z.array(titleSeason).optional(),
  })
  .meta({ id: 'titleDetails' })

export const catalogSearchResponse = z
  .object({
    items: z.array(card),
  })
  .meta({ id: 'catalogSearchResponse' })

export type Card = z.output<typeof card>
export type TitleDetails = z.output<typeof titleDetails>
export type TitleSeason = z.output<typeof titleSeason>
