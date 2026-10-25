import type { IndexerFailure } from '../sources/search.ts'
import type { SearchableIndexer } from './index.ts'
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { indexers } from '../../db/schema.ts'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
// Лестница Sonarr по числу ошибок подряд
const BACKOFF_STEPS_MS = [
  1 * MINUTE_MS,
  5 * MINUTE_MS,
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  1 * HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
  24 * HOUR_MS,
]
// `Retry-After` дальше суток — скорее ошибка индексатора, чем лимит
const MAX_RETRY_AFTER_MS = 24 * HOUR_MS

/** Срок бэкоффа после `failures` ошибок подряд; `Retry-After` сильнее */
export function backoffUntil(failures: number, now: Date, retryAt?: Date) {
  if (retryAt) {
    return new Date(
      Math.min(retryAt.getTime(), now.getTime() + MAX_RETRY_AFTER_MS),
    )
  }

  const step
    = BACKOFF_STEPS_MS[Math.min(failures, BACKOFF_STEPS_MS.length) - 1] ?? 0

  return new Date(now.getTime() + step)
}

/** Индексаторы, которые фоновый поиск может спросить сейчас */
export function availableForBackground<T extends SearchableIndexer>(
  list: T[],
  now = new Date(),
) {
  const ids = list.map(item => item.id)

  if (!ids.length)
    return { available: [] as T[], nextAt: undefined }

  const rows = getDb()
    .select({ id: indexers.id, backoffUntil: indexers.backoffUntil })
    .from(indexers)
    .where(inArray(indexers.id, ids))
    .all()
  const blocked = new Map(
    rows.flatMap(row =>
      row.backoffUntil && row.backoffUntil > now
        ? [[row.id, row.backoffUntil] as const]
        : [],
    ),
  )
  const waits = [...blocked.values()].map(date => date.getTime())

  return {
    available: list.filter(item => !blocked.has(item.id)),
    /** Когда освободится первый индексатор в бэкоффе */
    nextAt: waits.length ? new Date(Math.min(...waits)) : undefined,
  }
}

/**
 * Итог фонового поиска по индексаторам: ошибка — следующая ступень лестницы
 * или `Retry-After` и начало серии ошибок, если её ещё нет, успех — сброс.
 * Индексатор без нужного режима поиска (`unsupported`) не виноват.
 */
export function recordBackgroundOutcome(
  asked: SearchableIndexer[],
  failed: IndexerFailure[],
  now = new Date(),
) {
  const db = getDb()
  const failures = new Map(failed.map(item => [item.id, item]))

  for (const indexer of asked) {
    const failure = failures.get(indexer.id)

    if (failure?.kind === 'unsupported')
      continue

    if (!failure) {
      db.update(indexers)
        .set({ backoffUntil: null, backoffSince: null, failureCount: 0 })
        .where(eq(indexers.id, indexer.id))
        .run()
      continue
    }

    const row = db
      .select({
        failureCount: indexers.failureCount,
        backoffSince: indexers.backoffSince,
      })
      .from(indexers)
      .where(eq(indexers.id, indexer.id))
      .get()
    const count = (row?.failureCount ?? 0) + 1

    db.update(indexers)
      .set({
        failureCount: count,
        backoffUntil: backoffUntil(count, now, failure.retryAt),
        backoffSince: row?.backoffSince ?? now,
      })
      .where(eq(indexers.id, indexer.id))
      .run()
  }
}
