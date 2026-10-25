import type { Library, LibraryFolder } from '../../db/schema.ts'
import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import {
  libraries,
  libraryFolders,
  libraryHiddenProfiles,
  mediaFiles,
  torrents,
} from '../../db/schema.ts'
import { envStoragePath, storagePath } from '../storage/paths.ts'
import { getMediaFile, managedFolders } from './files.ts'
import { isScanning, scanFolder } from './scan.ts'
import { unwatchFolder, watcherState, watchFolder } from './watch.ts'

export class LibraryNotFoundError extends Error {
  constructor() {
    super('Library not found')
    this.name = 'LibraryNotFoundError'
  }
}

export type PathProblem
  = | 'not_absolute'
    | 'missing'
    | 'not_directory'
    | 'denied'
    | 'inside_data'
    | 'duplicate'

/** Папку нельзя подключить: причина для панели */
export class FolderPathError extends Error {
  readonly kind: PathProblem

  constructor(kind: PathProblem) {
    super(`Folder path rejected: ${kind}`)
    this.name = 'FolderPathError'
    this.kind = kind
  }
}

export function overlaps(a: string, b: string) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/**
 * Каталоги Torsher: данные, загрузки (действующие, окружения и прежние, где
 * ещё лежат раздачи) и все папки своей раскладки
 */
export function ownStoragePaths() {
  const dirs = getDb()
    .selectDistinct({ dir: torrents.downloadDir })
    .from(torrents)
    .where(isNotNull(torrents.downloadDir))
    .all()
    .map(row => row.dir!)
  const paths = [
    config.dataDir,
    envStoragePath('downloads'),
    storagePath('downloads'),
    envStoragePath('library'),
    ...dirs,
    ...managedFolders().map(folder => folder.path),
  ]

  return [...new Set(paths.map(item => resolve(item)))]
}

/** Путь читается и это папка; запись не нужна — папки подключаются только на чтение */
export async function checkFolderPath(path: string) {
  if (!isAbsolute(path))
    throw new FolderPathError('not_absolute')

  const target = resolve(path)
  const own = ownStoragePaths()

  // Каталоги Torsher (данные, загрузки, своя раскладка) — не папка пользователя
  if (own.some(item => overlaps(target, item)))
    throw new FolderPathError('inside_data')

  const info = await stat(target).catch(() => undefined)

  if (!info)
    throw new FolderPathError('missing')

  if (!info.isDirectory())
    throw new FolderPathError('not_directory')

  try {
    await access(target, constants.R_OK | constants.X_OK)
  }
  catch {
    throw new FolderPathError('denied')
  }

  const writable = await access(target, constants.W_OK).then(
    () => true,
    () => false,
  )

  return { path: target, writable }
}

function assertNewPath(path: string) {
  const taken = getDb()
    .select({ id: libraryFolders.id })
    .from(libraryFolders)
    .where(eq(libraryFolders.path, path))
    .get()

  if (taken)
    throw new FolderPathError('duplicate')
}

export interface LibraryInput {
  kind: Library['kind']
  name: string
  path: string
  hint?: LibraryFolder['hint']
}

/** Новая библиотека с первой папкой; скан запускается сразу, в фоне */
export async function createLibrary(input: LibraryInput) {
  const { path } = await checkFolderPath(input.path)

  assertNewPath(path)

  const created = getDb().transaction((tx) => {
    const library = tx
      .insert(libraries)
      .values({ kind: input.kind, name: input.name })
      .returning()
      .get()
    const folder = tx
      .insert(libraryFolders)
      .values({
        libraryId: library.id,
        path,
        hint: input.kind === 'video' ? (input.hint ?? 'auto') : 'auto',
      })
      .returning()
      .get()

    return { library, folder }
  })

  void scanFolder(created.folder.id)

  return created.library
}

function ownLibrary(id: string) {
  const library = getDb()
    .select()
    .from(libraries)
    .where(eq(libraries.id, id))
    .get()

  if (!library || library.managed)
    throw new LibraryNotFoundError()

  return library
}

export async function addFolder(
  libraryId: string,
  input: { path: string, hint?: LibraryFolder['hint'] },
) {
  const library = ownLibrary(libraryId)
  const { path } = await checkFolderPath(input.path)

  assertNewPath(path)

  const folder = getDb()
    .insert(libraryFolders)
    .values({
      libraryId,
      path,
      hint: library.kind === 'video' ? (input.hint ?? 'auto') : 'auto',
    })
    .returning()
    .get()

  void scanFolder(folder.id)

  return folder
}

export interface LibraryPatch {
  name?: string
  exclude?: string[]
  watch?: boolean
  hiddenProfiles?: string[]
}

export function updateLibrary(id: string, patch: LibraryPatch) {
  const library = ownLibrary(id)

  getDb().transaction((tx) => {
    const { hiddenProfiles, ...values } = patch

    if (Object.keys(values).length)
      tx.update(libraries).set(values).where(eq(libraries.id, id)).run()

    if (hiddenProfiles) {
      tx.delete(libraryHiddenProfiles)
        .where(eq(libraryHiddenProfiles.libraryId, id))
        .run()

      if (hiddenProfiles.length) {
        tx.insert(libraryHiddenProfiles)
          .values(
            hiddenProfiles.map(profileId => ({ libraryId: id, profileId })),
          )
          .run()
      }
    }
  })

  if (patch.watch !== undefined && patch.watch !== library.watch) {
    for (const folder of foldersOf(id)) {
      if (patch.watch)
        void watchFolder(folder, { ...library, watch: true })
      else unwatchFolder(folder.id)
    }
  }

  // Исключения поменялись — пересканировать, чтобы файлы ушли или вернулись
  if (patch.exclude) {
    for (const folder of foldersOf(id)) void scanFolder(folder.id)
  }
}

function foldersOf(libraryId: string) {
  return getDb()
    .select()
    .from(libraryFolders)
    .where(eq(libraryFolders.libraryId, libraryId))
    .all()
}

/** Библиотека уходит из Torsher вместе с индексом; файлы на диске не трогаем */
export function removeLibrary(id: string) {
  ownLibrary(id)

  for (const folder of foldersOf(id)) unwatchFolder(folder.id)

  getDb().delete(libraries).where(eq(libraries.id, id)).run()
}

/** «Отключить папку»: индекс её файлов удаляется, сами файлы остаются */
export function removeFolder(folderId: string) {
  const found = folderWithLibrary(folderId)

  if (!found || found.library.managed)
    throw new LibraryNotFoundError()

  unwatchFolder(folderId)
  getDb().delete(libraryFolders).where(eq(libraryFolders.id, folderId)).run()
}

export function folderWithLibrary(folderId: string) {
  return getDb()
    .select({ folder: libraryFolders, library: libraries })
    .from(libraryFolders)
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(eq(libraryFolders.id, folderId))
    .get()
}

/** Скан по кнопке «Сканировать» */
export function rescanFolder(folderId: string) {
  const found = folderWithLibrary(folderId)

  if (!found || found.library.managed)
    throw new LibraryNotFoundError()

  void scanFolder(folderId)
}

/** Библиотеки для панели: папки со статусом, число и объём файлов, что требует внимания */
export function listLibraries() {
  const db = getDb()
  const rows = db.select().from(libraries).orderBy(libraries.createdAt).all()
  const folders = db.select().from(libraryFolders).all()
  const stats = db
    .select({
      folderId: mediaFiles.folderId,
      files: sql<number>`sum(case when ${mediaFiles.state} = 'present' then 1 else 0 end)`,
      size: sql<number>`sum(case when ${mediaFiles.state} = 'present' then ${mediaFiles.size} else 0 end)`,
      missing: sql<number>`sum(case when ${mediaFiles.state} = 'missing' then 1 else 0 end)`,
      unsure: sql<number>`sum(case when ${mediaFiles.state} = 'present' and ${mediaFiles.matchStatus} = 'unsure' then 1 else 0 end)`,
      // Без решения владельца: «не серия» от него — уже не вопрос
      unmatched: sql<number>`sum(case when ${mediaFiles.state} = 'present' and ${mediaFiles.matchStatus} = 'unmatched' and coalesce(${mediaFiles.matchSource}, '') != 'user' then 1 else 0 end)`,
      pending: sql<number>`sum(case when ${mediaFiles.state} = 'present' and ${mediaFiles.matchStatus} is null then 1 else 0 end)`,
    })
    .from(mediaFiles)
    .groupBy(mediaFiles.folderId)
    .all()
  const hidden = db.select().from(libraryHiddenProfiles).all()
  const byFolder = new Map(stats.map(row => [row.folderId, row]))

  return rows.map(library => ({
    ...library,
    hiddenProfiles: hidden
      .filter(row => row.libraryId === library.id)
      .map(row => row.profileId),
    folders: folders
      .filter(folder => folder.libraryId === library.id)
      .map((folder) => {
        const stat = byFolder.get(folder.id)

        return {
          ...folder,
          status: isScanning(folder.id) ? ('scanning' as const) : folder.status,
          watcher: watcherState(folder.id) ?? null,
          files: Number(stat?.files ?? 0),
          size: Number(stat?.size ?? 0),
          missing: Number(stat?.missing ?? 0),
          unsure: Number(stat?.unsure ?? 0),
          unmatched: Number(stat?.unmatched ?? 0),
          // Ещё не сопоставлены: у домашнего видео сопоставления нет
          pending:
            library.kind === 'video' && !library.managed
              ? Number(stat?.pending ?? 0)
              : 0,
        }
      }),
  }))
}

/** Файлы библиотеки страницей для панели: домашнее видео — по дате, прочее — по пути */
export function libraryFiles(
  id: string,
  page: { offset: number, limit: number },
) {
  const library = getDb()
    .select()
    .from(libraries)
    .where(eq(libraries.id, id))
    .get()

  if (!library)
    throw new LibraryNotFoundError()

  const folders = getDb()
    .select({ id: libraryFolders.id })
    .from(libraryFolders)
    .where(eq(libraryFolders.libraryId, id))
    .all()
    .map(row => row.id)

  if (!folders.length)
    return { items: [], total: 0 }

  const where = inArray(mediaFiles.folderId, folders)
  const total
    = getDb()
      .select({ count: sql<number>`count(*)` })
      .from(mediaFiles)
      .where(where)
      .get()
      ?.count ?? 0
  const items = getDb()
    .select()
    .from(mediaFiles)
    .where(where)
    .orderBy(
      library.kind === 'home'
        ? desc(mediaFiles.capturedAt)
        : mediaFiles.relPath,
      mediaFiles.relPath,
    )
    .limit(page.limit)
    .offset(page.offset)
    .all()

  return { items, total: Number(total) }
}

/** Библиотеки, скрытые от профиля на витрине; своя раскладка видна всем */
export function hiddenLibraryIds(profileId: string) {
  return getDb()
    .select({ id: libraryHiddenProfiles.libraryId })
    .from(libraryHiddenProfiles)
    .where(eq(libraryHiddenProfiles.profileId, profileId))
    .all()
    .map(row => row.id)
}

/** Папки библиотек, которые профиль видит, с их библиотекой */
export function visibleFolderLibraries(
  profileId: string,
  kind?: Library['kind'],
  libraryId?: string,
) {
  const hidden = new Set(hiddenLibraryIds(profileId))

  return getDb()
    .select({ id: libraryFolders.id, libraryId: libraries.id })
    .from(libraryFolders)
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(
      and(
        kind ? eq(libraries.kind, kind) : undefined,
        libraryId ? eq(libraries.id, libraryId) : undefined,
      ),
    )
    .all()
    .filter(row => !hidden.has(row.libraryId))
}

/** Папки библиотек, которые профиль видит, — фильтр для рядов витрины */
export function visibleFolderIds(
  profileId: string,
  kind?: Library['kind'],
  libraryId?: string,
) {
  return visibleFolderLibraries(profileId, kind, libraryId).map(
    row => row.id,
  )
}

/** Есть ли у профиля видимая библиотека этого вида: раздел рейла */
export function hasVisibleLibrary(profileId: string, kind: Library['kind']) {
  const ids = visibleFolderIds(profileId, kind)

  if (!ids.length)
    return false

  return !!getDb()
    .select({ id: mediaFiles.id })
    .from(mediaFiles)
    .where(
      and(inArray(mediaFiles.folderId, ids), eq(mediaFiles.state, 'present')),
    )
    .get()
}

export interface BrowseEntry {
  name: string
  path: string
}

/** Обзор ФС сервера для выбора папки: только каталоги, без скрытых */
export async function browseFolders(path = '/') {
  const target = resolve(isAbsolute(path) ? path : '/')
  const entries = await readdir(target, { withFileTypes: true })
  const dirs: BrowseEntry[] = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ name: entry.name, path: join(target, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    path: target,
    parent: target === '/' ? null : dirname(target),
    entries: dirs,
  }
}

/**
 * Файл библиотеки, которую от профиля зрителя скрыли, для него не существует.
 * У токена потока владельца профиля нет — ему открыто всё.
 */
export function playableMediaFile(id: string, profileId: string) {
  const found = getMediaFile(id)

  if (
    found
    && profileId
    && hiddenLibraryIds(profileId).includes(found.folder.libraryId)
  ) {
    return undefined
  }

  return found
}
