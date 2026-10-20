import { z } from 'zod'
import { card, tmdbLanguage } from './catalog.ts'

export const homeModes = ['all', 'movies', 'series'] as const

export const homeRowIds = [
  'trending',
  'trendingMovies',
  'trendingSeries',
  'popularMovies',
  'popularSeries',
  'russianSeries',
  'nowPlaying',
  'onTheAir',
  'topRatedMovies',
  'topRatedSeries',
] as const

export const homeQuery = z.object({
  mode: z.enum(homeModes).default('all'),
  language: tmdbLanguage,
})

export const homeRow = z
  .object({
    id: z.enum(homeRowIds),
    // top10 — постеры с крупными цифрами, posters — обычные постеры
    kind: z.enum(['top10', 'posters']),
    // Ключ строки интерфейса (home.rows.*): текст выбирает клиент по своему языку
    title: z.string(),
    items: z.array(card),
  })
  .meta({ id: 'homeRow' })

export const homeResponse = z
  .object({
    rows: z.array(homeRow),
  })
  .meta({ id: 'homeResponse' })

export type HomeMode = (typeof homeModes)[number]
export type HomeRowId = (typeof homeRowIds)[number]
export type HomeRow = z.output<typeof homeRow>
