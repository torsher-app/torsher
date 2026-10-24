import type {
  Library,
  LibraryFolder,
  MediaFile,
  Profile,
} from '../../db/schema.ts'
import type { ExportDocument, ExportSettings } from './document.ts'
import type { PasswordKey } from './passwords.ts'
import { and, asc, eq, inArray, or } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import {
  collectionHiddenProfiles,
  collections,
  collectionTitles,
  indexerManagers,
  indexers,
  libraries,
  libraryFolders,
  libraryHiddenProfiles,
  mediaFiles,
  netRoutes,
  notificationChannels,
  profiles,
  profileTitles,
  titleAliases,
  titleProgress,
  titleVoices,
} from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { providerOf } from '../notifications/channels/index.ts'
import { decryptSecret, SecretError } from '../secrets/index.ts'
import { getSetting } from '../settings/index.ts'
import { EXPORT_FORMAT, EXPORT_VERSION } from './document.ts'
import {
  encryptWithPassword,
  newPasswordKey,
  passwordCheck,
} from './passwords.ts'

const FILE_PREFIX = 'file:'

export interface ExportOptions {
  scope: 'server' | 'profile'
  // Для `profile` — чей экспорт
  profileId?: string
  include?: {
    collections?: boolean
    libraries?: boolean
    settings?: boolean
  }
  // Без пароля секретов в файле нет совсем
  password?: string
}

export class ExportProfileNotFoundError extends Error {}

function iso(date: Date | null | undefined) {
  return date ? date.toISOString() : null
}

/** Ключи профилей внутри файла: по порядку, без ID сервера */
function profileKeys(rows: Profile[]) {
  return new Map(rows.map((row, index) => [row.id, `p${index + 1}`]))
}

interface SecretWriter {
  // Шифртекст ключа сервера → шифртекст от пароля; без пароля — null
  (ciphertext: string | null | undefined): string | null
  unreadable: number
}

function secretWriter(key: PasswordKey | undefined): SecretWriter {
  const write = ((ciphertext: string | null | undefined) => {
    if (!ciphertext || !key)
      return null

    try {
      return encryptWithPassword(key, decryptSecret(ciphertext))
    }
    catch (err) {
      // Сменился ключ сервера: секрет не прочитать, файл уходит без него
      if (err instanceof SecretError) {
        write.unreadable++

        return null
      }

      throw err
    }
  }) as SecretWriter

  write.unreadable = 0

  return write
}

interface FileIndex {
  ref: (id: string) => { folder: string, path: string } | undefined
}

/** Папка и путь файла библиотеки по ID; своя раскладка не переносится */
function fileIndex(ids: string[]): FileIndex {
  const refs = new Map<string, { folder: string, path: string }>()

  if (ids.length) {
    const rows = getDb()
      .select({
        id: mediaFiles.id,
        relPath: mediaFiles.relPath,
        folder: libraryFolders.path,
        managed: libraries.managed,
      })
      .from(mediaFiles)
      .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
      .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
      .where(inArray(mediaFiles.id, ids))
      .all()

    for (const row of rows) {
      if (!row.managed)
        refs.set(row.id, { folder: row.folder, path: row.relPath })
    }
  }

  return { ref: id => refs.get(id) }
}

function exportProgress(
  profileIds: string[],
  keys: Map<string, string>,
  withFiles: boolean,
): ExportDocument['progress'] {
  const rows = getDb()
    .select()
    .from(titleProgress)
    .where(inArray(titleProgress.profileId, profileIds))
    .orderBy(asc(titleProgress.titleId))
    .all()
  const files = fileIndex(
    withFiles
      ? rows
          .filter(row => row.titleId.startsWith(FILE_PREFIX))
          .map(row => row.titleId.slice(FILE_PREFIX.length))
      : [],
  )
  const result: ExportDocument['progress'] = []

  for (const row of rows) {
    const isFile = row.titleId.startsWith(FILE_PREFIX)
    const file = isFile
      ? files.ref(row.titleId.slice(FILE_PREFIX.length))
      : undefined

    if (isFile && !file)
      continue

    result.push({
      profile: keys.get(row.profileId)!,
      ...(file ? { file } : { title: row.titleId }),
      season: row.season,
      episode: row.episode,
      position: row.position,
      duration: row.duration,
      voiceStudio: row.voiceStudio,
      voiceType: row.voiceType,
      updatedAt: row.updatedAt.toISOString(),
    })
  }

  return result
}

function exportMine(
  profileIds: string[],
  keys: Map<string, string>,
): ExportDocument['mine'] {
  return getDb()
    .select()
    .from(profileTitles)
    .where(inArray(profileTitles.profileId, profileIds))
    .orderBy(asc(profileTitles.titleId))
    .all()
    .map(row => ({
      profile: keys.get(row.profileId)!,
      title: row.titleId,
      watchlistAt: iso(row.watchlistAt),
      favoriteAt: iso(row.favoriteAt),
      rating: row.rating,
      ratedAt: iso(row.ratedAt),
      droppedAt: iso(row.droppedAt),
    }))
}

function exportCollections(
  keys: Map<string, string>,
): NonNullable<ExportDocument['collections']> {
  const db = getDb()
  const rows = db
    .select()
    .from(collections)
    .orderBy(asc(collections.name))
    .all()
  const titles = db.select().from(collectionTitles).all()
  const hidden = db.select().from(collectionHiddenProfiles).all()

  return rows.map(row => ({
    name: row.name,
    showOnHome: row.showOnHome,
    hiddenFrom: hidden
      .filter(item => item.collectionId === row.id)
      .map(item => keys.get(item.profileId)!),
    titles: titles
      .filter(item => item.collectionId === row.id)
      .map(item => ({
        title: item.titleId,
        addedAt: item.addedAt.toISOString(),
        addedBy: item.addedByProfileId
          ? (keys.get(item.addedByProfileId) ?? null)
          : null,
      })),
  }))
}

function exportVoices(): NonNullable<ExportDocument['voices']> {
  return getDb()
    .select()
    .from(titleVoices)
    .orderBy(asc(titleVoices.titleId), asc(titleVoices.season))
    .all()
    .map(row => ({
      title: row.titleId,
      season: row.season,
      studio: row.studio,
      type: row.type,
      updatedAt: row.updatedAt.toISOString(),
    }))
}

function exportAliases(): NonNullable<ExportDocument['aliases']> {
  return getDb()
    .select()
    .from(titleAliases)
    .where(eq(titleAliases.kind, 'user'))
    .orderBy(asc(titleAliases.titleId))
    .all()
    .map(row => ({ title: row.titleId, value: row.value, lang: row.lang }))
}

function libraryFileOf(folder: LibraryFolder, file: MediaFile) {
  const userMatch = file.matchSource === 'user' && file.matchStatus
  const userDate = file.capturedAtSource === 'user' && file.capturedAt

  if (!userMatch && !userDate)
    return undefined

  return {
    folder: folder.path,
    path: file.relPath,
    ...(userMatch
      ? {
          match: {
            status: file.matchStatus!,
            title: file.titleId,
            season: file.season,
            episode: file.episode,
            episodeTo: file.episodeTo,
            version: file.version,
          },
        }
      : {}),
    ...(userDate ? { capturedAt: file.capturedAt!.toISOString() } : {}),
  }
}

/**
 * Подключённые библиотеки: папки, видимость и решения владельца о файлах.
 * Своя раскладка не переносится: её файлы с ID в имени сопоставятся сами.
 */
function exportLibraries(
  keys: Map<string, string>,
): NonNullable<ExportDocument['libraries']> {
  const db = getDb()
  const rows: Library[] = db
    .select()
    .from(libraries)
    .where(eq(libraries.managed, false))
    .orderBy(asc(libraries.createdAt))
    .all()

  return rows.map((library) => {
    const folders = db
      .select()
      .from(libraryFolders)
      .where(eq(libraryFolders.libraryId, library.id))
      .orderBy(asc(libraryFolders.path))
      .all()
    const decided = folders.length
      ? db
          .select()
          .from(mediaFiles)
          .where(
            and(
              inArray(
                mediaFiles.folderId,
                folders.map(folder => folder.id),
              ),
              or(
                eq(mediaFiles.matchSource, 'user'),
                eq(mediaFiles.capturedAtSource, 'user'),
              ),
            ),
          )
          .orderBy(asc(mediaFiles.relPath))
          .all()
      : []
    const byFolder = new Map(folders.map(folder => [folder.id, folder]))

    return {
      kind: library.kind,
      name: library.name,
      exclude: library.exclude,
      watch: library.watch,
      hiddenFrom: db
        .select()
        .from(libraryHiddenProfiles)
        .where(eq(libraryHiddenProfiles.libraryId, library.id))
        .all()
        .map(item => keys.get(item.profileId)!),
      folders: folders.map(folder => ({
        path: folder.path,
        hint: folder.hint,
      })),
      files: decided.flatMap((file) => {
        const item = libraryFileOf(byFolder.get(file.folderId)!, file)

        return item ? [item] : []
      }),
    }
  })
}

function exportSettings(secret: SecretWriter): ExportSettings {
  const db = getDb()
  const managers = db
    .select()
    .from(indexerManagers)
    .orderBy(asc(indexerManagers.createdAt))
    .all()
  const managerKeys = new Map(
    managers.map((row, index) => [row.id, `m${index + 1}`]),
  )
  const tmdb = getSetting<{ key?: string }>('tmdb')

  return {
    routes: db
      .select()
      .from(netRoutes)
      .orderBy(asc(netRoutes.position))
      .all()
      .map(row => ({
        match: row.match,
        via: row.via,
        proxyAddress: row.proxyAddress,
        proxyUsername: secret(row.proxyUsername),
        proxyPassword: secret(row.proxyPassword),
        dns: row.dns,
        dohUrl: row.dohUrl,
        position: row.position,
      })),
    managers: managers.map(row => ({
      key: managerKeys.get(row.id)!,
      kind: row.kind,
      url: row.url,
      apiKey: secret(row.apiKey),
    })),
    indexers: db
      .select()
      .from(indexers)
      .orderBy(asc(indexers.createdAt))
      .all()
      .map(row => ({
        name: row.name,
        url: row.url,
        apiKey: secret(row.apiKey),
        enabled: row.enabled,
        manager: row.managerId
          ? (managerKeys.get(row.managerId) ?? null)
          : null,
        externalId: row.externalId,
      })),
    channels: db
      .select()
      .from(notificationChannels)
      .orderBy(asc(notificationChannels.createdAt))
      .all()
      .map((row) => {
        const secretFields = providerOf(row.kind)?.secretFields ?? []
        const channelConfig: Record<string, unknown> = {}

        for (const [field, value] of Object.entries(row.config)) {
          if (!secretFields.includes(field)) {
            channelConfig[field] = value
            continue
          }

          const written = secret(typeof value === 'string' ? value : null)

          if (written)
            channelConfig[field] = written
        }

        return {
          kind: row.kind,
          name: row.name,
          enabled: row.enabled,
          language: row.language,
          panelUrl: row.panelUrl,
          config: channelConfig,
          events: row.events,
          includeWarnings: row.includeWarnings,
          notifyResolved: row.notifyResolved,
        }
      }),
    tmdbKey: secret(tmdb?.key),
  }
}

/**
 * Файл экспорта. Ответ собирается явно по полям: ни внутренних ID, ни хеша
 * PIN, ни шифртекстов ключа сервера в нём нет.
 */
export function buildExport(
  options: ExportOptions,
  now = new Date(),
): ExportDocument {
  const db = getDb()
  const all = db.select().from(profiles).orderBy(asc(profiles.position)).all()
  const chosen
    = options.scope === 'profile'
      ? all.filter(row => row.id === options.profileId)
      : all

  if (!chosen.length)
    throw new ExportProfileNotFoundError()

  const keys = profileKeys(chosen)
  const ids = chosen.map(row => row.id)
  const server = options.scope === 'server'
  const include = server ? (options.include ?? {}) : {}
  const passwordKey
    = options.password && include.settings
      ? newPasswordKey(options.password)
      : undefined
  const secret = secretWriter(passwordKey)
  const document: ExportDocument = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    torsher: { version: config.version, commit: config.commit ?? null },
    scope: options.scope,
    ...(passwordKey
      ? {
          encryption: {
            kdf: 'scrypt' as const,
            salt: passwordKey.salt,
            check: passwordCheck(passwordKey),
          },
        }
      : {}),
    profiles: chosen.map(row => ({
      key: keys.get(row.id)!,
      name: row.name,
      color: row.color,
      language: row.language,
      ageLimit: row.ageLimit,
      posterRatings: row.posterRatings,
      player: row.player ?? null,
      position: row.position,
    })),
    progress: exportProgress(ids, keys, !!include.libraries),
    mine: exportMine(ids, keys),
  }

  if (server) {
    document.voices = exportVoices()
    document.aliases = exportAliases()

    if (include.collections)
      document.collections = exportCollections(keys)

    if (include.libraries)
      document.libraries = exportLibraries(keys)

    if (include.settings)
      document.settings = exportSettings(secret)
  }

  if (secret.unreadable) {
    logFor('backups').warn(
      { count: secret.unreadable },
      'Export skipped secrets that cannot be decrypted',
    )
  }

  return document
}

export function exportFileName(now = new Date()) {
  return `torsher-export-${now.toISOString().slice(0, 10)}.json`
}
