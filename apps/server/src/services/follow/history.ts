import type { FollowHistoryKind } from '../../db/schema.ts'
import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
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

export interface HistoryQuery {
  followId?: string
  kind?: FollowHistoryKind
  /** id последней показанной строки: порция старше неё */
  before?: string
  limit: number
}

/** Лента «Активности», свежие сверху; `hasMore` — есть строки старше порции */
export function listHistory(query: HistoryQuery) {
  const db = getDb()
  const cursor = query.before
    ? db
        .select({ at: followHistory.at, id: followHistory.id })
        .from(followHistory)
        .where(eq(followHistory.id, query.before))
        .get()
    : undefined
  const rows = db
    .select()
    .from(followHistory)
    .where(
      and(
        query.followId ? eq(followHistory.followId, query.followId) : undefined,
        query.kind ? eq(followHistory.kind, query.kind) : undefined,
        // Строки одного момента различает id: порции не теряют и не повторяют их
        cursor
          ? or(
              lt(followHistory.at, cursor.at),
              and(
                eq(followHistory.at, cursor.at),
                lt(followHistory.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(followHistory.at), desc(followHistory.id))
    .limit(query.limit + 1)
    .all()

  return {
    rows: rows.slice(0, query.limit),
    hasMore: rows.length > query.limit,
  }
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

/**
 * Не старше 90 дней и не больше 5000 строк. Последнее «не нашли» серии
 * слежения остаётся: по нему событие не повторяется, а без него владелец
 * получил бы его снова.
 */
export function purgeHistory(now = new Date()) {
  const db = getDb()
  const kept = sql`(
    ${followHistory.kind} = 'missing'
    AND ${followHistory.followId} IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ${followHistory} AS newer
      WHERE newer.follow_id = ${followHistory.followId}
        AND newer.kind = 'missing'
        AND newer.at > ${followHistory.at}
        AND newer.season IS ${followHistory.season}
        AND newer.episodes IS ${followHistory.episodes}
    )
  )`

  db.run(sql`
    DELETE FROM ${followHistory}
    WHERE ${followHistory.at} < ${now.getTime() - KEEP_DAYS * DAY_MS}
      AND NOT ${kept}
  `)

  db.run(sql`
    DELETE FROM ${followHistory} WHERE ${followHistory.id} NOT IN (
      SELECT ${followHistory.id} FROM ${followHistory}
      ORDER BY ${followHistory.at} DESC LIMIT ${KEEP_ROWS}
    ) AND NOT ${kept}
  `)
}
