import { stat } from 'node:fs/promises'
import { and, desc, eq } from 'drizzle-orm'
import type { Continuation } from '../../dto/titles.ts'
import type { TitleProgress } from '../../db/schema.ts'
import { getDb } from '../../db/index.ts'
import { titleProgress } from '../../db/schema.ts'
import {
  playableMediaFile,
  unavailableTorrentFiles,
} from '../library/folders.ts'
import { peekMediaProbe } from '../media/probe.ts'
import { getTorrent } from '../torrents/index.ts'
import { episodeFileIn } from './resume.ts'
import { hasProgress } from './progress.ts'

export function meaningfulProgress(
  row: Pick<TitleProgress, 'position' | 'duration' | 'watchedAt'>,
) {
  return (
    row.watchedAt !== null
    || (row.duration !== null
      && row.duration > 0
      && row.position / row.duration >= 0.05)
  )
}

/** Separate read-only preference; factual history and remembered voice remain unchanged. */
export async function continuationFor(
  profileId: string,
  titleId: string,
  target: { season: number, episode: number },
): Promise<Continuation> {
  const rows = getDb()
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        eq(titleProgress.titleId, titleId),
      ),
    )
    .orderBy(desc(titleProgress.updatedAt))
    .all()
    .filter(hasProgress)
  // Memoize exact files within this projection; stop as soon as the needed
  // available candidates are found, rather than stat every historical file.
  const libraryFiles = new Map<string, ReturnType<typeof libraryFile>>()
  async function libraryFile(id: string) {
    const found = playableMediaFile(id, profileId)
    if (!found)
      return undefined
    const info = await stat(found.path).catch(() => undefined)
    return info?.isFile() ? { found, info } : undefined
  }
  function library(id: string) {
    if (!libraryFiles.has(id))
      libraryFiles.set(id, libraryFile(id))
    return libraryFiles.get(id)!
  }
  const torrentFiles = new Map<string, boolean>()
  const torrentRows = new Map<string, ReturnType<typeof getTorrent>>()
  const blockedFiles = new Map<string, Set<number>>()
  function torrent(id: string) {
    if (!torrentRows.has(id))
      torrentRows.set(id, getTorrent(id))
    return torrentRows.get(id)
  }
  async function available(row: TitleProgress) {
    if (row.mediaFileId)
      return !!(await library(row.mediaFileId))
    if (!row.torrentId || row.fileIndex === null)
      return false
    const key = `${row.torrentId}:${row.fileIndex}`
    if (!torrentFiles.has(key)) {
      const found = torrent(row.torrentId)
      if (!blockedFiles.has(row.torrentId)) {
        blockedFiles.set(
          row.torrentId,
          unavailableTorrentFiles(profileId, row.torrentId),
        )
      }
      torrentFiles.set(
        key,
        !!found
        && found.status === 'ready'
        && !!found.files?.[row.fileIndex]
        && !blockedFiles.get(row.torrentId)!.has(row.fileIndex),
      )
    }
    return torrentFiles.get(key)!
  }
  async function first(candidates: TitleProgress[]) {
    for (const row of candidates) {
      if (await available(row))
        return row
    }
    return undefined
  }
  const seasonRows = rows.filter(row => row.season === target.season)
  const meaningful = rows.filter(meaningfulProgress)
  const seasonMeaningful = await first(seasonRows.filter(meaningfulProgress))
  const preference = seasonMeaningful ?? (await first(seasonRows))
  const baseline
    = seasonMeaningful ?? (await first(meaningful)) ?? (await first(rows))
  const preferredTorrent = preference?.torrentId
    ? episodeFileIn(preference.torrentId, { profileId, titleId, ...target })
    : null
  if (!baseline)
    return { target, preferredTorrent, baseline: null }
  let video: NonNullable<Continuation['baseline']>['video'] = null
  const file: NonNullable<Continuation['baseline']>['file']
    = baseline.mediaFileId
      ? { kind: 'library', mediaFileId: baseline.mediaFileId }
      : {
          kind: 'torrent',
          torrentId: baseline.torrentId!,
          fileIndex: baseline.fileIndex!,
        }
  if (file.kind === 'library') {
    const current = await library(file.mediaFileId)
    if (
      current
      && current.found.file.probeKey
      === `${current.info.size}:${current.info.mtimeMs}`
    ) {
      const found = current.found
      const dimensions = found.file.probe?.video
      if (dimensions?.width && dimensions.height) {
        video = {
          width: dimensions.width,
          height: dimensions.height,
          basis: 'probe',
        }
      }
    }
  }
  else {
    const source = torrent(file.torrentId)
    const dimensions
      = source && peekMediaProbe(`${source.infoHash}:${file.fileIndex}`)?.video
    if (dimensions?.width && dimensions.height) {
      video = {
        width: dimensions.width,
        height: dimensions.height,
        basis: 'probe',
      }
    }
  }
  if (video && (!(video.width > 0) || !(video.height > 0)))
    video = null
  return { target, preferredTorrent, baseline: { file, video } }
}
