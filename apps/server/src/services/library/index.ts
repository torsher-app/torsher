import { withMaintenanceLease } from '../libraryMaintenance/admission.ts'
import type { Torrent } from '../../db/schema.ts'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mediaFiles, torrents } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { getTorrent, setRetention } from '../torrents/index.ts'
import { managedFolders, torrentLibraryFiles } from './files.ts'
import { removeFile } from './link.ts'
import { syncLibrary } from './linker.ts'
import { rememberUserAlias } from './recognize.ts'
import { removeThumbs } from './thumbs.ts'

export {
  checkManagedFiles,
  fileProgressId,
  getMediaFile,
  libraryUsage,
  linkedBytesByTorrent,
  managedFolder,
  managedFolders,
  placedFilesByTorrent,
  qualityOf,
  titleLibraryFiles,
  torrentLibraryFiles,
} from './files.ts'
export type { LibraryUsage } from './files.ts'
export { checkLinkMode, currentLinkMode } from './link.ts'
export { syncLibrary } from './linker.ts'
export { queueUnprobed } from './probe.ts'
export {
  queueRecognition,
  recognitionIdle,
  recognizeRelease,
  startRecognition,
} from './recognize.ts'

/** Убирает файлы раздачи из своей раскладки и строки `media_files`; раздачу не трогает */
async function unplaceFiles(torrent: Torrent) {
  const folders = new Map(
    managedFolders().map(folder => [folder.id, folder]),
  )
  const files = torrentLibraryFiles(torrent.id).filter(file =>
    folders.has(file.folderId),
  )

  for (const file of files) {
    const folder = folders.get(file.folderId)!
    const absolute = join(folder.path, ...file.relPath.split('/'))
    const base = absolute.slice(0, absolute.lastIndexOf('.'))

    await removeFile(absolute, folder.path, `${base}.`)
    const deleted = getDb()
      .delete(mediaFiles)
      .where(eq(mediaFiles.id, file.id))
      .returning({ thumb: mediaFiles.thumb })
      .get()
    await removeThumbs([deleted?.thumb ?? null])
  }

  if (files.length) {
    logFor('storage').info(
      { torrentId: torrent.id, count: files.length },
      'Library files removed',
    )
  }
}

/**
 * Убирает файлы раздачи из своей раскладки вместе с субтитрами и дорожками
 * рядом. Раздача возвращается в кэш: она раздаётся, пока её не вытеснят, а
 * без движка файл в библиотеке был последней копией.
 */
async function removeFromLibraryImpl(torrent: Torrent) {
  await unplaceFiles(torrent)

  return torrent.retention === 'keep'
    ? setRetention(torrent, 'cache')
    : torrent
}
export function removeFromLibrary(
  ...args: Parameters<typeof removeFromLibraryImpl>
) {
  return withMaintenanceLease({ torrentId: args[0].id }, () =>
    removeFromLibraryImpl(...args))
}

/**
 * «Исправить совпадение»: тайтл раздачи выбрал владелец. Название раздачи
 * запоминается алиасом `user` — такое же название дальше узнаётся само.
 * Файлы, уже положенные под прежний тайтл, убираются и ложатся заново.
 * `null` — «не фильм и не сериал»: раздача остаётся без тайтла и в
 * библиотеку не попадает.
 */
async function setTorrentTitleImpl(torrent: Torrent, titleId: string | null) {
  // Файлы прежнего тайтла или из `other/` («не фильм») ложатся заново
  const placed = !!torrent.titleId || torrent.matchStatus === 'ignored'

  if (placed && torrent.titleId !== titleId)
    await unplaceFiles(torrent)

  getDb()
    .update(torrents)
    .set({
      titleId,
      matchStatus: titleId ? 'user' : 'ignored',
      matchSuggestion: null,
    })
    .where(eq(torrents.id, torrent.id))
    .run()

  if (titleId)
    rememberUserAlias(titleId, torrent.name)

  void syncLibrary()

  return getTorrent(torrent.id) ?? torrent
}
export function setTorrentTitle(
  ...args: Parameters<typeof setTorrentTitleImpl>
) {
  return withMaintenanceLease({ torrentId: args[0].id, titleId: args[1] }, () =>
    setTorrentTitleImpl(...args))
}
