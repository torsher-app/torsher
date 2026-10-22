import type { Resolution, VoiceType } from '@torsher/release-parser'
import type { Torrent } from '../../db/schema.ts'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleProgress } from '../../db/schema.ts'
import { getTorrent, isVideoFile } from '../torrents/index.ts'

/**
 * Раздача сезона — та, которой смотрели серию этого сезона последний раз; у
 * фильма — сезон 0. Из неё «Источники» показывают историю просмотра, а
 * `torrentId` в «Смотреть» запускает серию без поиска по индексаторам.
 */
export interface SeasonRelease {
  season: number
  torrent: Torrent
  quality?: Resolution
  voice?: { studio?: string, type?: VoiceType }
  /** Серии сезона, файлы которых есть в раздаче */
  episodes: number[]
}

/** Серии сезона в раздаче — по именам файлов, как `pickFile` при просмотре */
export function episodesInTorrent(torrent: Torrent, season: number) {
  const parsed = parseRelease(torrent.name)
  const entries = (torrent.files ?? [])
    .filter(file => !file.padding)
    .map(({ path, size }) => ({ path, size }))
  const found = new Set<number>()

  for (const match of matchFiles(entries, parsed)) {
    if (match.kind !== 'video' || match.episode === undefined)
      continue

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

  if (found.size === 0 && single !== undefined && videos.length === 1)
    found.add(single)

  return [...found].sort((a, b) => a - b)
}

// В имени раздачи («Game of Thrones») качества бывает нет — тогда оно в имени
// видеофайла или его папки («Show.S01.BDRip.1080p/Show.S01E02.mkv»)
function qualityOf(torrent: Torrent) {
  const video = (torrent.files ?? []).find(file => isVideoFile(file.path))
  const names = [torrent.name, ...(video?.path.split('/').reverse() ?? [])]

  for (const name of names) {
    const quality = parseRelease(name).quality

    if (quality)
      return quality
  }

  return undefined
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

    seen.add(row.season)

    const torrent = getTorrent(row.torrentId!)

    if (!torrent || torrent.status === 'failed')
      continue

    releases.push({
      season: row.season,
      torrent,
      quality: qualityOf(torrent),
      voice:
        row.voiceStudio || row.voiceType
          ? {
              studio: row.voiceStudio ?? undefined,
              type: (row.voiceType as VoiceType | null) ?? undefined,
            }
          : undefined,
      episodes: episodesInTorrent(torrent, row.season),
    })
  }

  return releases.sort((a, b) => a.season - b.season)
}
