import { z } from 'zod'
import {
  continuationPreferences,
  diaryOrigins,
  diaryPrecisions,
  indexerPrivacyValues,
  libraryFolderHints,
  libraryKinds,
  mediaMatchStatuses,
  mineSections,
  netRouteDns,
  netRouteVias,
  posterRatingSources,
  profileColors,
  profileLanguages,
  rewatchCycleStates,
  seedCriteriaModes,
  subtitleBackgrounds,
  subtitleColors,
  subtitlePositions,
  subtitleSizes,
} from '../../db/schema.ts'
import { simklSourceUrl } from '../simkl/identity.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { isDiaryTimeZone } from './diaryTimeZone.ts'

export const EXPORT_FORMAT = 'torsher-export'
export const EXPORT_VERSION = 3

/**
 * Переносимый файл данных: тайтлы — каталожными ID, профили — ключами
 * внутри файла, без внутренних ID сервера. Версия формата не связана с
 * миграциями базы: новый необязательный раздел или поле версию не меняет,
 * несовместимое изменение — новая версия и приведение старой к ней.
 */

const at = z.iso.datetime()
const titleId = z.string().min(1).max(100)
const profileKey = z.string().min(1).max(20)
// Секрет — шифртекст от пароля экспорта (`p1:`, transfer/passwords.ts)
const secret = z.string().startsWith('p1:').max(10_000)

const exportProfile = z.object({
  key: profileKey,
  name: z.string().min(1).max(100),
  color: z.enum(profileColors),
  language: z.enum(profileLanguages).nullable(),
  ageLimit: z.number().int().nullable(),
  // Какие оценки видны на постерах витрины
  posterRatings: z.array(z.enum(posterRatingSources)),
  player: z
    .object({
      autoNext: z.boolean(),
      subtitleSize: z.enum(subtitleSizes),
      subtitleBackground: z.enum(subtitleBackgrounds),
      subtitlePosition: z.enum(subtitlePositions),
      subtitleColor: z.enum(subtitleColors),
    })
    .partial()
    .nullable(),
  position: z.number().int(),
})

// Файл библиотеки — по пути папки и относительному пути: ID файлов у
// каждого сервера свои
const fileRef = z.object({
  folder: z.string().min(1).max(4096),
  path: z.string().min(1).max(4096),
})

const exportProgress = z
  .object({
    profile: profileKey,
    // Тайтл каталога или файл библиотеки без тайтла (домашнее видео)
    title: titleId.optional(),
    file: fileRef.optional(),
    season: z.number().int().min(0),
    episode: z.number().int().min(0),
    position: z.number().min(0),
    duration: z.number().min(0).nullable(),
    voiceStudio: z.string().max(200).nullable(),
    voiceType: z.string().max(50).nullable(),
    // Нет у файлов прошлых версий: там отметку выводят из позиции
    watchedAt: at.nullable().optional(),
    updatedAt: at,
  })
  .refine(row => !!row.title !== !!row.file, 'title or file')

const exportMine = z.object({
  profile: profileKey,
  title: titleId,
  watchlistAt: at.nullable(),
  favoriteAt: at.nullable(),
  rating: z.number().int().min(1).max(10).nullable(),
  ratedAt: at.nullable(),
  droppedAt: at.nullable(),
  watchedMarkedAt: at.nullable().optional(),
})

const exportCollection = z.object({
  name: z.string().min(1).max(100),
  showOnHome: z.boolean(),
  hiddenFrom: z.array(profileKey),
  titles: z.array(
    z.object({
      title: titleId,
      addedAt: at,
      addedBy: profileKey.nullable(),
    }),
  ),
})

const exportVoice = z.object({
  title: titleId,
  season: z.number().int().min(0),
  studio: z.string().max(200).nullable(),
  type: z.string().max(50).nullable(),
  updatedAt: at,
})

const exportAlias = z.object({
  title: titleId,
  value: z.string().min(1).max(500),
  lang: z.string().max(20).nullable(),
})

// Решения владельца о файлах: ручное сопоставление и исправленная дата
const exportLibraryFile = fileRef.extend({
  match: z
    .object({
      status: z.enum(mediaMatchStatuses),
      title: titleId.nullable(),
      season: z.number().int().nullable(),
      episode: z.number().int().nullable(),
      episodeTo: z.number().int().nullable(),
      version: z.string().max(200).nullable(),
    })
    .optional(),
  capturedAt: at.optional(),
})

const exportLibrary = z.object({
  kind: z.enum(libraryKinds),
  name: z.string().min(1).max(100),
  exclude: z.array(z.string().max(500)),
  watch: z.boolean(),
  hiddenFrom: z.array(profileKey),
  folders: z.array(
    z.object({
      path: z.string().min(1).max(4096),
      hint: z.enum(libraryFolderHints),
    }),
  ),
  files: z.array(exportLibraryFile),
})

const exportRoute = z.object({
  match: z.string().min(1).max(255),
  via: z.enum(netRouteVias),
  proxyAddress: z.string().max(300).nullable(),
  proxyUsername: secret.nullable(),
  proxyPassword: secret.nullable(),
  dns: z.enum(netRouteDns),
  dohUrl: z.string().max(2048).nullable(),
  position: z.number().int(),
})

const exportManager = z.object({
  key: z.string().min(1).max(20),
  kind: z.enum(['prowlarr', 'jackett']),
  url: z.string().min(1).max(2048),
  browserUrl: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .nullable()
    .optional(),
  apiKey: secret.nullable(),
})

const exportIndexer = z.object({
  name: z.string().min(1).max(200),
  url: z.string().min(1).max(2048),
  apiKey: secret.nullable(),
  sessionCookie: z.string().startsWith('p1:').max(12000).nullable().optional(),
  enabled: z.boolean(),
  knownPrivacy: z.enum(indexerPrivacyValues).nullable().optional(),
  isPrivate: z.boolean().optional(),
  allowAutomation: z.boolean().optional(),
  minSeedRatio: z.number().positive().nullable().optional(),
  minSeedTimeMinutes: z.number().int().positive().nullable().optional(),
  seedCriteriaMode: z.enum(seedCriteriaModes).nullable().optional(),
  policyCustomized: z.boolean().optional(),
  manager: z.string().max(20).nullable(),
  externalId: z.string().max(200).nullable(),
})

const exportChannel = z.object({
  kind: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  language: z.enum(profileLanguages),
  panelUrl: z.string().max(2048).nullable(),
  // Секретные поля провайдера — шифртекстом от пароля или без них
  config: z.record(z.string(), z.unknown()),
  events: z.array(z.string().max(50)),
  includeWarnings: z.boolean(),
  notifyResolved: z.boolean(),
})

const exportDocumentV1 = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: at,
  torsher: z.object({
    version: z.string().max(100),
    commit: z.string().max(100).nullable(),
  }),
  scope: z.enum(['server', 'profile']),
  // Есть, когда секреты зашифрованы паролем экспорта
  encryption: z
    .object({
      kdf: z.literal('scrypt'),
      salt: z.string().min(1).max(200),
      // Шифртекст известной строки: проверка пароля до разбора секретов
      check: secret,
    })
    .optional(),
  profiles: z.array(exportProfile).min(1),
  progress: z.array(exportProgress),
  mine: z.array(exportMine),
  collections: z.array(exportCollection).optional(),
  voices: z.array(exportVoice).optional(),
  aliases: z.array(exportAlias).optional(),
  libraries: z.array(exportLibrary).optional(),
  settings: z
    .object({
      routes: z.array(exportRoute),
      managers: z.array(exportManager),
      indexers: z.array(exportIndexer),
      channels: z.array(exportChannel),
      tmdbKey: secret.nullable(),
    })
    .partial()
    .optional(),
})

const catalogTitle = titleId.refine(
  value => !!parseCatalogId(value),
  'catalog title',
)
const seriesTitle = catalogTitle.refine(
  value => parseCatalogId(value)?.type === 'tv',
  'series title',
)
const coordinate = z.number().int().nonnegative()
const personalRow = z.object({ profile: profileKey })
const titleRow = personalRow.extend({ title: catalogTitle })
const viewingTarget = titleRow.extend({
  season: coordinate,
  episode: coordinate,
})

function isViewingTarget(row: {
  title: string
  season: number
  episode: number
}) {
  if (row.episode === 0)
    return row.season === 0

  return parseCatalogId(row.title)?.type === 'tv'
}

const diaryEntry = viewingTarget
  .extend({
    id: z.uuid(),
    precision: z.enum(diaryPrecisions),
    instant: at.nullable(),
    day: z.iso.date().nullable(),
    origin: z.enum(diaryOrigins),
    originKey: z.string().min(1).max(500).nullable(),
    sourceMatchKey: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    rewatch: z.boolean(),
    note: z.string().max(10_000).nullable(),
    viewingContext: z.string().max(1000).nullable(),
    context: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('normal') }),
        z.object({ kind: z.literal('cycle'), cycleId: z.uuid() }),
      ])
      .nullable(),
    createdAt: at,
    updatedAt: at,
  })
  .refine(isViewingTarget)
  .refine((row) => {
    switch (row.precision) {
      case 'instant':
        return row.instant !== null && row.day === null
      case 'day':
        return row.instant === null && row.day !== null
      case 'unknown':
        return row.instant === null && row.day === null
    }
  }, 'date precision')

const rewatchCycle = personalRow.extend({
  id: z.uuid(),
  title: seriesTitle,
  state: z.enum(rewatchCycleStates),
  startSeason: coordinate,
  startEpisode: coordinate.positive(),
  targetSeason: coordinate,
  targetEpisode: coordinate.positive(),
  createdAt: at,
  updatedAt: at,
})

const cycleCursor = personalRow.extend({
  cycleId: z.uuid(),
  season: coordinate,
  episode: coordinate.positive(),
  position: z.number().nonnegative(),
  duration: z.number().nonnegative().nullable(),
  source: z
    .discriminatedUnion('kind', [
      fileRef.extend({ kind: z.literal('library') }),
      z.object({
        kind: z.literal('torrent'),
        infoHash: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i),
        fileIndex: coordinate,
      }),
    ])
    .nullable(),
  voiceStudio: z.string().max(200).nullable(),
  voiceType: z.string().max(50).nullable(),
  completedAt: at.nullable().optional(),
  updatedAt: at,
})

const cyclePlayback = personalRow
  .extend({
    title: seriesTitle,
    season: coordinate,
    episode: coordinate.positive(),
    watchedAt: at.nullable(),
    lastPlayedAt: at.nullable(),
    updatedAt: at,
  })
  .refine(row => !!(row.watchedAt || row.lastPlayedAt))

const personalSpace = z.object({
  timeZone: z.string().max(100).refine(isDiaryTimeZone),
  diary: z.array(diaryEntry),
  seen: z.array(viewingTarget.refine(isViewingTarget)),
  cycles: z.array(rewatchCycle),
  cycleProgress: z.array(cycleCursor),
  cyclePlayback: z.array(cyclePlayback),
  titlePreferences: z.array(
    titleRow.extend({
      note: z.string().max(10_000).nullable(),
      continuation: z.enum(continuationPreferences),
      notInterested: z.boolean(),
      updatedAt: at,
    }),
  ),
  profilePreferences: z.array(
    personalRow.extend({
      startSection: z.enum(mineSections),
      startCollectionName: z.string().min(1).max(100).nullable().optional(),
      updatedAt: at,
    }),
  ),
})

const exportDocumentV2 = exportDocumentV1.extend({
  version: z.literal(2),
  personalSpace: personalSpace.extend({
    diary: z.array(diaryEntry.safeExtend({
      origin: z.enum(diaryOrigins.filter(origin => origin !== 'simkl')),
    })),
  }),
})

const exportDocumentV3 = exportDocumentV1.extend({
  version: z.literal(EXPORT_VERSION),
  personalSpace,
})

// The download uses the same shape for v2 and v3. The reader still validates
// origins against the exact version when it accepts an uploaded file.
export const writtenExportDocument = exportDocumentV3.extend({
  version: z.union([z.literal(2), z.literal(EXPORT_VERSION)]),
})
const exportDocument = z.discriminatedUnion('version', [
  exportDocumentV1,
  exportDocumentV2,
  exportDocumentV3,
])

export type WrittenExportDocument = z.infer<typeof writtenExportDocument>
export type ExportPersonalSpace = z.infer<typeof personalSpace>

function key(...values: (number | string)[]) {
  return JSON.stringify(values)
}

function unique<T>(rows: T[], keyOf: (row: T) => string) {
  return new Set(rows.map(keyOf)).size === rows.length
}

function validatePersonalSpace(document: WrittenExportDocument) {
  const space = document.personalSpace
  if (space.diary.some(row => row.origin === 'simkl' && !simklSourceUrl(row.originKey)))
    return false
  const profiles = new Set(document.profiles.map(profile => profile.key))
  const sections = [
    document.progress,
    document.mine,
    space.diary,
    space.seen,
    space.cycles,
    space.cycleProgress,
    space.cyclePlayback,
    space.titlePreferences,
    space.profilePreferences,
  ]
  const eventKey = (row: {
    profile: string
    title: string
    season: number
    episode: number
  }) => key(row.profile, row.title, row.season, row.episode)
  const cycles = new Map(
    space.cycles.map(row => [key(row.profile, row.id), row.title]),
  )
  const originKeys = space.diary.flatMap(row =>
    row.originKey === null ? [] : [key(row.profile, row.origin, row.originKey)],
  )
  const unfinishedCycles = space.cycles.filter(row => row.state !== 'ended')

  return (
    profiles.size === document.profiles.length
    && (document.scope !== 'profile' || profiles.size === 1)
    && sections.every(rows => rows.every(row => profiles.has(row.profile)))
    && unique(space.diary, row => key(row.profile, row.id))
    && unique(originKeys, value => value)
    && unique(space.seen, eventKey)
    && cycles.size === space.cycles.length
    && unique(unfinishedCycles, row => key(row.profile, row.title))
    && unique(space.cycleProgress, row =>
      key(row.profile, row.cycleId, row.season, row.episode))
    && space.cycleProgress.every(row =>
      cycles.has(key(row.profile, row.cycleId)),
    )
    && space.diary.every((row) => {
      if (row.context?.kind !== 'cycle')
        return true

      // Historical context can refer to an ended cycle that has been removed.
      const title = cycles.get(key(row.profile, row.context.cycleId))
      return row.episode > 0 && (!title || title === row.title)
    })
    && unique(space.cyclePlayback, eventKey)
    && unique(space.titlePreferences, row => key(row.profile, row.title))
    && unique(space.profilePreferences, row => row.profile)
  )
}

export type ExportDocument = z.infer<typeof exportDocument>
export type ExportProfile = ExportDocument['profiles'][number]
export type ExportProgress = ExportDocument['progress'][number]
export type ExportMine = ExportDocument['mine'][number]
export type ExportLibrary = NonNullable<ExportDocument['libraries']>[number]
export type ExportSettings = NonNullable<ExportDocument['settings']>

export type DocumentErrorKind = 'notExport' | 'newerVersion' | 'broken'

export class DocumentError extends Error {
  readonly kind: DocumentErrorKind

  constructor(kind: DocumentErrorKind, options?: ErrorOptions) {
    super(`Export file: ${kind}`, options)
    this.name = 'DocumentError'
    this.kind = kind
  }
}

/** Похоже ли содержимое файла на экспорт Torsher, без полного разбора */
export function looksLikeExport(text: string) {
  return (
    /^\s*\{/.test(text)
    && new RegExp(`"format"\\s*:\\s*"${EXPORT_FORMAT}"`).test(text)
  )
}

/**
 * Разбор файла экспорта. Файл более новой версии формата — отдельная
 * ошибка: владельцу нужно обновить Torsher, а не искать другой файл.
 */
export function parseExportDocument(text: string): ExportDocument {
  let raw: unknown

  try {
    raw = JSON.parse(text)
  }
  catch (err) {
    throw new DocumentError('broken', { cause: err })
  }

  if (
    typeof raw !== 'object'
    || raw === null
    || (raw as { format?: unknown }).format !== EXPORT_FORMAT
  ) {
    throw new DocumentError('notExport')
  }

  const version = (raw as { version?: unknown }).version

  if (typeof version === 'number' && version > EXPORT_VERSION)
    throw new DocumentError('newerVersion')

  const parsed = exportDocument.safeParse(raw)

  if (!parsed.success)
    throw new DocumentError('broken', { cause: parsed.error })

  if (parsed.data.version !== 1 && !validatePersonalSpace(parsed.data))
    throw new DocumentError('broken')

  return parsed.data
}
