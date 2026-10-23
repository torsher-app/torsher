import { z } from 'zod'
import { card, tmdbLanguage } from './catalog.ts'

export const homeModes = ['all', 'movies', 'series'] as const

export const tmdbHomeRowIds = [
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

// Личные ряды профиля: собираются из его списков и просмотров
export const personalHomeRowIds = [
  'newEpisodes',
  'watchlist',
  'collection',
] as const

export const homeRowIds = [...tmdbHomeRowIds, ...personalHomeRowIds] as const

export const homeQuery = z.object({
  mode: z.enum(homeModes).default('all'),
  language: tmdbLanguage,
})

// Серия в ряду 16:9: «S2E5 · Название», кадр серии или бэкдроп тайтла
export const episodeCard = z
  .object({
    titleId: z.string(),
    title: z.string(),
    season: z.number().int(),
    episode: z.number().int(),
    episodeTitle: z.string().optional(),
    image: z.string().optional(),
    // YYYY-MM-DD выхода последней серии
    airDate: z.string().optional(),
    // Сколько вышедших серий после самой дальней просмотренной, включая эту
    newCount: z.number().int(),
  })
  .meta({ id: 'episodeCard' })

export const homeRow = z
  .object({
    id: z.enum(homeRowIds),
    // top10 — постеры с крупными цифрами, posters — обычные постеры,
    // episodes — карточки серий 16:9 в `episodes`, `items` пустой
    kind: z.enum(['top10', 'posters', 'episodes']),
    // Ключ строки интерфейса (home.rows.*): текст выбирает клиент по своему
    // языку; у ряда подборки пустой — название в `name`
    title: z.string(),
    // Ряд подборки: её id (уникальность секций ряда) и название как есть
    ref: z.string().optional(),
    name: z.string().optional(),
    items: z.array(card),
    episodes: z.array(episodeCard).optional(),
  })
  .meta({ id: 'homeRow' })

export const homeResponse = z
  .object({
    rows: z.array(homeRow),
  })
  .meta({ id: 'homeResponse' })

export type HomeMode = (typeof homeModes)[number]
export type HomeRowId = (typeof homeRowIds)[number]
export type TmdbHomeRowId = (typeof tmdbHomeRowIds)[number]
export type HomeRow = z.output<typeof homeRow>
export type EpisodeCard = z.output<typeof episodeCard>
