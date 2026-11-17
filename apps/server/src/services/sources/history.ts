import type { TitleProgress } from '../../db/schema.ts'
import type { VideoClass, VoiceType } from '@torsher/release-parser'
import { stat } from 'node:fs/promises'
import {
  frameResolution,
  parseRelease,
  videoClassOf,
} from '@torsher/release-parser'
import {
  playableMediaFile,
  unavailableTorrentFiles,
} from '../library/folders.ts'
import { peekMediaProbe } from '../media/probe.ts'
import { getTorrent } from '../torrents/index.ts'

/** Factual last-file metadata, independent of a season's remembered source. */
export async function historySource(row: TitleProgress) {
  let quality: VideoClass | null = null
  let torrentId: string | null = null
  let path: string | undefined
  let video: { width: number | null, height: number | null } | null | undefined
  if (row.mediaFileId) {
    const found = playableMediaFile(row.mediaFileId, row.profileId)
    const info = found && (await stat(found.path).catch(() => undefined))
    if (!found || !info?.isFile())
      return null
    path = found.path
    if (found.file.probeKey === `${info.size}:${info.mtimeMs}`)
      video = found.file.probe?.video
  }
  else if (row.torrentId && row.fileIndex !== null) {
    const torrent = getTorrent(row.torrentId)
    const file = torrent?.files?.[row.fileIndex]
    if (
      !torrent
      || torrent.status === 'failed'
      || !file
      || file.padding
      || unavailableTorrentFiles(row.profileId, torrent.id).has(row.fileIndex)
    ) {
      return null
    }
    torrentId = torrent.id
    path = file.path
    video = peekMediaProbe(`${torrent.infoHash}:${row.fileIndex}`)?.video
  }
  else {
    return null
  }
  if (video?.width && video.height && video.width > 0 && video.height > 0) {
    quality = videoClassOf(frameResolution(video.width, video.height))
  }
  else {
    // Parent folders and torrent names may describe a different episode.
    const parsed = parseRelease(path.split('/').pop()!).quality
    if (parsed)
      quality = videoClassOf(parsed)
  }
  return {
    torrentId,
    quality,
    voice:
      row.voiceStudio || row.voiceType
        ? {
            studio: row.voiceStudio ?? undefined,
            type: (row.voiceType as VoiceType | null) ?? undefined,
          }
        : null,
  }
}
