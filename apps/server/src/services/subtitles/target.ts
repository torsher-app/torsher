import type { Torrent } from '../../db/schema.ts'
import type { PlaybackSession } from '../media/sessions.ts'
import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { getMediaFile } from '../library/files.ts'
import { folderWithLibrary } from '../library/folders.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { getTorrent } from '../torrents/index.ts'

type LibraryFile = NonNullable<ReturnType<typeof getMediaFile>>

export interface SubtitleTarget {
  type: 'movie' | 'tv'
  tmdbId: number
  season?: number
  episode?: number
  release: string
  /** Только полностью доступный локальный видеофайл. */
  hashPath?: string
  library?: { id: string, path: string, managed: boolean }
}

export function subtitleTargetOfLibrary(
  found: LibraryFile,
): SubtitleTarget | undefined {
  const { file, path } = found
  const folder = folderWithLibrary(file.folderId)
  const identity = file.titleId && parseCatalogId(file.titleId)
  if (
    !identity
    || !file.titleId
    || !folder
    || folder.library.kind !== 'video'
    || found.folder.status !== 'ok'
    || file.matchStatus !== 'matched'
  ) {
    return undefined
  }
  if (
    identity.type === 'tv'
    && (file.season === null
      || file.episode === null
      || file.episode < 1
      || (file.episodeTo !== null && file.episodeTo !== file.episode))
  ) {
    return undefined
  }
  const torrent
    = file.torrentId && file.fileIndex !== null
      ? getTorrent(file.torrentId)
      : undefined
  const origin
    = torrent && file.fileIndex !== null
      ? torrent.files?.[file.fileIndex]
      : undefined
  if (identity.type === 'tv' && file.matchSource === 'torrent') {
    const verified
      = torrent && file.fileIndex !== null
        ? subtitleTargetOfTorrent(torrent, file.fileIndex)
        : undefined
    if (
      !verified
      || verified.season !== file.season
      || verified.episode !== file.episode
    ) {
      return undefined
    }
  }
  return {
    ...identity,
    season: identity.type === 'tv' ? file.season! : undefined,
    episode: identity.type === 'tv' ? file.episode! : undefined,
    release: basename(origin?.path ?? file.relPath),
    hashPath: path,
    library: { id: file.id, path, managed: folder.library.managed },
  }
}

function subtitleTargetOfTorrent(
  torrent: Torrent,
  fileIndex: number,
): SubtitleTarget | undefined {
  const identity = torrent.titleId && parseCatalogId(torrent.titleId)
  if (
    !identity
    || torrent.matchStatus === 'unsure'
    || torrent.matchStatus === 'ignored'
    || torrent.matchStatus === 'unmatched'
  ) {
    return undefined
  }
  const files = (torrent.files ?? [])
    .map((file, index) => ({ ...file, index }))
    .filter(file => !file.padding)
  const index = files.findIndex(file => file.index === fileIndex)
  if (index < 0)
    return undefined

  const parsed = parseRelease(torrent.name)
  const matches = matchFiles(files, parsed)
  const file = matches[index]
  if (file?.kind !== 'video')
    return undefined
  if (identity.type === 'movie') {
    if (matches.filter(file => file.kind === 'video').length !== 1)
      return undefined
    return { ...identity, release: basename(file.path) }
  }

  const season
    = file.season
      ?? (parsed.seasons.length === 1 ? parsed.seasons[0] : undefined)
  if (
    season === undefined
    || !file.episode
    || file.episodeTo
    || file.absolute !== undefined
    || (file.confidence ?? 0) < 0.7
  ) {
    return undefined
  }
  return {
    ...identity,
    season,
    episode: file.episode,
    release: basename(file.path),
  }
}

/** Цель подтверждает текущая запись источника, а не requestedTitle из плеера. */
export function subtitleTarget(session: PlaybackSession) {
  if (session.library) {
    const found = getMediaFile(session.library.id)
    return found?.path === session.library.path
      ? subtitleTargetOfLibrary(found)
      : undefined
  }
  const torrent = session.torrent && getTorrent(session.torrent.id)
  return torrent && torrent.infoHash === session.torrent?.infoHash
    ? subtitleTargetOfTorrent(torrent, session.fileIndex)
    : undefined
}

const HASH_CHUNK = 65536

export async function openSubtitlesHash(path: string | undefined) {
  if (!path)
    return undefined
  const handle = await open(path, 'r').catch(() => undefined)
  if (!handle)
    return undefined
  try {
    const { size } = await handle.stat()
    if (size < 2 * HASH_CHUNK)
      return undefined
    const chunk = Buffer.allocUnsafe(HASH_CHUNK)
    let hash = BigInt(size)
    for (const position of [0, size - HASH_CHUNK]) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (bytesRead !== HASH_CHUNK)
        return undefined
      for (let i = 0; i < HASH_CHUNK; i += 8) hash += chunk.readBigUInt64LE(i)
    }
    return BigInt.asUintN(64, hash).toString(16).padStart(16, '0')
  }
  catch {
    return undefined
  }
  finally {
    await handle.close()
  }
}

function releaseKey(release: string) {
  return release
    .replace(/\.(?:mkv|mp4|avi|webm|mov|srt)$/i, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s._-]+/g, ' ')
    .trim()
}

export function exactSubtitleRelease(expected: string, release: string) {
  const key = releaseKey(expected)
  // Простое название файла не доказывает совпадение монтажа.
  return (
    /\b(?:[4578]\d{2}p|1080[pi]|1440p|2160p|bluray|web[- .]?dl|webrip|dvdrip|hdtv)\b/i.test(
      expected,
    ) && key === releaseKey(release)
  )
}

export function sameSubtitleTarget(
  a: SubtitleTarget,
  b: SubtitleTarget | undefined,
) {
  return (
    !!b
    && a.type === b.type
    && a.tmdbId === b.tmdbId
    && a.season === b.season
    && a.episode === b.episode
    && a.release === b.release
    && a.library?.path === b.library?.path
  )
}
