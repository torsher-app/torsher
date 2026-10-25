import type { Follow, FollowEpisode } from '../../db/schema.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import { and, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes } from '../../db/schema.ts'
import {
  downloadFiles,
  getTorrent,
  isVideoFile,
  setRetention,
} from '../torrents/index.ts'
import { blockRelease } from './blocklist.ts'
import { resetEpisodes } from './grab.ts'
import { recordHistory } from './history.ts'
import { requestFollowSearch } from './search.ts'

// Раздача автоматики без прироста столько времени — зависла: пиры с данными
// ушли или их не было (у Cinephage — бан зависшего на срок)
export const STALL_AFTER_MS = 6 * 60 * 60 * 1000

interface Progress {
  completed: number
  since: number
}

// После перезапуска сервера счёт начинается заново: лучше подождать лишние
// часы, чем забанить раздачу, которая качалась до остановки
const progress = new Map<string, Progress>()

/**
 * С какого момента выбор раздачи не растёт. Пауза, очередь движка и
 * докачанный выбор — не зависание: счёт сбрасывается.
 */
export function stalledSince(
  infoHash: string,
  live: EngineTorrentState | undefined,
  now: number,
) {
  const waiting
    = !live
      || live.paused
      || live.queued
      || live.bytesWanted === 0
      || live.wantedCompleted >= live.bytesWanted

  if (waiting) {
    progress.delete(infoHash)
    return undefined
  }

  const known = progress.get(infoHash)

  if (!known || live.wantedCompleted > known.completed) {
    progress.set(infoHash, { completed: live.wantedCompleted, since: now })
    return now
  }

  return known.since
}

function grabbedRows() {
  return getDb()
    .select()
    .from(followEpisodes)
    .where(
      and(
        isNotNull(followEpisodes.torrentId),
        isNotNull(followEpisodes.fileIndex),
        isNull(followEpisodes.downloadedAt),
      ),
    )
    .all()
}

/** Есть закачки автоматики, которые ещё не легли в библиотеку */
export function hasActiveGrabs() {
  return grabbedRows().length > 0
}

/** Снимает с раздачи выбор файлов автоматики; чужой выбор остаётся */
async function deselect(torrentId: string, files: Set<number>) {
  const torrent = getTorrent(torrentId)

  if (!torrent)
    return

  const rest = (torrent.selectedFiles ?? []).filter(
    index =>
      !files.has(index) && isVideoFile(torrent.files?.[index]?.path ?? ''),
  )

  if (rest.length)
    await downloadFiles(torrent, rest)
  else await setRetention(torrent, 'cache')
}

/**
 * Зависшие закачки автоматики: раздача — в чёрный список на 7 дней, выбор
 * файлов снимается, серии снова нужные, слежению — целевой поиск.
 */
export async function checkStalled(
  live: Map<string, EngineTorrentState>,
  followOf: (id: string) => Follow | undefined,
  now = Date.now(),
) {
  const byTorrent = new Map<string, FollowEpisode[]>()

  for (const row of grabbedRows()) {
    const list = byTorrent.get(row.torrentId!) ?? []

    list.push(row)
    byTorrent.set(row.torrentId!, list)
  }

  for (const [torrentId, rows] of byTorrent) {
    const torrent = getTorrent(torrentId)

    if (!torrent)
      continue

    const since = stalledSince(
      torrent.infoHash,
      live.get(torrent.infoHash),
      now,
    )

    if (since === undefined || now - since < STALL_AFTER_MS)
      continue

    progress.delete(torrent.infoHash)
    blockRelease(
      {
        titleId: torrent.titleId ?? '',
        infoHash: torrent.infoHash,
        releaseTitle: torrent.name,
        reason: 'stalled',
      },
      new Date(now),
    )
    await deselect(torrentId, new Set(rows.map(row => row.fileIndex!)))

    for (const followId of new Set(rows.map(row => row.followId))) {
      const follow = followOf(followId)

      if (!follow)
        continue

      const episodes = rows.filter(row => row.followId === followId)

      resetEpisodes(follow, episodes)

      for (const season of new Set(episodes.map(row => row.season))) {
        recordHistory(
          {
            followId,
            titleId: follow.titleId,
            kind: 'failed',
            season,
            episodes: episodes
              .filter(row => row.season === season)
              .map(row => row.episode),
            releaseTitle: torrent.name,
            torrentId,
            params: { reason: 'stalled' },
          },
          new Date(now),
        )
      }

      requestFollowSearch(followId, 'retry')
    }
  }
}

export function resetStallTracking() {
  progress.clear()
}
