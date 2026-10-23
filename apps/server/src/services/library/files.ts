import type { LibraryFolder, MediaFile } from '../../db/schema.ts'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import {
  libraries,
  libraryFolders,
  mediaFiles,
  torrents,
} from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'

/**
 * Своя раскладка — скрытая библиотека «Фильмы и сериалы» с одной папкой.
 * Создаётся при первом обращении; путь папки всегда — `LIBRARY_PATH`.
 */
export function managedFolder(): LibraryFolder {
  const db = getDb()

  return db.transaction((tx) => {
    const found = tx
      .select({ folder: libraryFolders })
      .from(libraryFolders)
      .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
      .where(eq(libraries.managed, true))
      .get()
      ?.folder

    if (found) {
      return found.path === config.libraryPath
        ? found
        : tx
            .update(libraryFolders)
            .set({ path: config.libraryPath })
            .where(eq(libraryFolders.id, found.id))
            .returning()
            .get()
    }

    const library = tx
      .insert(libraries)
      .values({ kind: 'video', name: 'Torsher', managed: true })
      .returning()
      .get()

    return tx
      .insert(libraryFolders)
      .values({ libraryId: library.id, path: config.libraryPath })
      .returning()
      .get()
  })
}

export function absolutePathOf(folder: LibraryFolder, file: MediaFile) {
  return join(folder.path, ...file.relPath.split('/'))
}

/** Файлы своей раскладки, которые положены из раздачи */
export function torrentLibraryFiles(torrentId: string) {
  return getDb()
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.torrentId, torrentId))
    .all()
}

/** Файлы библиотеки по раздачам: индексы файлов, которые уже положены */
export function placedFilesByTorrent(torrentIds: string[]) {
  const placed = new Map<string, Set<number>>()

  if (!torrentIds.length)
    return placed

  const rows = getDb()
    .select({
      torrentId: mediaFiles.torrentId,
      fileIndex: mediaFiles.fileIndex,
    })
    .from(mediaFiles)
    .where(
      and(
        inArray(mediaFiles.torrentId, torrentIds),
        eq(mediaFiles.state, 'present'),
      ),
    )
    .all()

  for (const row of rows) {
    if (row.torrentId === null || row.fileIndex === null)
      continue

    const set = placed.get(row.torrentId) ?? new Set<number>()

    set.add(row.fileIndex)
    placed.set(row.torrentId, set)
  }

  return placed
}

/**
 * Папка тайтла, если его файлы уже лежат в своей раскладке
 * (`movies/Название (2010) [tmdbid-27205]`): новые файлы идут туда же, даже
 * если название в каталоге с тех пор поменялось.
 */
export function existingTitleFolder(folderId: string, titleId: string) {
  const row = getDb()
    .select({ relPath: mediaFiles.relPath })
    .from(mediaFiles)
    .where(
      and(eq(mediaFiles.folderId, folderId), eq(mediaFiles.titleId, titleId)),
    )
    .get()

  return row?.relPath.split('/').slice(0, 2).join('/')
}

export interface LibraryUsage {
  /** Байт в своей раскладке */
  used: number
  /** Из них общие с раздачами в загрузках (хардлинк и reflink) */
  shared: number
}

/** Объём своей раскладки и сколько из него общего с раздачами в движке */
export function libraryUsage(): LibraryUsage {
  const folder = managedFolder()
  const rows = getDb()
    .select({
      size: mediaFiles.size,
      linkMode: mediaFiles.linkMode,
      inEngine: torrents.inEngine,
    })
    .from(mediaFiles)
    .leftJoin(torrents, eq(torrents.id, mediaFiles.torrentId))
    .where(
      and(eq(mediaFiles.folderId, folder.id), eq(mediaFiles.state, 'present')),
    )
    .all()

  let used = 0
  let shared = 0

  for (const row of rows) {
    used += row.size

    if (row.inEngine && row.linkMode !== 'copy')
      shared += row.size
  }

  return { used, shared }
}

/**
 * Байт раздачи, которые остаются на диске после её удаления: на них есть
 * хардлинк или reflink из библиотеки. Вытеснение их не освобождает.
 */
export function linkedBytesByTorrent() {
  const rows = getDb()
    .select({ torrentId: mediaFiles.torrentId, size: mediaFiles.size })
    .from(mediaFiles)
    .where(
      and(
        isNotNull(mediaFiles.torrentId),
        inArray(mediaFiles.linkMode, ['hardlink', 'reflink']),
        eq(mediaFiles.state, 'present'),
      ),
    )
    .all()
  const linked = new Map<string, number>()

  for (const row of rows) {
    if (row.torrentId)
      linked.set(row.torrentId, (linked.get(row.torrentId) ?? 0) + row.size)
  }

  return linked
}

/**
 * Сверка своей раскладки с диском: пропавший файл — `missing` (ничего не
 * удаляется), вернувшийся — снова `present`.
 */
export async function checkManagedFiles() {
  const folder = managedFolder()
  const rows = getDb()
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.folderId, folder.id))
    .all()
  let missing = 0

  for (const row of rows) {
    const exists = await stat(absolutePathOf(folder, row)).then(
      () => true,
      () => false,
    )

    if (exists && row.state === 'missing') {
      getDb()
        .update(mediaFiles)
        .set({ state: 'present', missingSince: null })
        .where(eq(mediaFiles.id, row.id))
        .run()
    }
    else if (!exists && row.state === 'present') {
      missing++
      getDb()
        .update(mediaFiles)
        .set({ state: 'missing', missingSince: new Date() })
        .where(eq(mediaFiles.id, row.id))
        .run()
    }
  }

  if (missing)
    logFor('storage').warn({ count: missing }, 'Library files are missing')
}

/**
 * Ключ прогресса файла без тайтла (домашнее видео, «Без описания») в
 * `title_progress`: таблица та же, «Продолжить» каталога его пропускает
 */
export function fileProgressId(mediaFileId: string) {
  return `file:${mediaFileId}`
}

/** Файл библиотеки, который лежит на месте, и его путь на диске */
export function getMediaFile(id: string) {
  const found = getDb()
    .select({ file: mediaFiles, folder: libraryFolders })
    .from(mediaFiles)
    .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
    .where(and(eq(mediaFiles.id, id), eq(mediaFiles.state, 'present')))
    .get()

  return found && { ...found, path: absolutePathOf(found.folder, found.file) }
}

/** Качество по размеру кадра: «2160p», «1080p»; без пробы — `null` */
export function qualityOf(probe: MediaFile['probe']) {
  const video = probe?.video

  if (!video?.width || !video.height)
    return null

  // Ширина надёжнее высоты: у широкоэкранных фильмов кадр 1920×800
  if (video.width >= 3200)
    return '2160p'

  if (video.width >= 1800)
    return '1080p'

  if (video.width >= 1200)
    return '720p'

  // Ниже HD — SD: высота кадра у широкоэкранного (1024×436) ничего не говорит
  return video.width >= 640 ? '480p' : `${video.height}p`
}

/** Файлы библиотеки тайтла, что лежат на месте: фильм и серии по порядку */
export function titleLibraryFiles(titleId: string, folders?: string[]) {
  return getDb()
    .select()
    .from(mediaFiles)
    .where(
      and(
        eq(mediaFiles.titleId, titleId),
        eq(mediaFiles.state, 'present'),
        folders ? inArray(mediaFiles.folderId, folders) : undefined,
      ),
    )
    .orderBy(mediaFiles.season, mediaFiles.episode, desc(mediaFiles.addedAt))
    .all()
}
