import { z } from 'zod'
import {
  libraryFolderHints,
  libraryKinds,
  mediaMatchStatuses,
  netRouteDns,
  netRouteVias,
  posterRatingSources,
  profileColors,
  profileLanguages,
  subtitleBackgrounds,
  subtitleSizes,
} from '../../db/schema.ts'

export const EXPORT_FORMAT = 'torsher-export'
export const EXPORT_VERSION = 1

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
  apiKey: secret.nullable(),
})

const exportIndexer = z.object({
  name: z.string().min(1).max(200),
  url: z.string().min(1).max(2048),
  apiKey: secret.nullable(),
  enabled: z.boolean(),
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

export const exportDocument = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
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
    /^\s*\{/.test(text) && text.slice(0, 200).includes(`"${EXPORT_FORMAT}"`)
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

  return parsed.data
}
