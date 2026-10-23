import { z } from 'zod'
import { card, tmdbLanguage } from './catalog.ts'

// «Брошено» ставится руками, остальное сервер считает по просмотрам
export const titleStatuses = [
  'watching',
  'waiting',
  'watched',
  'dropped',
] as const

export const ownRating = z.number().int().min(1).max(10)

export const titleCollectionRef = z
  .object({
    id: z.string(),
    name: z.string(),
    contains: z.boolean(),
  })
  .meta({ id: 'titleCollectionRef' })

export const titleMine = z
  .object({
    watchlist: z.boolean(),
    favorite: z.boolean(),
    rating: ownRating.nullable(),
    status: z.enum(titleStatuses).nullable(),
    // Подборки, видимые профилю
    collections: z.array(titleCollectionRef),
  })
  .meta({ id: 'titleMine' })

export const titleMineQuery = z.object({
  language: tmdbLanguage,
})

export const updateTitleMine = z
  .object({
    watchlist: z.boolean().optional(),
    favorite: z.boolean().optional(),
    // null — снять оценку
    rating: ownRating.nullable().optional(),
    dropped: z.boolean().optional(),
  })
  .meta({ id: 'updateTitleMine' })

export const mineSectionIds = [
  'continue',
  'watchlist',
  'favorites',
  'collection',
  'watched',
  'dropped',
] as const

export const mineSection = z
  .object({
    id: z.enum(mineSectionIds),
    // Только у подборки: её id и название как есть
    collectionId: z.string().optional(),
    name: z.string().optional(),
    count: z.number().int(),
  })
  .meta({ id: 'mineSection' })

export const mineResponse = z
  .object({
    sections: z.array(mineSection),
  })
  .meta({ id: 'mineResponse' })

export const mineSorts = ['added', 'rating'] as const
export const mineKinds = ['all', 'movie', 'series'] as const
export const mineRatingFilters = [
  'any',
  'rated',
  'unrated',
  '9-10',
  '7-8',
  '5-6',
  '1-4',
] as const

export const MINE_PAGE_SIZE = 40

export const mineItemsQuery = z.object({
  section: z.enum(mineSectionIds),
  collection: z.string().max(100).optional(),
  sort: z.enum(mineSorts).default('added'),
  kind: z.enum(mineKinds).default('all'),
  rating: z.enum(mineRatingFilters).default('any'),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MINE_PAGE_SIZE)
    .default(MINE_PAGE_SIZE),
  language: tmdbLanguage,
})

export const mineItems = z
  .object({
    items: z.array(card),
    // Сколько всего под фильтры; карточки без деталей TMDB в странице пропускаются
    total: z.number().int(),
  })
  .meta({ id: 'mineItems' })

export type TitleStatus = (typeof titleStatuses)[number]
export type MineSectionId = (typeof mineSectionIds)[number]
export type MineSort = (typeof mineSorts)[number]
export type MineKind = (typeof mineKinds)[number]
export type MineRatingFilter = (typeof mineRatingFilters)[number]
export type TitleMine = z.output<typeof titleMine>

export const profileHistoryQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(50),
  language: tmdbLanguage,
})

// Тайтл в истории профиля: что смотрели последним и когда
export const historyEntry = z
  .object({
    title: card,
    // Серия последнего просмотра; у фильма — null
    season: z.number().int().nullable(),
    episode: z.number().int().nullable(),
    position: z.number(),
    duration: z.number().nullable(),
    watched: z.boolean(),
    watchedAt: z.string(),
  })
  .meta({ id: 'historyEntry' })

export const profileHistory = z
  .object({
    items: z.array(historyEntry),
    // Тайтлов в истории; без деталей TMDB тайтл в странице пропускается
    total: z.number().int(),
  })
  .meta({ id: 'profileHistory' })
