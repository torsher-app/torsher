import { logFor } from '../logs/index.ts'
import type { IndexerFailure } from '../sources/search.ts'
import type { SearchableIndexer } from './index.ts'
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm'
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

  if (!ids.length) {
    return {
      available: [] as T[],
      locallyPaused: [] as T[],
      nextAt: undefined,
    }
  }

  const rows = getDb()
    .select({
      id: indexers.id,
      backoffUntil: indexers.backoffUntil,
      retryAfterUntil: indexers.retryAfterUntil,
    })
    .from(indexers)
    .where(inArray(indexers.id, ids))
    .all()
  const blocked = new Map<string, number>()
  const local = new Set<string>()
  const nowMs = now.getTime()

  for (const row of rows) {
    const backoff = row.backoffUntil?.getTime() ?? 0
    const retryAfter = row.retryAfterUntil?.getTime() ?? 0
    const until = Math.max(backoff, retryAfter)

    if (until <= nowMs)
      continue

    blocked.set(row.id, until)
    if (retryAfter <= nowMs)
      local.add(row.id)
  }

  return {
    available: list.filter(item => !blocked.has(item.id)),
    locallyPaused: list.filter(item => local.has(item.id)),
    /** Когда освободится первый индексатор в бэкоффе */
    nextAt: blocked.size ? new Date(Math.min(...blocked.values())) : undefined,
  }
}

/** Пауза может появиться, пока запрос ждёт в очереди поиска. */
export function indexerPause(
  id: string,
  now = new Date(),
): 'retry_after' | 'local' | undefined {
  const row = getDb()
    .select({
      backoffUntil: indexers.backoffUntil,
      retryAfterUntil: indexers.retryAfterUntil,
    })
    .from(indexers)
    .where(eq(indexers.id, id))
    .get()

  if (row?.retryAfterUntil && row.retryAfterUntil > now)
    return 'retry_after'
  if (row?.backoffUntil && row.backoffUntil > now)
    return 'local'
}

/** Срок провайдера действует сразу, даже если поиск уже вернул часть раздач. */
export function rememberIndexerRetryAfter(id: string, retryAt: Date) {
  const until = backoffUntil(1, new Date(), retryAt)

  getDb()
    .update(indexers)
    .set({ retryAfterUntil: until })
    .where(
      and(
        eq(indexers.id, id),
        or(
          isNull(indexers.retryAfterUntil),
          lt(indexers.retryAfterUntil, until),
        ),
      ),
    )
    .run()
}

/**
 * Итог фонового поиска по индексаторам: ошибка — следующая ступень лестницы
 * или `Retry-After` и начало серии ошибок, если её ещё нет, успех — сброс.
 * Индексатор без нужного режима поиска (`unsupported`) не виноват.
 */
export function recordBackgroundOutcome(
  asked: Pick<SearchableIndexer, 'id'>[],
  failed: (Pick<IndexerFailure, 'id' | 'kind' | 'retryAt'> & {
    name?: string
  })[],
  now = new Date(),
) {
  const db = getDb()
  const failures = new Map(failed.map(item => [item.id, item]))

  for (const indexer of asked) {
    const failure = failures.get(indexer.id)

    if (failure?.kind === 'unsupported' || failure?.kind === 'skipped')
      continue

    const row = db
      .select({
        failureCount: indexers.failureCount,
        backoffSince: indexers.backoffSince,
        retryAfterUntil: indexers.retryAfterUntil,
      })
      .from(indexers)
      .where(eq(indexers.id, indexer.id))
      .get()

    const protectedUntil = row?.retryAfterUntil
    // Параллельный результат мог начаться раньше ответа с Retry-After.
    if (protectedUntil && protectedUntil > now && !failure?.retryAt)
      continue

    if (!failure) {
      db.update(indexers)
        .set({
          backoffUntil: null,
          backoffSince: null,
          failureCount: 0,
          retryAfterUntil: null,
        })
        .where(eq(indexers.id, indexer.id))
        .run()
      if (row && row.failureCount > 0) {
        logFor('sources').info(
          {
            event: 'sources.backoff_returned',
            origin: 'server',
            indexerId: indexer.id,
            failures: row.failureCount,
          },
          'Indexer backoff cleared',
        )
      }
      continue
    }

    const count = (row?.failureCount ?? 0) + 1
    const next = backoffUntil(count, now, failure.retryAt)
    const until
      = protectedUntil && protectedUntil > next ? protectedUntil : next

    db.update(indexers)
      .set({
        failureCount: count,
        backoffUntil: until,
        backoffSince: row?.backoffSince ?? now,
        retryAfterUntil: failure.retryAt ? until : null,
      })
      .where(eq(indexers.id, indexer.id))
      .run()
    if (row) {
      logFor('sources').warn(
        {
          event: 'sources.backoff_paused',
          origin: 'server',
          indexerId: indexer.id,
          failures: count,
          until: until.toISOString(),
        },
        'Indexer backoff started',
      )
    }
  }
}
