import type { ReleaseCard } from '../../dto/home.ts'
import type { Torrent } from '../../db/schema.ts'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import { cardOf, summariesOf } from '../mine/cards.ts'
import { headOf, namesOf } from './recognize.ts'

const ROW_LIMIT = 20

/**
 * Что из раздачи скачано: выбранные видео, без выбора — все. Сезоны — по
 * номерам в именах файлов, иначе из имени раздачи.
 */
function summaryOf(torrent: Pick<Torrent, 'name' | 'files' | 'selectedFiles'>) {
  const entries = (torrent.files ?? []).map((file, index) => ({
    ...file,
    index,
  }))
  const parsed = parseRelease(torrent.name)
  const matches = matchFiles(
    entries.map(({ path, size }) => ({ path, size })),
    parsed,
  )
  const videos = entries.flatMap((file, i) =>
    !file.padding && matches[i]?.kind === 'video'
      ? [{ ...file, season: matches[i].season }]
      : [],
  )
  const selected = new Set(torrent.selectedFiles ?? [])
  const chosen = selected.size
    ? videos.filter(file => selected.has(file.index))
    : videos
  const seasons = new Set(
    chosen.flatMap(file => (file.season === undefined ? [] : [file.season])),
  )

  return {
    seasons: [...(seasons.size ? seasons : parsed.seasons)].sort(
      (a, b) => a - b,
    ),
    videos: chosen.length,
    size: chosen.reduce((sum, file) => sum + file.size, 0),
  }
}

/** Название для поиска тайтла: из имени раздачи и без подзаголовка */
function queryOf(name: string) {
  const first = namesOf(parseRelease(name))[0]

  return first ? (headOf(first) ?? first) : name
}

/**
 * Скачанные раздачи, которые сервер не узнал: «похоже» — первыми, внутри —
 * новые выше. Раздачи без выбора, «не фильм» и ещё не проверенные сюда не
 * попадают.
 */
export async function unmatchedReleases(
  language: string,
): Promise<ReleaseCard[]> {
  const rows = getDb()
    .select()
    .from(torrents)
    .where(
      and(
        isNull(torrents.titleId),
        eq(torrents.retention, 'keep'),
        eq(torrents.status, 'ready'),
        inArray(torrents.matchStatus, ['unsure', 'unmatched']),
      ),
    )
    .orderBy(desc(torrents.addedAt))
    .all()
    .sort(
      (a, b) =>
        Number(b.matchStatus === 'unsure') - Number(a.matchStatus === 'unsure'),
    )
    .slice(0, ROW_LIMIT)
  const suggestions = await summariesOf(
    rows.map(row => row.matchSuggestion ?? ''),
    language,
  )

  return rows.map((row, i) => {
    const details = row.matchSuggestion ? suggestions[i]?.details : undefined

    return {
      torrentId: row.id,
      name: row.name,
      matchStatus: row.matchStatus as ReleaseCard['matchStatus'],
      suggestion: details ? cardOf(details) : null,
      image: details?.backdrop,
      query: queryOf(row.name),
      ...summaryOf(row),
    }
  })
}
