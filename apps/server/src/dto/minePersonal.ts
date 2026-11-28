import { z } from 'zod'
import {
  continuationPreferences,
  diaryOrigins,
  mineSections,
  profileLanguages,
  rewatchCycleStates,
} from '../db/schema.ts'
import { tmdbLanguage } from './catalog.ts'
import {
  mineKinds,
  mineRatingFilters,
  mineSorts,
  titleStatuses,
} from './mine.ts'

const profileId = z.string().min(1).max(100)
const titleId = z.string().min(1).max(100)
const count = z.number().int().nonnegative()
const month = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)
const year = z.string().regex(/^\d{4}$/)
const day = z.iso.date()
const instant = z.iso.datetime()
const note = z.string().max(10_000).nullable()
const viewingContext = z.string().max(1000).nullable()

export const minePersonalError = z
  .object({
    kind: z.enum([
      'profileChanged',
      'notFound',
      'conflict',
      'invalidDate',
      'invalidEpisode',
      'catalogUnavailable',
    ]),
  })
  .meta({ id: 'minePersonalError' })

export const mineExpectedProfile = z.object({ expectedProfileId: profileId })
export const mineBootstrapQuery = z.object({
  expectedProfileId: profileId.optional(),
})
export const minePersonalLanguage = mineExpectedProfile.extend({
  language: tmdbLanguage,
})
export const mineTitleParams = z.object({ titleId })
export const mineEntryParams = z.object({ entryId: z.uuid() })
export const mineCycleParams = z.object({ cycleId: z.uuid() })

const mineStart = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('section'), section: z.enum(mineSections) }),
  z.object({
    kind: z.literal('collection'),
    collectionId: z.string().min(1).max(100),
  }),
])

const mineCollectionRef = z.object({
  id: z.string(),
  name: z.string(),
  count: count.nullable(),
})

export const mineBootstrap = z
  .object({
    version: z.literal(1),
    profileId,
    language: z.enum(profileLanguages).nullable(),
    timeZone: z.string(),
    today: day,
    start: mineStart,
    collections: z.array(mineCollectionRef),
    counts: z.object({
      continue: count.nullable(),
      schedule: count.nullable(),
      watched: count.nullable(),
      watchlist: count.nullable(),
      favorites: count.nullable(),
      ratings: count.nullable(),
      dropped: count.nullable(),
    }),
  })
  .meta({ id: 'mineBootstrap' })

export const mineSectionCounts = z
  .object({
    profileId,
    counts: z.object({
      continue: count,
      watched: count,
      watchlist: count,
      favorites: count,
      ratings: count,
      dropped: count,
    }),
    collections: z.array(z.object({ id: z.string(), count })),
  })
  .meta({ id: 'mineSectionCounts' })

export const mineStartInput = mineExpectedProfile.extend({ start: mineStart })
export const mineStartResponse = z
  .object({ start: mineStart })
  .meta({ id: 'mineStartResponse' })

const coordinate = z.number().int().nonnegative()
export const mineTarget = z.object({
  titleId,
  season: coordinate,
  episode: coordinate,
})
const mineCoordinates = mineTarget.pick({ season: true, episode: true })

export const mineDate = z.discriminatedUnion('precision', [
  z.object({ precision: z.literal('instant'), instant }),
  z.object({ precision: z.literal('day'), day }),
  z.object({ precision: z.literal('unknown') }),
])

const mineMetadata = z
  .object({
    title: z.string(),
    year: z.number().int().nullable(),
    poster: z.string().nullable(),
    episodeTitle: z.string().nullable(),
    runtimeMinutes: count.nullable(),
    genres: z.array(z.string()),
    countries: z.array(z.string()),
  })
  .meta({ id: 'mineEntryMetadata' })

export const mineDiaryEntry = mineTarget
  .extend({
    id: z.uuid(),
    kind: z.enum(['movie', 'episode', 'series']),
    date: mineDate,
    calendarDay: day.nullable(),
    origin: z.enum(diaryOrigins),
    sourceUrl: z.string().regex(/^https:\/\/simkl\.com\/(?:movies|tv)\/[1-9]\d*$/).optional(),
    rewatch: z.boolean(),
    note,
    viewingContext,
    cycleId: z.uuid().nullable(),
    createdAt: instant,
    updatedAt: instant,
    metadata: mineMetadata.nullable(),
  })
  .meta({ id: 'mineDiaryEntry' })

export const mineDiaryCreate = minePersonalLanguage.extend({
  requestId: z.uuid(),
  target: mineTarget,
  date: mineDate,
  rewatch: z.boolean().optional(),
  note: note.optional(),
  viewingContext: viewingContext.optional(),
})

export const mineDiaryCreated = z
  .object({
    entry: mineDiaryEntry.nullable(),
  })
  .meta({ id: 'mineDiaryCreated' })

export const mineDiaryPatch = minePersonalLanguage.extend({
  date: mineDate.optional(),
  rewatch: z.boolean().optional(),
  note: note.optional(),
  viewingContext: viewingContext.optional(),
})

export const mineDiaryFilter = z.object({
  kind: z.enum(['all', 'movie', 'episode', 'series']).default('all'),
  rewatch: z.enum(['any', 'only']).default('any'),
  date: z.enum(['any', 'dated', 'unknown']).default('any'),
  day: day.optional(),
  month: month.optional(),
  year: year.optional(),
  genre: z.coerce.number().int().positive().optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
})

export const mineDiaryQuery = minePersonalLanguage
  .extend(mineDiaryFilter.shape)
  .extend({
    cursor: z.string().min(1).max(500).optional(),
    direction: z.enum(['older', 'newer']).default('older'),
    anchorMonth: month.optional(),
    limit: z.coerce.number().int().min(1).max(40).default(40),
  })

export const mineDiaryMonthsQuery = minePersonalLanguage.extend(
  mineDiaryFilter.shape,
)

const mineDiaryMonth = z.object({ month: month.nullable(), count })
export const mineDiaryPage = z
  .object({
    profileId,
    entries: z.array(mineDiaryEntry),
    total: count,
    distinctTitles: count,
    olderCursor: z.string().nullable(),
    newerCursor: z.string().nullable(),
    months: z.array(mineDiaryMonth),
  })
  .meta({ id: 'mineDiaryPage' })

export const mineDiaryMonths = z
  .object({
    months: z.array(mineDiaryMonth),
  })
  .meta({ id: 'mineDiaryMonths' })

export const mineOverviewQuery = minePersonalLanguage.extend({
  period: z.union([day, month, year]).optional(),
})

export const mineOverview = z
  .object({
    profileId,
    timeZone: z.string(),
    today: day,
    period: z.string(),
    totals: z.object({
      movies: count,
      episodes: count,
      series: count,
      rewatch: count,
      days: count,
      distinctMovies: count,
      distinctEpisodes: count,
      runtimeMinutes: count,
      runtimeKnown: count,
      runtimeUnknown: count,
    }),
    days: z.array(z.object({ day, count })),
    recent: z.array(mineDiaryEntry),
    interests: z.object({
      source: z.enum(['diary', 'ratingsAndFavorites']),
      genres: z.array(
        z.object({
          value: z.number().int().positive(),
          label: z.string(),
          count,
        }),
      ),
      countries: z.array(z.object({ value: z.string(), count })),
      titlesWithMetadata: count,
      titles: count,
    }),
    previousMarks: z.object({
      movies: count,
      series: count,
      examples: z.array(
        z.object({ titleId, metadata: mineMetadata.nullable() }),
      ),
    }),
  })
  .meta({ id: 'mineOverview' })

const mineSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('torrent'),
    torrentId: z.string(),
    fileIndex: count,
  }),
  z.object({ kind: z.literal('library'), mediaFileId: z.string() }),
])

const mineCycleResume = mineCoordinates.extend({
  position: z.number().nonnegative(),
  duration: z.number().nonnegative().nullable(),
  source: mineSource.nullable(),
  voiceStudio: z.string().nullable(),
  voiceType: z.string().nullable(),
  next: z.boolean(),
})

export const mineCycle = z
  .object({
    id: z.uuid(),
    titleId,
    state: z.enum(rewatchCycleStates),
    start: mineCoordinates,
    target: mineCoordinates,
    updatedAt: instant,
    resume: mineCycleResume.nullable(),
  })
  .meta({ id: 'mineCycle' })

export const mineCycleCreate = minePersonalLanguage.extend({
  requestId: z.uuid(),
  season: coordinate,
  episode: coordinate.positive(),
})
export const mineCycleChange = minePersonalLanguage.extend({
  action: z.enum(['pause', 'resume', 'end']),
})

export const mineTitleRead = minePersonalLanguage
  .extend({
    season: z.coerce.number().int().nonnegative().optional(),
    episode: z.coerce.number().int().positive().optional(),
  })
  .refine(row => (row.season === undefined) === (row.episode === undefined))

export const mineTitlePatch = minePersonalLanguage.extend({
  note: note.optional(),
  continuation: z.enum(continuationPreferences).optional(),
  notInterested: z.boolean().optional(),
})

export const mineSeenUpdate = minePersonalLanguage.extend({
  season: coordinate,
  episode: coordinate,
  watched: z.boolean(),
})

export const mineTitlePersonal = z
  .object({
    titleId,
    note,
    continuation: z.enum(continuationPreferences),
    notInterested: z.boolean(),
    status: z.enum(titleStatuses).nullable(),
    seen: z.object({ title: z.boolean(), episode: z.boolean().nullable() }),
    cycle: mineCycle.nullable(),
  })
  .meta({ id: 'mineTitlePersonal' })

const mineListFilters = {
  sort: z.enum(mineSorts).default('added'),
  kind: z.enum(mineKinds).default('all'),
  rating: z.enum(mineRatingFilters).default('any'),
}

export const mineContinueQuery = minePersonalLanguage.extend({
  ...mineListFilters,
  state: z.enum(continuationPreferences).default('normal'),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(40).default(40),
})

export const minePersonalContinue = z
  .object({
    profileId,
    total: count,
    items: z.array(
      z.object({
        titleId,
        kind: z.enum(['movie', 'series']),
        metadata: mineMetadata.nullable(),
        continuation: z.enum(continuationPreferences),
        cycle: mineCycle.nullable(),
        normalResume: mineCycleResume.nullable(),
        ownRating: count.nullable(),
        updatedAt: instant,
      }),
    ),
  })
  .meta({ id: 'minePersonalContinue' })

export const mineWatchedQuery = minePersonalLanguage.extend({
  ...mineListFilters,
  source: z
    .enum(['watched', 'ratingsAndFavorites', 'earlierMarks'])
    .default('watched'),
  genre: mineDiaryFilter.shape.genre,
  country: mineDiaryFilter.shape.country,
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(40).default(40),
})

export const minePersonalWatched = z
  .object({
    profileId,
    total: count,
    items: z.array(
      z.object({
        titleId,
        kind: z.enum(['movie', 'series']),
        metadata: mineMetadata.nullable(),
        ownRating: count.nullable(),
      }),
    ),
  })
  .meta({ id: 'minePersonalWatched' })

export type MineDate = z.infer<typeof mineDate>
export type MineDiaryEntry = z.infer<typeof mineDiaryEntry>
export type MineDiaryFilter = z.infer<typeof mineDiaryFilter>
export type MineDiaryQuery = z.infer<typeof mineDiaryQuery>
export type MineCycle = z.infer<typeof mineCycle>
export type MineStart = z.infer<typeof mineStart>
export type MineTitlePersonal = z.infer<typeof mineTitlePersonal>
export type MinePersonalErrorKind = z.infer<typeof minePersonalError>['kind']
export type MineEntryMetadata = z.infer<typeof mineMetadata>
