import { unresolvedOperations } from './admission.ts'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import type { MaintenanceEpisode, Torrent } from '../../db/schema.ts'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { maintenanceSuppressions } from '../../db/schema.ts'

export function suppressedEpisodes(titleId: string) {
  return new Set(
    getDb()
      .select()
      .from(maintenanceSuppressions)
      .where(eq(maintenanceSuppressions.titleId, titleId))
      .all()
      .map(row => `${row.season}:${row.episode}`),
  )
}

export function hasSuppressed(titleId: string, episodes: MaintenanceEpisode[]) {
  const suppressed = suppressedEpisodes(titleId)
  return episodes.some(item =>
    suppressed.has(`${item.season}:${item.episode}`),
  )
}

export function allowRedownload(
  titleId: string,
  episodes: MaintenanceEpisode[],
) {
  const pending = unresolvedOperations().some(
    op =>
      op.titleId === titleId
      && op.episodes.some(episode =>
        episodes.some(
          chosen =>
            chosen.season === episode.season
            && chosen.episode === episode.episode,
        ),
      ),
  )
  if (pending)
    return false
  const db = getDb()
  return db.transaction(() => {
    const rows = db
      .select()
      .from(maintenanceSuppressions)
      .where(eq(maintenanceSuppressions.titleId, titleId))
      .all()
    const chosen = new Set(
      episodes.map(item => `${item.season}:${item.episode}`),
    )
    if (
      rows.some(
        row =>
          chosen.has(`${row.season}:${row.episode}`)
          && row.status === 'pending',
      )
    ) {
      return false
    }
    for (const item of episodes) {
      db.delete(maintenanceSuppressions)
        .where(
          and(
            eq(maintenanceSuppressions.titleId, titleId),
            eq(maintenanceSuppressions.season, item.season),
            eq(maintenanceSuppressions.episode, item.episode),
          ),
        )
        .run()
    }
    return true
  })
}

/** Файл с несколькими сериями блокируется, если очищена хотя бы одна из них. */
export function suppressedFileIndexes(torrent: Torrent, title = torrent.name) {
  if (!torrent.titleId)
    return new Set<number>()
  const suppressed = suppressedEpisodes(torrent.titleId)
  if (!suppressed.size)
    return new Set<number>()
  const parsed = parseRelease(title)
  const entries = (torrent.files ?? [])
    .map((file, index) => ({ ...file, index }))
    .filter(file => !file.padding)
  const matches = matchFiles(entries, parsed)
  return new Set(
    entries.flatMap((file, i) => {
      const match = matches[i]
      if (match?.kind !== 'video')
        return []
      if (torrent.titleId!.startsWith('tmdb:movie:'))
        return suppressed.has('0:0') ? [file.index] : []
      const season
        = match.season
          ?? (parsed.seasons?.length === 1 ? parsed.seasons[0] : undefined)
      if (season === undefined || match.episode === undefined)
        return [file.index]
      for (
        let episode = match.episode;
        episode <= (match.episodeTo ?? match.episode);
        episode++
      ) {
        if (suppressed.has(`${season}:${episode}`))
          return [file.index]
      }
      return []
    }),
  )
}
