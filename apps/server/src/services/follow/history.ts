import type { FollowHistoryKind } from '../../db/schema.ts'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followHistory } from '../../db/schema.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const KEEP_DAYS = 90
const KEEP_ROWS = 5000

export interface HistoryEvent {
  /** Пусто у событий индексатора (`gap`) */
  followId?: string
  titleId?: string
  kind: FollowHistoryKind
  season?: number
  episodes?: number[]
  releaseTitle?: string
  indexerId?: string
  torrentId?: string
  /** Для текста события: студия, качество, срок, сколько нашли */
  params?: Record<string, unknown>
}

/** Пишется только смена состояния, а не каждый прогон */
export function recordHistory(event: HistoryEvent, at = new Date()) {
  getDb()
    .insert(followHistory)
    .values({
      followId: event.followId ?? null,
      titleId: event.titleId ?? null,
      at,
      kind: event.kind,
      season: event.season ?? null,
      episodes: event.episodes ?? null,
      releaseTitle: event.releaseTitle ?? null,
      indexerId: event.indexerId ?? null,
      torrentId: event.torrentId ?? null,
      params: event.params ?? {},
    })
    .run()
}

/** История слежения, свежие сверху */
export function followHistoryOf(followId: string, limit = 100) {
  return getDb()
    .select()
    .from(followHistory)
    .where(eq(followHistory.followId, followId))
    .orderBy(desc(followHistory.at))
    .limit(limit)
    .all()
}

/** Серии слежения, о которых уже было событие этого вида (`season:episode`) */
export function reportedEpisodes(followId: string, kind: FollowHistoryKind) {
  const keys = new Set<string>()
  const rows = getDb()
    .select({ season: followHistory.season, episodes: followHistory.episodes })
    .from(followHistory)
    .where(
      and(eq(followHistory.followId, followId), eq(followHistory.kind, kind)),
    )
    .all()

  for (const row of rows) {
    for (const episode of row.episodes ?? [])
      keys.add(`${row.season ?? 0}:${episode}`)
  }

  return keys
}

/** Не старше 90 дней и не больше 5000 строк */
export function purgeHistory(now = new Date()) {
  const db = getDb()

  db.delete(followHistory)
    .where(lt(followHistory.at, new Date(now.getTime() - KEEP_DAYS * DAY_MS)))
    .run()

  db.run(sql`
    DELETE FROM ${followHistory} WHERE ${followHistory.id} NOT IN (
      SELECT ${followHistory.id} FROM ${followHistory}
      ORDER BY ${followHistory.at} DESC LIMIT ${KEEP_ROWS}
    )
  `)
}
