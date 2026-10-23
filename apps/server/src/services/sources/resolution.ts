import type { VideoResolution } from '@torsher/release-parser'
import type { Torrent } from '../../db/schema.ts'
import type { FoundRelease } from './rank.ts'
import {
  frameResolution,
  parseRelease,
  videoClassOf,
} from '@torsher/release-parser'
import { isVideoFile, torrentsByInfoHash } from '../torrents/index.ts'

/**
 * Разрешение уже добавленной раздачи: кадр из пробы, иначе разрешение в имени
 * самого большого видеофайла, его папок или раздачи
 * («Show.S01.BDRip.1080p/Show.S01E02.mkv»). `undefined` — не узнать.
 */
export function torrentResolution(
  torrent: Torrent,
): VideoResolution | undefined {
  if (torrent.videoWidth && torrent.videoHeight) {
    return {
      value: videoClassOf(
        frameResolution(torrent.videoWidth, torrent.videoHeight),
      ),
      basis: 'probe',
      sure: true,
    }
  }

  const video = (torrent.files ?? [])
    .filter(file => !file.padding && isVideoFile(file.path))
    .sort((a, b) => b.size - a.size)[0]
  const names = [...(video?.path.split('/').reverse() ?? []), torrent.name]

  for (const name of names) {
    const quality = parseRelease(name).quality

    if (quality)
      return { value: videoClassOf(quality), basis: 'file', sure: true }
  }

  return undefined
}

/** Точные разрешения кандидатов, раздачи которых уже добавляли: по ID кандидата */
export function knownResolutions(releases: FoundRelease[]) {
  const hashes = releases
    .map(release => release.infoHash?.toLowerCase())
    .filter((hash): hash is string => !!hash)
  const torrents = torrentsByInfoHash([...new Set(hashes)])
  const known = new Map<string, VideoResolution>()

  for (const release of releases) {
    const torrent = release.infoHash
      ? torrents.get(release.infoHash.toLowerCase())
      : undefined
    const resolution = torrent && torrentResolution(torrent)

    if (resolution)
      known.set(release.id, resolution)
  }

  return known
}
