import type { TmdbRef } from '../tmdb/mappers.ts'
import { and, eq, gt, inArray, lte } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleExternalIds } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { TMDB_MAX_CACHE_AGE_MS } from '../tmdb/cache.ts'
import { tmdbGet } from '../tmdb/client.ts'

// Холодная главная — пара сотен тайтлов: заполняем в фоне, не мешая карточке
const CONCURRENCY = 2
const MAX_PENDING = 500
// IMDb ID может прийти из деталей TMDB, которые уже неделю лежат в кэше:
// запас держит общий возраст в пределе условий TMDB
const MAX_AGE_MS = TMDB_MAX_CACHE_AGE_MS - 7 * 24 * 60 * 60 * 1000

export function imdbIdKey(ref: TmdbRef) {
  return `${ref.type}:${ref.tmdbId}`
}

/** `imdbId` null — у TMDB его нет: запоминаем, чтобы не спрашивать снова */
export function rememberImdbId(
  ref: TmdbRef,
  imdbId: string | null | undefined,
) {
  const row = { imdbId: imdbId || null, fetchedAt: new Date() }

  getDb()
    .insert(titleExternalIds)
    .values({ type: ref.type, tmdbId: ref.tmdbId, ...row })
    .onConflictDoUpdate({
      target: [titleExternalIds.type, titleExternalIds.tmdbId],
      set: row,
    })
    .run()
}

/** Пишет только новое значение: детали тайтла открывают часто */
export function rememberImdbIdIfChanged(
  ref: TmdbRef,
  imdbId: string | null | undefined,
) {
  const known = knownImdbIds([ref]).get(imdbIdKey(ref))

  if (known === undefined || known !== (imdbId || null))
    rememberImdbId(ref, imdbId)
}

/** Известные IMDb ID по ключу `imdbIdKey`; null — у TMDB его нет */
export function knownImdbIds(refs: TmdbRef[], now = Date.now()) {
  const known = new Map<string, string | null>()
  const fresh = gt(titleExternalIds.fetchedAt, new Date(now - MAX_AGE_MS))

  for (const type of ['movie', 'tv'] as const) {
    const ids = refs
      .filter(ref => ref.type === type)
      .map(ref => ref.tmdbId)

    if (ids.length === 0)
      continue

    const rows = getDb()
      .select()
      .from(titleExternalIds)
      .where(
        and(
          eq(titleExternalIds.type, type),
          inArray(titleExternalIds.tmdbId, ids),
          fresh,
        ),
      )
      .all()

    for (const row of rows) known.set(imdbIdKey(row), row.imdbId)
  }

  return known
}

const queued = new Map<string, TmdbRef>()
const inflight = new Set<string>()

async function fetchImdbId(ref: TmdbRef) {
  const response = await tmdbGet<{ imdb_id?: string | null }>(
    `/${ref.type}/${ref.tmdbId}/external_ids`,
    {},
  )

  rememberImdbId(ref, response.imdb_id)
}

function drain() {
  while (inflight.size < CONCURRENCY && queued.size > 0) {
    const [key, ref] = queued.entries().next().value!

    queued.delete(key)
    inflight.add(key)
    fetchImdbId(ref)
      .catch(err =>
        logFor('catalog').debug({ err, key }, 'IMDb id lookup failed'),
      )
      .finally(() => {
        inflight.delete(key)
        drain()
      })
  }
}

/**
 * Ставит в фоновую очередь тайтлы без известного IMDb ID. Ответ карточки
 * очередь не ждёт: оценка появится при следующей загрузке ряда.
 */
export function queueImdbIds(refs: TmdbRef[]) {
  for (const ref of refs) {
    const key = imdbIdKey(ref)

    if (queued.size >= MAX_PENDING)
      break

    if (!inflight.has(key))
      queued.set(key, ref)
  }

  drain()
}

/** Тесты ждут, пока очередь опустеет */
export async function imdbIdQueueIdle() {
  while (queued.size > 0 || inflight.size > 0)
    await new Promise(resolve => setTimeout(resolve, 5))
}

export function purgeExpiredExternalIds(now = Date.now()) {
  return getDb()
    .delete(titleExternalIds)
    .where(lte(titleExternalIds.fetchedAt, new Date(now - MAX_AGE_MS)))
    .run()
    .changes
}
