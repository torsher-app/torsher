import { z } from 'zod'
import { card, tmdbLanguage } from './catalog.ts'
import { episodeFile } from './titles.ts'

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

export const catalogRow = z
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
  .meta({ id: 'catalogRow' })

/** Тайтл с незаконченным просмотром: что продолжать и с какого места */
export const continueCard = card
  .extend({
    // Кадр серии, у фильма и без кадра — бэкдроп
    image: z.string().optional(),
    // У фильма сезона и серии нет
    season: z.number().nullable(),
    episode: z.number().nullable(),
    episodeTitle: z.string().optional(),
    position: z.number(),
    // Секунды: из прошлого просмотра, иначе из TMDB; null — неизвестно
    duration: z.number().nullable(),
    // Следующая серия после досмотренной, ещё не начатая
    next: z.boolean(),
    // Файл серии в известной раздаче; null — раздачу ещё искать
    file: episodeFile.nullable(),
  })
  .meta({ id: 'continueCard' })

export const continueRow = z
  .object({
    id: z.literal('continue'),
    kind: z.literal('continue'),
    title: z.string(),
    items: z.array(continueCard),
  })
  .meta({ id: 'continueRow' })

export const homeRow = z
  .union([continueRow, catalogRow])
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
export type CatalogRow = z.output<typeof catalogRow>
export type EpisodeCard = z.output<typeof episodeCard>
export type ContinueCard = z.output<typeof continueCard>
export type ContinueRow = z.output<typeof continueRow>
