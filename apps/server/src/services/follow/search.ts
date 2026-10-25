import type { Follow } from '../../db/schema.ts'
import type { SearchOutcome } from '../sources/search.ts'
import type { EpisodeWithState } from './wanted.ts'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { follows } from '../../db/schema.ts'
import {
  availableForBackground,
  recordBackgroundOutcome,
} from '../indexers/backoff.ts'
import { listSearchableIndexers } from '../indexers/index.ts'
import { logFor } from '../logs/index.ts'
import { getSetting } from '../settings/index.ts'
import { syncTitleAliases } from '../sources/aliases.ts'
import { cachedSearch, peekSearch, SEARCH_TTL_MS } from '../sources/cache.ts'
import { isViewerSearching, searchReleases } from '../sources/search.ts'
import { getTitleIdentity } from '../tmdb/index.ts'
import { recordHistory } from './history.ts'
import { decideFollow, followStates, reportMissing } from './pass.ts'
import { localDay, MISSING_AFTER_DAYS, WANTED_STATES } from './wanted.ts'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
// После выхода серии: в день выхода, через 3, 6, 12 и 24 ч, дальше раз в
// сутки до 14 дней и раз в неделю до 60 (у Sonarr — 14 дней)
const LADDER_MS = [
  0,
  3 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
  ...Array.from({ length: 14 }, (_, index) => (index + 1) * DAY_MS),
  ...Array.from(
    { length: Math.floor((MISSING_AFTER_DAYS - 14) / 7) },
    (_, index) => (21 + index * 7) * DAY_MS,
  ),
]
// Фильм до среза доступности ищется раз в неделю
const MOVIE_EVERY_MS = 7 * DAY_MS
// Без нужных серий слежение смотрится хотя бы раз в сутки: TMDB мог сдвинуть даты
const IDLE_RECHECK_MS = DAY_MS
// Между стартами целевых поисков; общий бюджет — в час
const SEARCH_GAP_MS = MINUTE_MS
export const DEFAULT_SEARCHES_PER_HOUR = 20
// После старта сервера фон молчит, как льготный период монитора уведомлений
const QUIET_AFTER_START_MS = 5 * MINUTE_MS
// Фон не торопится: срок больше, параллельно меньше, запросов меньше, чем у
// «Источников» (запрос по ID и два названия)
const SEARCH_DEADLINE_MS = 20_000
const SEARCH_CONCURRENCY = 2
const TEXT_QUERIES = 2
const SETTINGS_KEY = 'follow'

/** `manual` — «Искать сейчас», без бюджета; `retry` — после зависшей закачки */
export type SearchRequest = 'manual' | 'retry'

interface SearchState {
  startedAt: number
  starts: number[]
  requested: Map<string, SearchRequest>
}

const state: SearchState = {
  startedAt: Date.now(),
  starts: [],
  requested: new Map(),
}

interface FollowSettings {
  searchesPerHour?: number
}

export function searchesPerHour() {
  return (
    getSetting<FollowSettings>(SETTINGS_KEY)?.searchesPerHour
    ?? DEFAULT_SEARCHES_PER_HOUR
  )
}

/** Начало дня выхода в поясе сервера */
function airStart(airDate: string) {
  return new Date(`${airDate}T00:00:00`).getTime()
}

export interface SearchPlanInput {
  kind: 'movie' | 'series'
  /** Нужные серии; без даты — давно вышедшие (только поиск при включении) */
  wanted: { airDate?: string }[]
  /** Ближайшая невышедшая серия */
  upcomingAirDate?: string
  lastSearchAt?: Date | null
  now: Date
}

/**
 * Пора ли искать и когда смотреть слежение снова. Поиск при включении — если
 * есть нужные серии и поиска ещё не было; дальше — точки лестницы от дня
 * выхода каждой нужной серии, прошедшие с прошлого поиска.
 */
export function searchPlan(input: SearchPlanInput) {
  const now = input.now.getTime()
  const last = input.lastSearchAt?.getTime()
  let due = input.wanted.length > 0 && last === undefined
  let next = now + IDLE_RECHECK_MS

  if (input.kind === 'movie') {
    if (input.wanted.length && last !== undefined) {
      due = now - last >= MOVIE_EVERY_MS
      next = Math.min(next, last + MOVIE_EVERY_MS)
    }

    return { due, next: new Date(Math.max(next, now)) }
  }

  for (const item of input.wanted) {
    if (!item.airDate)
      continue

    const start = airStart(item.airDate)

    for (const offset of LADDER_MS) {
      const point = start + offset

      if (point > now) {
        next = Math.min(next, point)
        break
      }

      if (last !== undefined && point > last)
        due = true
    }
  }

  if (input.upcomingAirDate) {
    const start = airStart(input.upcomingAirDate)

    if (start > now)
      next = Math.min(next, start)
  }

  return { due, next: new Date(next) }
}

/** Поиск по слежению стоит в очереди: что известно для порядка */
export interface DueSearch {
  follow: Follow
  request?: SearchRequest
  airedToday: boolean
}

/**
 * Порядок очереди: «Искать сейчас» и повтор после зависшей закачки →
 * ещё не искали → серия вышла сегодня → по сроку.
 */
export function compareDue(a: DueSearch, b: DueSearch) {
  const rank = (item: DueSearch) =>
    item.request === 'manual'
      ? 0
      : item.request === 'retry'
        ? 1
        : !item.follow.lastSearchAt
            ? 2
            : item.airedToday
              ? 3
              : 4

  return (
    rank(a) - rank(b)
    || (a.follow.nextSearchAt?.getTime() ?? 0)
    - (b.follow.nextSearchAt?.getTime() ?? 0)
    || a.follow.createdAt.getTime() - b.follow.createdAt.getTime()
  )
}

/** Первые минуты после старта сервера фон к индексаторам не ходит */
export function isQuietAfterStart(now: Date) {
  return now.getTime() - state.startedAt < QUIET_AFTER_START_MS
}

/** Бюджет фона: не чаще раза в минуту и не больше N в час; «Искать сейчас» — сразу */
export function canStartSearch(
  request: SearchRequest | undefined,
  now: Date,
  perHour = searchesPerHour(),
) {
  if (request === 'manual')
    return true

  const time = now.getTime()

  if (isQuietAfterStart(now) || isViewerSearching())
    return false

  state.starts = state.starts.filter(start => time - start < HOUR_MS)

  const lastStart = state.starts.at(-1)

  return (
    state.starts.length < perHour
    && (lastStart === undefined || time - lastStart >= SEARCH_GAP_MS)
  )
}

/** «Искать сейчас» из панели и повторный поиск после зависшей раздачи */
export function requestFollowSearch(
  followId: string,
  request: SearchRequest = 'manual',
) {
  const current = state.requested.get(followId)

  if (current !== 'manual')
    state.requested.set(followId, request)
}

export function requestedSearch(followId: string) {
  return state.requested.get(followId)
}

/** Поиск ушёл к индексаторам: он тратит бюджет; ответ из кэша — нет */
export function followSearchStarted(now: Date) {
  state.starts.push(now.getTime())
}

function setSchedule(follow: Follow, values: Partial<Follow>) {
  getDb().update(follows).set(values).where(eq(follows.id, follow.id)).run()
}

/** Состояние слежения для планировщика: пора ли искать и когда смотреть снова */
async function evaluate(follow: Follow, now: Date) {
  const states = await followStates(follow, now)

  reportMissing(follow, states, now)

  const wanted = states.filter(item => WANTED_STATES.has(item.state))
  const plan = searchPlan({
    kind: follow.kind,
    wanted: wanted.map(item => ({ airDate: item.airDate })),
    upcomingAirDate: states.find(item => item.state === 'upcoming')?.airDate,
    lastSearchAt: follow.lastSearchAt,
    now,
  })

  return { ...plan, states, wanted }
}

function airedToday(states: EpisodeWithState[], now: Date) {
  const today = localDay(now)

  return states.some(
    item => WANTED_STATES.has(item.state) && item.airDate === today,
  )
}

/**
 * Раздачи слежения: свежий поиск «Источников» по всем сезонам берётся как есть
 * (он полнее), иначе — свой урезанный поиск по индексаторам вне бэкоффа.
 * `undefined` — спросить некого: все индексаторы в бэкоффе или их нет.
 */
export async function followReleases(
  follow: Follow,
  now: Date,
  refresh = false,
): Promise<
  { outcome: SearchOutcome, network: boolean } | { nextAt?: Date } | undefined
> {
  const viewer = peekSearch(`${follow.titleId}:all`)

  if (
    viewer
    && !refresh
    && now.getTime() - viewer.updatedAt.getTime() < SEARCH_TTL_MS
  ) {
    return { outcome: viewer.outcome, network: false }
  }

  const key = `follow:${follow.titleId}`
  const own = peekSearch(key)

  if (
    own
    && !refresh
    && now.getTime() - own.updatedAt.getTime() < SEARCH_TTL_MS
  ) {
    return { outcome: own.outcome, network: false }
  }

  const { available, nextAt } = availableForBackground(
    listSearchableIndexers(),
    now,
  )

  if (!available.length)
    return { nextAt }

  const identity = await getTitleIdentity(follow.titleId)

  if (!identity)
    return undefined

  const aliases = syncTitleAliases(follow.titleId, identity)
  const search = await cachedSearch(
    key,
    async () => {
      const outcome = await searchReleases({ identity, aliases }, available, {
        deadlineMs: SEARCH_DEADLINE_MS,
        concurrency: SEARCH_CONCURRENCY,
        textQueries: TEXT_QUERIES,
      })

      recordBackgroundOutcome(available, outcome.failed, now)
      return outcome
    },
    { refresh: true, now: now.getTime() },
  )

  return { outcome: search.outcome, network: true }
}

/** Целевой поиск по слежению и прогон решателя по найденному */
async function runSearch(due: DueSearch, now: Date) {
  const { follow } = due
  const found = await followReleases(follow, now, due.request === 'manual')

  if (!found)
    return false

  if (!('outcome' in found)) {
    // Все индексаторы в бэкоффе: ждём первый освободившийся
    setSchedule(follow, {
      nextSearchAt: found.nextAt ?? new Date(now.getTime() + HOUR_MS),
    })
    return false
  }

  if (found.network)
    followSearchStarted(now)

  state.requested.delete(follow.id)

  const { outcome } = found

  recordHistory(
    {
      followId: follow.id,
      titleId: follow.titleId,
      kind: 'search',
      params: {
        found: outcome.releases.length,
        indexers: outcome.indexerCount,
        failed: outcome.failed.length,
        ...(due.request && { request: due.request }),
      },
    },
    now,
  )

  const searched = { ...follow, lastSearchAt: now }

  setSchedule(follow, { lastSearchAt: now })
  await decideFollow(searched, outcome.releases, now)

  const { next } = await evaluate(searched, now)

  setSchedule(follow, { nextSearchAt: next })
  return true
}

/**
 * Проход целевого поиска: слежения, которым пора, по порядку очереди; за
 * проход — не больше одного поиска. Остальные просто получают срок.
 */
export async function searchPass(active: Follow[], now = new Date()) {
  const due: DueSearch[] = []

  for (const follow of active) {
    const request = state.requested.get(follow.id)

    if (!request && follow.nextSearchAt && follow.nextSearchAt > now)
      continue

    const plan = await evaluate(follow, now)

    if (!plan.due && !request) {
      setSchedule(follow, { nextSearchAt: plan.next })
      continue
    }

    due.push({ follow, request, airedToday: airedToday(plan.states, now) })
  }

  const first = due.sort(compareDue)[0]

  if (!first || !canStartSearch(first.request, now))
    return false

  try {
    return await runSearch(first, now)
  }
  catch (err) {
    logFor('catalog').warn(
      { err, titleId: first.follow.titleId },
      'Follow search failed',
    )
    setSchedule(first.follow, {
      nextSearchAt: new Date(now.getTime() + HOUR_MS),
    })
    return false
  }
}

/** Тесты: чистая очередь и бюджет, тишина после старта задаётся явно */
export function resetFollowSearch(startedAt = 0) {
  state.startedAt = startedAt
  state.starts = []
  state.requested.clear()
}

export function startFollowSearch(now = Date.now()) {
  state.startedAt = now
}
