import type {
  Follow,
  FollowDecision,
  FollowEpisode,
  FollowHistoryRow,
} from '../../db/schema.ts'
import type {
  FollowActivityItem,
  FollowCandidate,
  FollowQueueItem,
} from '../../dto/follow.ts'
import type { HistoryQuery } from './history.ts'
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, followHistory, follows } from '../../db/schema.ts'
import { listIndexers } from '../indexers/index.ts'
import { getTorrent, liveTorrents } from '../torrents/index.ts'
import {
  blockedPart,
  blockedReleases,
  blockRelease,
  listingsOf,
} from './blocklist.ts'
import { listHistory, recordHistory } from './history.ts'
import { followById } from './index.ts'
import { episodeKey } from './wanted.ts'

function episodeRows(followId: string) {
  return getDb()
    .select()
    .from(followEpisodes)
    .where(eq(followEpisodes.followId, followId))
    .all()
}

/** Снимок кандидатов серии: что нашли и почему отклонили */
export function followCandidates(
  followId: string,
  season: number,
  episode: number,
  now = new Date(),
): { firstSeenAt: string | null, items: FollowCandidate[] } {
  const row = getDb()
    .select()
    .from(followEpisodes)
    .where(
      and(
        eq(followEpisodes.followId, followId),
        eq(followEpisodes.season, season),
        eq(followEpisodes.episode, episode),
      ),
    )
    .get()
  const follow = followById(followId)
  const blocked = follow && blockedReleases(follow.titleId, now)
  const key = episodeKey({ season, episode })

  return {
    firstSeenAt: row?.firstSeenAt.toISOString() ?? null,
    items: (row?.decisions ?? []).map(({ sources, ...item }) => {
      const part
        = blocked && blockedPart(decisionRelease(item, sources), blocked)

      return {
        ...item,
        blocked: part !== undefined && (part === null || part.has(key)),
      }
    }),
  }
}

/** Записи «похоже, не уверены» без ответа владельца по слежениям */
export function unsureCounts(followId?: string) {
  const counts = new Map<string, number>()
  const rows = getDb()
    .select({ followId: followHistory.followId, params: followHistory.params })
    .from(followHistory)
    .where(
      and(
        eq(followHistory.kind, 'unsure'),
        followId ? eq(followHistory.followId, followId) : undefined,
      ),
    )
    .all()

  for (const row of rows) {
    if (!row.followId || row.params.confirmedAt || row.params.dismissedAt)
      continue

    counts.set(row.followId, (counts.get(row.followId) ?? 0) + 1)
  }

  return counts
}

/** «Не он»: запись больше не требует внимания, алиас не запоминается */
export function dismissUnsure(historyId: string, now = new Date()) {
  const row = getDb()
    .select()
    .from(followHistory)
    .where(
      and(eq(followHistory.id, historyId), eq(followHistory.kind, 'unsure')),
    )
    .get()

  if (!row)
    return false

  getDb()
    .update(followHistory)
    .set({ params: { ...row.params, dismissedAt: now.toISOString() } })
    .where(eq(followHistory.id, row.id))
    .run()
  return true
}

/**
 * Параметры события для панели: кандидат «похоже» хранит ссылку на раздачу
 * (шифртекстом) и magnet — наружу они не уходят
 */
function publicParams(params: Record<string, unknown>) {
  const { candidate: _candidate, ...rest } = params

  return rest
}

/** Лента «Активности» с именами индексаторов, которые ещё есть */
export function followActivity(query: HistoryQuery) {
  const { rows, hasMore } = listHistory(query)
  const names = new Map(listIndexers().map(item => [item.id, item.name]))

  return {
    items: rows.map((row: FollowHistoryRow): FollowActivityItem => ({
      id: row.id,
      at: row.at.toISOString(),
      kind: row.kind,
      followId: row.followId,
      titleId: row.titleId,
      season: row.season,
      episodes: row.episodes ?? [],
      releaseTitle: row.releaseTitle,
      indexer: (row.indexerId && names.get(row.indexerId)) || null,
      torrentId: row.torrentId,
      params: publicParams(row.params),
    })),
    hasMore,
  }
}

type QueueKind = FollowQueueItem['kind']

const QUEUE_ORDER: Record<QueueKind, number> = {
  no_space: 0,
  downloading: 1,
  pending: 2,
}

/** Чего ждёт отложенный кандидат: параметры отказа `wait` из снимка */
function waitFor(row: FollowEpisode) {
  const decision = row.decisions?.find(
    item => item.verdict === 'pending' && item.id === row.pending?.id,
  )
  const params = decision?.rejections.find(
    item => item.code === 'wait',
  )?.params

  if (!params)
    return undefined

  const pick = (key: string) =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined

  return {
    studio: pick('studio'),
    voiceType: pick('voiceType'),
    quality: pick('quality'),
  }
}

/**
 * Очередь «Следить» вычисляется: отложенные до конца окна, закачки автоматики,
 * которые ещё не легли в библиотеку, и захваты, ждущие места. Серии одного
 * кандидата — одной строкой.
 */
export async function followQueue(): Promise<FollowQueueItem[]> {
  const rows = getDb()
    .select({ episode: followEpisodes, follow: follows })
    .from(followEpisodes)
    .innerJoin(follows, eq(follows.id, followEpisodes.followId))
    .where(
      and(
        inArray(follows.state, ['active', 'paused']),
        or(
          and(
            isNotNull(followEpisodes.pending),
            isNull(followEpisodes.torrentId),
          ),
          and(
            isNotNull(followEpisodes.torrentId),
            isNull(followEpisodes.downloadedAt),
          ),
        ),
      ),
    )
    .all()
  const items = new Map<
    string,
    FollowQueueItem & { files: number[], follow: Follow }
  >()

  for (const { episode: row, follow } of rows) {
    const kind: QueueKind = row.torrentId
      ? 'downloading'
      : row.stateNote === 'no_space'
        ? 'no_space'
        : 'pending'

    if (kind === 'pending' && !row.waitUntil)
      continue

    const source = row.torrentId ?? row.pending!.id
    const key = `${kind}:${follow.id}:${row.season}:${source}`
    const item = items.get(key)

    if (item) {
      item.episodes.push(row.episode)

      if (row.fileIndex !== null)
        item.files.push(row.fileIndex)

      continue
    }

    const torrent = row.torrentId ? getTorrent(row.torrentId) : undefined

    items.set(key, {
      kind,
      followId: follow.id,
      titleId: follow.titleId,
      followState: follow.state,
      season: row.season,
      episodes: [row.episode],
      releaseTitle: torrent?.name ?? row.pending?.title ?? '',
      ...(kind === 'pending' && {
        until: row.waitUntil!.toISOString(),
        waitFor: waitFor(row),
      }),
      ...(kind !== 'downloading' && { size: row.pending?.size }),
      ...(torrent && {
        torrentId: torrent.id,
        resolving: torrent.status === 'resolving',
      }),
      files: row.fileIndex === null ? [] : [row.fileIndex],
      follow,
    })
  }

  const live = [...items.values()].some(item => item.kind === 'downloading')
    ? await liveTorrents()
    : undefined

  return [...items.values()]
    .map(({ files, follow: _follow, ...item }) => {
      if (item.kind !== 'downloading' || !item.torrentId)
        return item

      const torrent = getTorrent(item.torrentId)
      const state = torrent && live?.get(torrent.infoHash)
      const total = files.reduce(
        (sum, index) => sum + (torrent?.files?.[index]?.size ?? 0),
        0,
      )
      const done = files.reduce(
        (sum, index) => sum + (state?.fileProgress[index] ?? 0),
        0,
      )

      return {
        ...item,
        size: total || undefined,
        progress: state && total ? Math.min(1, done / total) : null,
      }
    })
    .sort(
      (a, b) =>
        QUEUE_ORDER[a.kind] - QUEUE_ORDER[b.kind]
        || (a.until ?? '').localeCompare(b.until ?? '')
        || a.season - b.season
        || a.episodes[0]! - b.episodes[0]!,
    )
}

/** Кандидат снимка как раздача для сверки с чёрным списком */
function decisionRelease(
  decision: Omit<FollowDecision, 'sources'>,
  sources: FollowDecision['sources'],
) {
  return {
    infoHash: decision.infoHash,
    title: decision.title,
    size: decision.size,
    indexers: sources ?? [],
  }
}

type BlockFromSnapshot = 'blocked' | 'not_found' | 'release_unknown'

/**
 * «Не брать эту раздачу» из снимка кандидатов: чёрный список навсегда,
 * отложенный кандидат и выбор режима `notify` снимаются, в снимке — отказ
 * `blocklisted`. Раздача без infohash запрещается по её показам у
 * индексаторов. Поиск не запускается: следующий прогон возьмёт другую. `not_found` — слежения нет или кандидата
 * нет в его снимке; `release_unknown` — у кандидата без infohash снимок
 * прежней версии без показов.
 */
export function blockFromSnapshot(
  followId: string,
  candidateId: string,
): BlockFromSnapshot {
  const follow = followById(followId)

  if (!follow)
    return 'not_found'

  const rows = episodeRows(follow.id).filter(row =>
    row.decisions?.some(item => item.id === candidateId),
  )
  const decision = rows[0]?.decisions?.find(item => item.id === candidateId)

  if (!decision)
    return 'not_found'

  const release = decisionRelease(decision, decision.sources)

  if (!release.infoHash && !release.indexers.length)
    return 'release_unknown'

  if (blockedPart(release, blockedReleases(follow.titleId)) === null)
    return 'blocked'

  const db = getDb()

  db.transaction((tx) => {
    blockRelease({
      titleId: follow.titleId,
      infoHash: release.infoHash,
      releaseTitle: decision.title,
      reason: 'user',
      ...(!release.infoHash && { listings: listingsOf(release) }),
    })

    for (const row of rows) {
      const dropPending = !row.torrentId && row.pending?.id === candidateId
      // Выбор не скачан: серия снова нужная и найдёт другую раздачу
      const dropPick = row.picked?.id === candidateId

      tx.update(followEpisodes)
        .set({
          decisions: row.decisions!.map(item =>
            item.id === candidateId
              ? {
                  ...item,
                  verdict: 'rejected' as const,
                  rejections: item.rejections.some(
                    rejection => rejection.code === 'blocklisted',
                  )
                    ? item.rejections
                    : [
                        ...item.rejections,
                        { code: 'blocklisted', type: 'permanent' as const },
                      ],
                }
              : item,
          ),
          ...(dropPending && {
            pending: null,
            waitUntil: null,
            stateNote: null,
          }),
          ...(dropPick && { picked: null, pickedAt: null }),
        })
        .where(
          and(
            eq(followEpisodes.followId, follow.id),
            eq(followEpisodes.season, row.season),
            eq(followEpisodes.episode, row.episode),
          ),
        )
        .run()
    }

    // Планировщик посмотрит слежение заново: отложенного кандидата могло не стать
    tx.update(follows)
      .set({ nextSearchAt: null })
      .where(eq(follows.id, follow.id))
      .run()

    for (const season of new Set(rows.map(row => row.season))) {
      recordHistory({
        followId: follow.id,
        titleId: follow.titleId,
        kind: 'blocklisted',
        season,
        episodes: rows
          .filter(row => row.season === season)
          .map(row => row.episode),
        releaseTitle: decision.title,
        params: { reason: 'user' },
      })
    }
  })

  return 'blocked'
}
