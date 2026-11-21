import { z } from 'zod'
import { card } from './catalog.ts'
import { minePersonalLanguage } from './minePersonal.ts'

const genreId = z.number().int().positive()
const titleGenre = z.object({ id: genreId, name: z.string() })
const runtime = z.number().int().positive()

export const mineRecommendationsQuery = minePersonalLanguage.extend({
  source: z.enum(['both', 'watchlist', 'new']).default('both'),
  kind: z.enum(['all', 'movie', 'series']).default('all'),
  maxMinutes: z.enum(['any', '90', '120', '150']).default('any'),
  genre: z.coerce.number().int().positive().optional(),
  refresh: z.enum(['visible', 'poll']).default('visible'),
})

const reason = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ratedSeed'),
    titleId: z.string(),
    title: z.string(),
    rating: z.number().int().min(6).max(10),
  }),
  z.object({
    kind: z.literal('favoriteSeed'),
    titleId: z.string(),
    title: z.string(),
  }),
  z.object({
    kind: z.literal('watchedSeed'),
    titleId: z.string(),
    title: z.string(),
  }),
  z.object({ kind: z.literal('watchlistSince'), day: z.iso.date() }),
  z.object({ kind: z.literal('selectedGenre'), genre: titleGenre }),
])

const episode = z.object({
  season: z.number().int().positive(),
  episode: z.number().int().positive(),
})
export const mineRecommendationItem = z
  .object({
    card,
    backdrop: z.string().nullable(),
    genres: z.array(titleGenre),
    runtimeMinutes: runtime.nullable(),
    episode: episode.nullable(),
    reason: reason.nullable(),
  })
  .meta({ id: 'mineRecommendationItem' })

export const mineRecommendationRefresh = z.discriminatedUnion('state', [
  z.object({ state: z.literal('idle') }),
  z.object({ state: z.literal('pending') }),
  z.object({
    state: z.literal('backoff'),
    retryAfterMs: z.number().int().nonnegative(),
  }),
  z.object({
    state: z.literal('unavailable'),
    retryAfterMs: z.number().int().nonnegative(),
    cause: z.enum(['config', 'network']),
  }),
])

export const mineRecommendations = z
  .object({
    profileId: z.string(),
    items: z.array(mineRecommendationItem).max(12),
    genres: z.array(titleGenre),
    hasPersonalSignals: z.boolean(),
    refresh: mineRecommendationRefresh,
  })
  .meta({ id: 'mineRecommendations' })

export const mineRecommendationExclusionsQuery = minePersonalLanguage.extend({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(40).default(40),
})

export const mineRecommendationExclusions = z
  .object({
    profileId: z.string(),
    total: z.number().int().nonnegative(),
    items: z.array(card),
  })
  .meta({ id: 'mineRecommendationExclusions' })

export type MineRecommendationsQuery = z.infer<typeof mineRecommendationsQuery>
export type MineRecommendationItem = z.infer<typeof mineRecommendationItem>
export type MineRecommendationRefresh = z.infer<
  typeof mineRecommendationRefresh
>
export type MineRecommendationExclusionsQuery = z.infer<
  typeof mineRecommendationExclusionsQuery
>
