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
    getDb().delete(mediaFiles).where(eq(mediaFiles.id, file.id)).run()
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
export async function removeFromLibrary(torrent: Torrent) {
  await unplaceFiles(torrent)

  return torrent.retention === 'keep'
    ? setRetention(torrent, 'cache')
    : torrent
}

/**
 * «Исправить совпадение»: тайтл раздачи выбрал владелец. Название раздачи
 * запоминается алиасом `user` — такое же название дальше узнаётся само.
 * Файлы, уже положенные под прежний тайтл, убираются и ложатся заново.
 * `null` — «не фильм и не сериал»: раздача остаётся без тайтла и в
 * библиотеку не попадает.
 */
export async function setTorrentTitle(
  torrent: Torrent,
  titleId: string | null,
) {
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
