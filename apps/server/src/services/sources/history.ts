import type { TitleProgress } from '../../db/schema.ts'
import { freezePlayedSource } from './playedSource.ts'
import { stat } from 'node:fs/promises'
import { parseRelease, videoClassOf } from '@torsher/release-parser'
import {
  playableMediaFile,
  unavailableTorrentFiles,
} from '../library/folders.ts'
import { storedProbeMatches } from '../library/playedSource.ts'
import { getTorrent } from '../torrents/index.ts'

/** Factual last-file metadata, independent of a season's remembered source. */
export async function historySource(row: TitleProgress) {
  const source = freezePlayedSource(row) ?? { kind: 'unknown' as const }
  if (source.kind === 'unknown')
    return null
  let torrentId: string | null = null
  let quality = source.quality
  if (source.kind === 'library') {
    const found = playableMediaFile(source.mediaFileId, row.profileId)
    const info = found && (await stat(found.path).catch(() => undefined))
    if (!found || !info?.isFile())
      return null
    // Legacy rows still read their current file; a saved snapshot never takes
    // metadata from replacement bytes under the same media ID.
    if (row.playedSource === null && !storedProbeMatches(found.file, info)) {
      const parsed = parseRelease(found.file.relPath.split('/').pop()!).quality
      quality = parsed ? videoClassOf(parsed) : null
    }
  }
  else {
    const torrent = getTorrent(source.torrentId)
    const file = torrent?.files?.[source.fileIndex]
    if (
      !torrent
      || torrent.status === 'failed'
      || !file
      || file.padding
      || unavailableTorrentFiles(row.profileId, torrent.id).has(source.fileIndex)
    ) {
      return null
    }
    torrentId = torrent.id
  }
  return { torrentId, quality, voice: source.voice }
}
