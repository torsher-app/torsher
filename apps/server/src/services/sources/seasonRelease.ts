import type { VideoClass, VoiceType } from '@torsher/release-parser'
import type { Torrent } from '../../db/schema.ts'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleProgress } from '../../db/schema.ts'
import {
  playableMediaFile,
  unavailableTorrentFiles,
} from '../library/folders.ts'
import { getTorrent, isVideoFile } from '../torrents/index.ts'
import { torrentResolution } from './resolution.ts'

/**
 * Раздача сезона — та, которой смотрели серию этого сезона последний раз; у
 * фильма — сезон 0. Из неё «Источники» показывают историю просмотра, а
 * `torrentId` в «Смотреть» запускает серию без поиска по индексаторам.
 */
export interface SeasonRelease {
  season: number
  torrent: Torrent
  quality?: VideoClass
  voice?: { studio?: string, type?: VoiceType }
  /** Серии сезона, файлы которых есть в раздаче */
  episodes: number[]
}

/** Серии сезона в раздаче — по именам файлов, как `pickFile` при просмотре */
export function episodesInTorrent(
  torrent: Torrent,
  season: number,
  blocked: Set<number>,
) {
  const parsed = parseRelease(torrent.name)
  const entries = (torrent.files ?? [])
    .map((file, index) => ({ ...file, index }))
    .filter(file => !file.padding)
  const found = new Set<number>()

  for (const [i, match] of matchFiles(entries, parsed).entries()) {
    if (
      match.kind !== 'video'
      || match.episode === undefined
      || blocked.has(entries[i]!.index)
    ) {
      continue
    }

    const fileSeason
      = match.season
        ?? (parsed.seasons.length === 1 ? parsed.seasons[0] : season)

    if (fileSeason !== season)
      continue

    for (
      let episode = match.episode;
      episode <= (match.episodeTo ?? match.episode);
      episode++
    )
      found.add(episode)
  }

  // Раздача одной серии с одним видео — эта серия, даже без номера в имени файла
  const videos = entries.filter(file => isVideoFile(file.path))
  const single
    = parsed.episodes?.from === parsed.episodes?.to
      ? parsed.episodes?.from
      : undefined

  if (
    found.size === 0
    && single !== undefined
    && videos.length === 1
    && !blocked.has(videos[0]!.index)
  ) {
    found.add(single)
  }

  return [...found].sort((a, b) => a - b)
}

export function seasonReleases(
  profileId: string,
  titleId: string,
): SeasonRelease[] {
  const rows = getDb()
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        eq(titleProgress.titleId, titleId),
        isNotNull(titleProgress.torrentId),
      ),
    )
    .orderBy(desc(titleProgress.updatedAt))
    .all()
  const seen = new Set<number>()
  const releases: SeasonRelease[] = []

  for (const row of rows) {
    if (seen.has(row.season))
      continue

    if (row.mediaFileId && !playableMediaFile(row.mediaFileId, profileId))
      continue

    const torrent = getTorrent(row.torrentId!)

    if (!torrent || torrent.status === 'failed')
      continue

    const blocked = unavailableTorrentFiles(profileId, torrent.id)
    if (row.fileIndex !== null && blocked.has(row.fileIndex))
      continue

    const episodes = episodesInTorrent(torrent, row.season, blocked)
    if (blocked.size && row.season && !episodes.length)
      continue

    seen.add(row.season)
    releases.push({
      season: row.season,
      torrent,
      quality: torrentResolution(torrent)?.value,
      voice:
        row.voiceStudio || row.voiceType
          ? {
              studio: row.voiceStudio ?? undefined,
              type: (row.voiceType as VoiceType | null) ?? undefined,
            }
          : undefined,
      episodes,
    })
  }

  return releases.sort((a, b) => a.season - b.season)
}
