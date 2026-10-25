import type {
  FeedCursor,
  Follow,
  FollowPendingCandidate,
  TitleAlias,
} from '../../db/schema.ts'
import type { FeedIndexer } from '../indexers/index.ts'
import type { IndexerFailure } from '../sources/search.ts'
import type { FoundRelease } from '../sources/rank.ts'
import type { TorznabRelease } from '../torznab/index.ts'
import type { ParsedRelease, TitleTarget } from '@torsher/release-parser'
import { createHash } from 'node:crypto'
import {
  matchTitle,
  normalizeTitle,
  parseRelease,
  titleKey,
} from '@torsher/release-parser'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  followEpisodes,
  followHistory,
  indexers,
  titleAliases,
} from '../../db/schema.ts'
import {
  availableForBackground,
  recordBackgroundOutcome,
} from '../indexers/backoff.ts'
import { listFeedIndexers } from '../indexers/index.ts'
import { rememberUserAlias } from '../library/recognize.ts'
import { logFor } from '../logs/index.ts'
import { syncTitleAliases } from '../sources/aliases.ts'
import { peekSearch, SEARCH_TTL_MS } from '../sources/cache.ts'
import { isViewerSearching, mergeHits } from '../sources/search.ts'
import { getTitleIdentity } from '../tmdb/index.ts'
import { searchIndexer, SourceError } from '../torznab/index.ts'
import { releaseSeasons } from './decide.ts'
import { linkOf, pendingOf } from './grab.ts'
import { recordHistory } from './history.ts'
import { followById } from './index.ts'
import { decideFollow, followStates } from './pass.ts'
import { requestFollowSearch } from './search.ts'
import { followSettings } from './settings.ts'
import { WANTED_STATES } from './wanted.ts'

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS
// Интервал ленты: 15 мин, не чаще 10; 0 — выключено
export const DEFAULT_RSS_INTERVAL_MIN = 15
const MIN_RSS_INTERVAL_MIN = 10
const MAX_RSS_INTERVAL_MIN = 120
// Индексаторы не приходят все в одну минуту
const JITTER_MS = MINUTE_MS
// Между запросами к одному индексатору
const PAGE_GAP_MS = 2000
const MAX_PAGES = 3
const DEFAULT_PAGE_SIZE = 100
// Лента без позиций или с негодным ответом три раза подряд выключается до
// пробы раз в неделю: индексатор не отдаёт ленту на запрос без `q`
const FAILURES_TO_DISABLE = 3
const PROBE_EVERY_MS = 7 * DAY_MS
/** Интервал ленты в минутах; 0 — лента выключена */
export function rssIntervalMin() {
  const value = followSettings().rssIntervalMin

  if (value === undefined || !Number.isFinite(value))
    return DEFAULT_RSS_INTERVAL_MIN

  if (value <= 0)
    return 0

  return Math.min(
    MAX_RSS_INTERVAL_MIN,
    Math.max(MIN_RSS_INTERVAL_MIN, Math.round(value)),
  )
}

/** Сдвиг ±60 с: свой у индексатора и у каждого прочтения, стабилен между тиками */
export function feedJitter(indexerId: string, checkedAt: Date) {
  const hash = createHash('sha1')
    .update(`${indexerId}:${checkedAt.getTime()}`)
    .digest()

  return (hash.readUInt32BE(0) % (2 * JITTER_MS + 1)) - JITTER_MS
}

/** Лента выключена неудачами: когда её попробуют снова; иначе null */
export function feedProbeAt(
  indexer: Pick<FeedIndexer, 'rssFailures' | 'rssCheckedAt'>,
) {
  return indexer.rssFailures >= FAILURES_TO_DISABLE && indexer.rssCheckedAt
    ? new Date(indexer.rssCheckedAt.getTime() + PROBE_EVERY_MS)
    : null
}

/** Пора ли читать ленту индексатора; выключенная лента пробуется раз в неделю */
export function isFeedDue(
  indexer: Pick<FeedIndexer, 'id' | 'rssCheckedAt' | 'rssFailures'>,
  intervalMs: number,
  now: Date,
) {
  if (!indexer.rssCheckedAt)
    return true

  const since = now.getTime() - indexer.rssCheckedAt.getTime()

  if (indexer.rssFailures >= FAILURES_TO_DISABLE)
    return since >= PROBE_EVERY_MS

  return since >= intervalMs + feedJitter(indexer.id, indexer.rssCheckedAt)
}

/** Позиций за запрос: из caps индексатора, не больше 100 */
export function feedPageSize(indexer: Pick<FeedIndexer, 'caps'>) {
  const { limits } = indexer.caps

  return Math.min(
    limits?.max ?? limits?.default ?? DEFAULT_PAGE_SIZE,
    DEFAULT_PAGE_SIZE,
  )
}

/**
 * Позиция ленты: `guid` или адрес темы вместе с infohash. У обновлённой темы
 * `guid` бывает прежним, а infohash новым — это новая позиция.
 */
function positionKey(item: {
  guid?: string
  detailsUrl?: string
  infoHash?: string
  title?: string
}) {
  const place = item.guid ?? item.detailsUrl ?? item.title

  return place ? `${place}|${item.infoHash ?? ''}` : undefined
}

function cursorOf(release: TorznabRelease): FeedCursor {
  return {
    ...(release.guid && { guid: release.guid }),
    ...(release.detailsUrl && { detailsUrl: release.detailsUrl }),
    ...(release.infoHash && { infoHash: release.infoHash }),
    ...(release.publishedAt && {
      publishedAt: release.publishedAt.toISOString(),
    }),
  }
}

/** Самая свежая позиция страницы: по дате, без дат — первая */
function newestOf(page: TorznabRelease[]) {
  return page.reduce((best, item) =>
    item.publishedAt
    && (!best.publishedAt || item.publishedAt > best.publishedAt)
      ? item
      : best,
  )
}

export interface FeedGap {
  from?: Date
  to?: Date
}

export type FeedRead
  = | { kind: 'failed', failure: IndexerFailure }
    | { kind: 'empty' }
    | {
      kind: 'ok'
      /** Позиции новее курсора */
      items: TorznabRelease[]
      cursor: FeedCursor
      gap?: FeedGap
    }

function failureOf(indexer: FeedIndexer, err: unknown): IndexerFailure {
  return {
    id: indexer.id,
    name: indexer.name,
    kind: err instanceof SourceError ? err.kind : 'bad_response',
    ...(err instanceof SourceError && err.retryAt && { retryAt: err.retryAt }),
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms).unref?.())
}

/**
 * Лента индексатора с курсора: `t=search` без запроса и категорий. Первая
 * страница не дошла до курсора и полная — следующая через `offset`, не больше
 * трёх. Не дошли (страницы кончились, индексатор не понял `offset`, ошибка
 * на догоне) — пробел от курсора до самой старой увиденной позиции.
 */
export async function readFeed(
  indexer: FeedIndexer,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<FeedRead> {
  const limit = feedPageSize(indexer)
  const cursor = indexer.rssCursor
  const cursorKey = cursor ? positionKey(cursor) : undefined
  const cursorDate = cursor?.publishedAt
    ? new Date(cursor.publishedAt)
    : undefined
  const seen = new Set<string>()
  const items: TorznabRelease[] = []
  let first: TorznabRelease[] = []
  let reached = !cursor
  let oldest: Date | undefined
  let offset = 0

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0)
      await wait(PAGE_GAP_MS)

    let list: TorznabRelease[]

    try {
      list = await searchIndexer(
        indexer.url,
        {
          t: 'search',
          limit: String(limit),
          ...(offset > 0 && { offset: String(offset) }),
        },
        indexer.apiKey(),
      )
    }
    catch (err) {
      if (page === 0)
        return { kind: 'failed', failure: failureOf(indexer, err) }

      break
    }

    if (page === 0) {
      if (!list.length)
        return { kind: 'empty' }

      first = list
    }

    offset += list.length

    const fresh = list.filter((item) => {
      const key = positionKey(item) ?? item.title

      if (seen.has(key))
        return false

      seen.add(key)
      return true
    })

    // Индексатор без `offset` отдаёт ту же страницу
    if (page > 0 && !fresh.length)
      break

    for (const item of fresh) {
      if (cursorKey && positionKey(item) === cursorKey) {
        reached = true
        break
      }

      if (cursorDate && item.publishedAt && item.publishedAt < cursorDate) {
        reached = true
        continue
      }

      items.push(item)

      if (item.publishedAt && (!oldest || item.publishedAt < oldest))
        oldest = item.publishedAt
    }

    // Без курсора хватает первой страницы; короткая страница — лента кончилась
    if (reached || list.length < limit)
      break
  }

  const newest = newestOf(first)

  return {
    kind: 'ok',
    items,
    // Позиция курсора исчезла, а новых нет: курсор назад не идёт
    cursor:
      cursor
      && !items.length
      && cursorDate
      && newest.publishedAt
      && newest.publishedAt < cursorDate
        ? cursor
        : cursorOf(newest),
    ...(!reached && { gap: { from: cursorDate, to: oldest } }),
  }
}

// Негодный ответ — индексатор ленту не отдаёт; сеть, срок, лимит и ключ —
// временное, их ведёт общий бэкофф
function countsAsFeedFailure(failure: IndexerFailure) {
  return (
    failure.kind === 'bad_response'
    || failure.kind === 'unsupported'
    || (failure.kind === 'remote' && !failure.retryAt)
  )
}

function saveFeed(indexer: FeedIndexer, read: FeedRead, now: Date) {
  recordBackgroundOutcome(
    [indexer],
    read.kind === 'failed' ? [read.failure] : [],
    now,
  )

  const failed
    = read.kind === 'empty'
      || (read.kind === 'failed' && countsAsFeedFailure(read.failure))
  const failures
    = read.kind === 'ok' ? 0 : indexer.rssFailures + (failed ? 1 : 0)

  getDb()
    .update(indexers)
    .set({
      rssCheckedAt: now,
      rssFailures: failures,
      ...(read.kind === 'ok' && { rssCursor: read.cursor }),
    })
    .where(eq(indexers.id, indexer.id))
    .run()

  if (failed && failures === FAILURES_TO_DISABLE) {
    logFor('sources').info(
      { indexerId: indexer.id },
      'Indexer feed is not readable, retrying weekly',
    )
  }
}

interface IndexedTitle {
  titleId: string
  target: TitleTarget
}

interface FollowIndex {
  signature: string
  titles: Map<string, IndexedTitle>
  keys: Map<string, Set<string>>
}

let index: FollowIndex | undefined

/** Префиксы по словам: «тихая гавань возвращение» → «тихая», «тихая гавань» */
function wordPrefixes(name: string) {
  const words = name.split(' ')

  return words.slice(1).map((_, end) => words.slice(0, end + 1).join(' '))
}

function addKey(keys: Map<string, Set<string>>, key: string, titleId: string) {
  const set = keys.get(key) ?? new Set()

  set.add(titleId)
  keys.set(key, set)
}

function aliasesOfTitles(titleIds: string[]) {
  return getDb()
    .select()
    .from(titleAliases)
    .where(inArray(titleAliases.titleId, titleIds))
    .all()
}

/** Цель матчера без сезона: все алиасы, год и вид тайтла */
async function titleTarget(
  titleId: string,
  known?: TitleAlias[],
): Promise<TitleTarget | undefined> {
  const identity = await getTitleIdentity(titleId).catch(() => undefined)

  if (!identity)
    return undefined

  let aliases = known ?? aliasesOfTitles([titleId])

  // Тайтл ещё ни разу не искали: алиасов нет
  if (!aliases.length)
    aliases = syncTitleAliases(titleId, identity)

  return {
    kind: identity.kind,
    aliases: aliases.map(alias => alias.value),
    year: identity.year,
    endYear: identity.endYear,
  }
}

function signatureOf(follows: Follow[], aliases: TitleAlias[]) {
  const titles = [...new Set(follows.map(follow => follow.titleId))].sort()
  const synced = Math.max(
    0,
    ...aliases.map(alias => alias.syncedAt.getTime()),
  )

  return `${titles.join(',')}|${aliases.length}|${synced}`
}

/**
 * Индекс алиасов только тайтлов «Следить»: ключ `titleKey`, нормализованное
 * название и его начала по словам → тайтлы. Перестраивается, когда меняются
 * слежения или их алиасы.
 */
async function followIndex(follows: Follow[]): Promise<FollowIndex> {
  const titleIds = [...new Set(follows.map(follow => follow.titleId))]

  if (!titleIds.length)
    return { signature: '', titles: new Map(), keys: new Map() }

  let aliases = aliasesOfTitles(titleIds)

  if (index?.signature === signatureOf(follows, aliases))
    return index

  const titles = new Map<string, IndexedTitle>()
  const keys = new Map<string, Set<string>>()
  let complete = true

  for (const titleId of titleIds) {
    const target = await titleTarget(
      titleId,
      aliases.filter(alias => alias.titleId === titleId),
    )

    if (!target) {
      complete = false
      continue
    }

    titles.set(titleId, { titleId, target })

    for (const value of target.aliases) {
      const name = normalizeTitle(value)
      const key = titleKey(value)

      if (key.length >= 3)
        addKey(keys, `k:${key}`, titleId)

      if (name) {
        addKey(keys, `n:${name}`, titleId)

        for (const prefix of wordPrefixes(name)) {
          if (prefix.length >= 4)
            addKey(keys, `p:${prefix}`, titleId)
        }
      }
    }
  }

  aliases = aliasesOfTitles(titleIds)
  // Без деталей TMDB тайтл выпал из индекса: такой индекс собирается снова
  index = {
    signature: complete ? signatureOf(follows, aliases) : '',
    titles,
    keys,
  }
  return index
}

/** Тайтлы индекса, на которые похоже название раздачи; дальше решает `matchTitle` */
function candidateTitles(found: FollowIndex, parsed: ParsedRelease) {
  const { ru, orig, translit, alt = [] } = parsed.titles
  const result = new Set<string>()

  for (const value of [ru, orig, translit, ...alt]) {
    if (!value)
      continue

    const name = normalizeTitle(value)
    const lookups = [`k:${titleKey(value)}`, `n:${name}`, `p:${name}`]

    for (const prefix of wordPrefixes(name)) lookups.push(`n:${prefix}`)

    for (const key of lookups) {
      for (const titleId of found.keys.get(key) ?? []) result.add(titleId)
    }
  }

  return result
}

/** Тесты: индекс собирается заново */
export function resetFollowIndex() {
  index = undefined
}

function pendingReleases(follow: Follow) {
  return getDb()
    .select({ pending: followEpisodes.pending })
    .from(followEpisodes)
    .where(
      and(
        eq(followEpisodes.followId, follow.id),
        isNotNull(followEpisodes.pending),
        isNull(followEpisodes.torrentId),
      ),
    )
    .all()
    .map(row => row.pending!)
}

function indexerName(id: string) {
  return (
    getDb()
      .select({ name: indexers.name })
      .from(indexers)
      .where(eq(indexers.id, id))
      .get()
      ?.name ?? ''
  )
}

/** Отложенный кандидат снова как раздача для решателя */
function releaseOfPending(
  candidate: FollowPendingCandidate,
  target: TitleTarget,
): FoundRelease {
  const parsed = parseRelease(candidate.title)

  return {
    id: candidate.id,
    title: candidate.title,
    indexers: candidate.indexerId
      ? [
          {
            id: candidate.indexerId,
            name: indexerName(candidate.indexerId),
            ...(candidate.detailsUrl && { detailsUrl: candidate.detailsUrl }),
          },
        ]
      : [],
    link: linkOf(candidate),
    magnet: candidate.magnet,
    infoHash: candidate.infoHash,
    size: candidate.size,
    seeders: candidate.seeders,
    parsed,
    match: matchTitle(parsed, target),
  }
}

/**
 * Что решатель видит по слежению, кроме ленты: свежий поиск (лента неполна,
 * и без него снимок и отложенный лучший кандидат подменились бы худшим из
 * ленты) и отложенные кандидаты. Повторы — по ID раздачи, лента первой.
 */
function releasesForDecide(
  follow: Follow,
  target: TitleTarget,
  fromFeed: FoundRelease[],
  now: Date,
) {
  const result = new Map(fromFeed.map(release => [release.id, release]))
  const cached = [`${follow.titleId}:all`, `follow:${follow.titleId}`]
    .map(peekSearch)
    .find(
      entry =>
        entry && now.getTime() - entry.updatedAt.getTime() < SEARCH_TTL_MS,
    )

  for (const release of cached?.outcome.releases ?? []) {
    if (!result.has(release.id))
      result.set(release.id, release)
  }

  for (const candidate of pendingReleases(follow)) {
    if (!result.has(candidate.id))
      result.set(candidate.id, releaseOfPending(candidate, target))
  }

  return [...result.values()]
}

/** Есть ли у слежения нужные серии, которые раздача может закрыть */
async function relevantFor(follow: Follow, release?: FoundRelease) {
  const wanted = (await followStates(follow)).filter(item =>
    WANTED_STATES.has(item.state),
  )

  if (!release || follow.kind === 'movie')
    return wanted.length > 0

  const seasons = releaseSeasons(release, follow.kind)

  return wanted.some(item => seasons.includes(item.season))
}

function unsureRecorded(followId: string, releaseTitle: string) {
  return !!getDb()
    .select({ id: followHistory.id })
    .from(followHistory)
    .where(
      and(
        eq(followHistory.followId, followId),
        eq(followHistory.kind, 'unsure'),
        eq(followHistory.releaseTitle, releaseTitle),
      ),
    )
    .get()
}

/** «Похоже на тайтл, не уверены»: одна запись на раздачу и слежение */
async function recordUnsure(follow: Follow, release: FoundRelease, now: Date) {
  if (unsureRecorded(follow.id, release.title))
    return

  if (!(await relevantFor(follow, release)))
    return

  recordHistory(
    {
      followId: follow.id,
      titleId: follow.titleId,
      kind: 'unsure',
      season: release.parsed.seasons[0],
      releaseTitle: release.title,
      indexerId: release.indexers[0]?.id,
      params: {
        issues: release.match.issues,
        candidate: pendingOf(release),
      },
    },
    now,
  )
}

/**
 * Пробел ленты: запись в истории и целевой поиск каждому действующему
 * слежению с нужными сериями — пропущенное могло быть его серией.
 */
async function reportGap(
  indexer: FeedIndexer,
  gap: FeedGap,
  active: Follow[],
  now: Date,
) {
  recordHistory(
    {
      kind: 'gap',
      indexerId: indexer.id,
      params: {
        ...(gap.from && { from: gap.from.toISOString() }),
        ...(gap.to && { to: gap.to.toISOString() }),
      },
    },
    now,
  )

  for (const follow of active) {
    if (await relevantFor(follow))
      requestFollowSearch(follow.id, 'gap')
  }
}

export interface FeedPassOptions {
  /** Пауза между страницами одного индексатора; тесты её убирают */
  wait?: (ms: number) => Promise<unknown>
}

/**
 * RSS-проход: ленты индексаторов, которым пора, по одному; новые позиции
 * разбираются и сверяются с тайтлами «Следить». Уверенный матч идёт в
 * решатель, `medium` — в историю «похоже, не уверены». Пока идёт поиск
 * зрителя, проход ждёт.
 */
export async function feedPass(
  active: Follow[],
  now = new Date(),
  options: FeedPassOptions = {},
) {
  const interval = rssIntervalMin()

  if (!interval || !active.length || isViewerSearching())
    return false

  const due = listFeedIndexers().filter(indexer =>
    isFeedDue(indexer, interval * MINUTE_MS, now),
  )
  const { available } = availableForBackground(due, now)

  if (!available.length)
    return false

  const hits: { indexer: FeedIndexer, release: TorznabRelease }[] = []

  for (const indexer of available) {
    if (isViewerSearching())
      break

    const read = await readFeed(indexer, options.wait)

    saveFeed(indexer, read, now)

    if (read.kind !== 'ok')
      continue

    hits.push(...read.items.map(release => ({ indexer, release })))

    if (read.gap)
      await reportGap(indexer, read.gap, active, now)
  }

  if (!hits.length)
    return true

  const found = await followIndex(active)
  const confident = new Map<string, FoundRelease[]>()

  for (const release of mergeHits(hits)) {
    const parsed = parseRelease(release.title)

    for (const titleId of candidateTitles(found, parsed)) {
      const title = found.titles.get(titleId)!
      const match = matchTitle(parsed, title.target)

      if (match.confidence === 'low')
        continue

      for (const follow of active.filter(item => item.titleId === titleId)) {
        const item = { ...release, parsed, match }

        if (match.confidence === 'medium') {
          await recordUnsure(follow, item, now)
          continue
        }

        confident.set(follow.id, [...(confident.get(follow.id) ?? []), item])
      }
    }
  }

  for (const follow of active) {
    const fromFeed = confident.get(follow.id)

    if (!fromFeed)
      continue

    try {
      await decideFollow(
        follow,
        releasesForDecide(
          follow,
          found.titles.get(follow.titleId)!.target,
          fromFeed,
          now,
        ),
        now,
      )
    }
    catch (err) {
      logFor('catalog').warn(
        { err, titleId: follow.titleId },
        'Follow feed decision failed',
      )
    }
  }

  return true
}

export type ConfirmUnsureResult = 'ok' | 'not_found' | 'inactive'

/**
 * «Это он» на записи «похоже, не уверены»: название раздачи запоминается
 * алиасом `user` (такие же дальше узнаются сами), а сама раздача идёт в
 * решатель как уверенный матч.
 */
export async function confirmUnsure(
  historyId: string,
  now = new Date(),
): Promise<ConfirmUnsureResult> {
  const row = getDb()
    .select()
    .from(followHistory)
    .where(
      and(eq(followHistory.id, historyId), eq(followHistory.kind, 'unsure')),
    )
    .get()
  const follow = row?.followId ? followById(row.followId) : undefined
  const candidate = row?.params.candidate as FollowPendingCandidate | undefined

  if (!row || !follow || !candidate)
    return 'not_found'

  rememberUserAlias(follow.titleId, candidate.title)
  getDb()
    .update(followHistory)
    .set({ params: { ...row.params, confirmedAt: now.toISOString() } })
    .where(eq(followHistory.id, row.id))
    .run()

  if (follow.state !== 'active')
    return 'inactive'

  const target = await titleTarget(follow.titleId)

  if (!target)
    return 'ok'

  const release = {
    ...releaseOfPending(candidate, target),
    match: { confidence: 'high' as const, issues: [] },
  }

  await decideFollow(
    follow,
    releasesForDecide(follow, target, [release], now),
    now,
  )
  return 'ok'
}
