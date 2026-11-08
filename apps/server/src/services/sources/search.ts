import type { TitleAlias } from '../../db/schema.ts'
import type { SearchableIndexer } from '../indexers/index.ts'
import type { TitleIdentity } from '../tmdb/index.ts'
import type {
  SearchParams,
  SourceErrorKind,
  TorznabRelease,
} from '../torznab/index.ts'
import type { FoundRelease } from './rank.ts'
import { createHash } from 'node:crypto'
import {
  matchTitle,
  normalizeTitle,
  parseRelease,
} from '@torsher/release-parser'
import {
  buildSearchRequests,
  searchIndexer,
  SourceError,
} from '../torznab/index.ts'
import { parseMagnet } from '../torrents/magnet.ts'
import type { SearchDiagnostics } from './logDiagnostics.ts'
import { logFor } from '../logs/index.ts'
import { sourceErrorFacts } from './logDiagnostics.ts'
import { textQueriesOf } from './aliases.ts'

// Индексаторов бывает десяток, а каждый отвечает до таймаута запроса:
// поиск ограничен и по одновременным запросам, и по общему сроку. Срок меньше
// таймаута API-клиента витрины (10 с) с запасом на запрос к TMDB. Запросы
// одного индексатора идут по очереди: медленный индексатор держит один поток,
// а не все
export const SEARCH_CONCURRENCY = 6
export const SEARCH_DEADLINE_MS = 7000
// Популярный тайтл даёт сотни раздач; дальше — шум
const MAX_RELEASES = 150

export interface SearchTarget {
  /** Захваченный ID каталога; названия и запрос в журнал не попадают. */
  titleId?: string
  identity: TitleIdentity
  aliases: TitleAlias[]
  /** Сезон сериала; у фильма не задаётся. */
  season?: number
  /**
   * Строка, которую выбрал зритель («Уточнить запрос»): ищется только она,
   * текстом, без запросов по ID и алиасам.
   */
  query?: string
}

export interface IndexerFailure {
  id: string
  name: string
  /** `skipped` — на паузе после ошибок подряд, в этот раз не спрашивали */
  kind: SourceErrorKind | 'skipped'
  /** Индексатор просит повторить не раньше (`Retry-After`) */
  retryAt?: Date
}

export interface SearchOptions {
  /** Индексаторы, пропущенные caller из-за backoff. */
  skipped?: number
  deadlineMs?: number
  /** Запросов к индексаторам одновременно */
  concurrency?: number
  /** Текстовых запросов на индексатор, кроме запроса по ID */
  textQueries?: number
  /** Дополнительный запрос сериала с годом начала только для выдачи зрителя. */
  seriesYearQuery?: boolean
}

export interface SearchOutcome {
  /** Сопоставленные раздачи: только они доступны автоматизации. */
  releases: FoundRelease[]
  /** Эксплуатационный итог physical search; у старых fixtures может отсутствовать. */
  diagnostics?: SearchDiagnostics
  /** Ответы индексаторов без подтверждённого совпадения, для ручного выбора. */
  unmatched: FoundRelease[]
  /** Сколько индексаторов участвовало в поиске. */
  indexerCount: number
  failed: IndexerFailure[]
}

interface Hit {
  indexer: SearchableIndexer
  release: TorznabRelease
}

interface IndexerState {
  ok: boolean
  startedAt?: number
  mode?: 'id' | 'text'
  pending?: boolean
  failure?: { errorKind: string, status?: number, mode: 'id' | 'text' }
  error?: SourceErrorKind
  retryAt?: Date
}

// Год в конце строки зрителя («Дюна 2021») матчеру не нужен: он сверяет
// год раздачи с годом тайтла сам
const TRAILING_YEAR = /\s+(?:19|20)\d{2}$/

let viewerSearches = 0

/** Идёт поиск зрителя («Источники», «Смотреть»): фоновые поиски ждут */
export function isViewerSearching() {
  return viewerSearches > 0
}

export async function asViewerSearch<T>(task: () => Promise<T>) {
  viewerSearches++

  try {
    return await task()
  }
  finally {
    viewerSearches--
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms).unref?.())
}

function errorKind(err: unknown): SourceErrorKind {
  // Сбой разбора ответа не должен ронять поиск по остальным индексаторам
  return err instanceof SourceError ? err.kind : 'bad_response'
}

function identityKey(release: TorznabRelease) {
  const hash
    = release.infoHash
      ?? (release.magnet ? parseMagnet(release.magnet)?.infoHash : undefined)

  return hash
    ? `hash:${hash}`
    : `title:${normalizeTitle(release.title)}:${release.size ?? ''}`
}

function releaseId(key: string) {
  return createHash('sha1').update(key).digest('hex').slice(0, 16)
}

/**
 * Склейка повторов: одна раздача приходит от нескольких индексаторов
 * и по нескольким запросам. Сиды берутся наибольшие, ссылка — у источника
 * с большим числом сидов.
 */
export function mergeHits(hits: Hit[]) {
  const merged = new Map<string, Omit<FoundRelease, 'parsed' | 'match'>>()

  for (const { indexer, release } of hits) {
    const key = identityKey(release)
    const seeders = release.seeders ?? 0
    const found = merged.get(key)
    const source = {
      id: indexer.id,
      name: indexer.name,
      ...(release.detailsUrl && { detailsUrl: release.detailsUrl }),
    }
    const link = release.link
      ? {
          url: release.link,
          indexerId: indexer.id,
          indexerOrigin: new URL(indexer.url).origin,
        }
      : undefined

    if (!found) {
      merged.set(key, {
        id: releaseId(key),
        title: release.title,
        indexers: [source],
        link,
        magnet: release.magnet,
        infoHash:
          release.infoHash
          ?? (release.magnet ? parseMagnet(release.magnet)?.infoHash : undefined),
        size: release.size,
        seeders,
        peers: release.peers,
        publishedAt: release.publishedAt,
      })
      continue
    }

    const known = found.indexers.find(item => item.id === indexer.id)

    if (!known)
      found.indexers.push(source)
    else known.detailsUrl ??= release.detailsUrl

    if (seeders > found.seeders) {
      found.seeders = seeders
      found.peers = release.peers ?? found.peers
      found.link = link ?? found.link
    }
    else {
      found.link ??= link
    }

    found.magnet ??= release.magnet
    found.size ??= release.size
    found.publishedAt ??= release.publishedAt
  }

  return [...merged.values()]
}

/**
 * Автопоиск сохраняет для ручного выбора полную фразу названия без
 * известного противоречия году. Ручной запрос эту проверку не использует.
 * Это не подтверждает совпадение: уверенность и причины матчера не меняются.
 */
function relevantUnmatched(
  parsed: FoundRelease['parsed'],
  identity: TitleIdentity,
  aliases: string[],
) {
  if (parsed.year !== undefined) {
    if (identity.kind === 'movie') {
      if (
        identity.year !== undefined
        && Math.abs(parsed.year - identity.year) > 1
      ) {
        return false
      }
    }
    else if (
      (identity.year !== undefined && parsed.year < identity.year - 1)
      || (identity.endYear !== undefined && parsed.year > identity.endYear + 1)
    ) {
      return false
    }
  }

  const { ru, orig, translit, alt = [] } = parsed.titles

  return [ru, orig, translit, ...alt].some(
    name =>
      name
      && aliases.some(
        alias =>
          normalizeTitle(name) === alias
          || [...name.matchAll(/[:|]\s*|\.\s+|\s+[-–—]\s+/gu)].some(
            boundary =>
              normalizeTitle(
                name.slice(boundary.index + boundary[0].length),
              ) === alias,
          ),
      ),
  )
}

/**
 * Поиск раздач тайтла по всем индексаторам: запросы по ID и названиям,
 * склейка повторов, разбор названий и матчер. Несопоставленные раздачи
 * (`low`) сохраняются отдельно для ручного выбора. Индексатор, не ответивший
 * к сроку, попадает в `failed`.
 */
export async function searchReleases(
  target: SearchTarget,
  indexers: SearchableIndexer[],
  options: SearchOptions = {},
): Promise<SearchOutcome> {
  const startedAt = Date.now()
  const {
    deadlineMs = SEARCH_DEADLINE_MS,
    concurrency = SEARCH_CONCURRENCY,
    textQueries,
    seriesYearQuery = false,
  } = options
  const { identity, aliases, season } = target
  const manual = target.query?.trim()
  const query = manual
    ? { kind: identity.kind, ids: {}, titles: [manual], season }
    : {
        kind: identity.kind,
        ids: {
          imdb: identity.imdbId,
          tmdb: identity.tmdbId,
          tvdb: identity.tvdbId,
        },
        titles: textQueriesOf(aliases, textQueries),
        year: identity.year,
        season,
        seriesYearQuery,
      }
  const tasks = indexers.flatMap(indexer =>
    buildSearchRequests(indexer.caps, query).map(params => ({
      indexer,
      params,
    })),
  )
  const states = new Map<string, IndexerState>()
  const hits: Hit[] = []
  const busy = new Set<string>()
  const deadline = { expired: false }

  for (const indexer of indexers) {
    states.set(
      indexer.id,
      tasks.some(task => task.indexer === indexer)
        ? { ok: false }
        : { ok: false, error: 'unsupported' },
    )
  }

  async function run(indexer: SearchableIndexer, params: SearchParams) {
    const state = states.get(indexer.id)!
    state.startedAt ??= Date.now()
    state.mode = params.q === undefined ? 'id' : 'text'
    state.pending = true
    try {
      const releases = await searchIndexer(
        indexer.url,
        params,
        indexer.apiKey(),
        indexer.sessionCookie?.(),
      )

      if (deadline.expired)
        return

      state.ok = true
      hits.push(...releases.map(release => ({ indexer, release })))
    }
    catch (err) {
      if (deadline.expired)
        return
      state.failure ??= { ...sourceErrorFacts(err), mode: state.mode }
      state.error ??= errorKind(err)

      if (err instanceof SourceError && err.retryAt)
        state.retryAt ??= err.retryAt
    }
    finally {
      if (!deadline.expired)
        state.pending = false
    }
  }

  // Оставшиеся запросы — индексаторов, занятых другими потоками: их доведут те
  async function worker() {
    while (!deadline.expired) {
      const index = tasks.findIndex(task => !busy.has(task.indexer.id))

      if (index === -1)
        return

      const task = tasks.splice(index, 1)[0]!

      busy.add(task.indexer.id)

      try {
        await run(task.indexer, task.params)
      }
      finally {
        busy.delete(task.indexer.id)
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    worker,
  )

  await Promise.race([Promise.all(workers), sleep(deadlineMs)])
  deadline.expired = true

  const failed = indexers.flatMap((indexer) => {
    const state = states.get(indexer.id)!

    if (state.ok)
      return []

    return [
      {
        id: indexer.id,
        name: indexer.name,
        kind: state.error ?? 'timeout',
        ...(state.retryAt && { retryAt: state.retryAt }),
      },
    ]
  })
  const context = {
    ...(target.titleId ? { titleId: target.titleId } : {}),
    ...(season === undefined ? {} : { season }),
  }
  for (const indexer of indexers) {
    const state = states.get(indexer.id)!
    if (state.startedAt === undefined || (!state.failure && !state.pending))
      continue
    const failure = state.pending
      ? { errorKind: 'late', mode: state.mode! }
      : state.failure!
    logFor('sources').warn(
      {
        event: 'sources.indexer_failed',
        origin: 'server',
        ...context,
        indexerId: indexer.id,
        ...failure,
        ms: Date.now() - state.startedAt,
      },
      'Indexer search failed',
    )
  }
  const titleTarget = {
    kind: identity.kind,
    // Строка зрителя — тоже название тайтла: иначе раздачи под названием,
    // которого нет среди алиасов, матчер отбросил бы как чужие
    aliases: manual
      ? [
          ...aliases.map(alias => alias.value),
          manual.replace(TRAILING_YEAR, ''),
        ]
      : aliases.map(alias => alias.value),
    year: identity.year,
    endYear: identity.endYear,
    seasonYears: identity.seasonYears,
    season,
  }
  const merged = mergeHits(hits)
  const found = merged
    .map((release) => {
      const parsed = parseRelease(release.title)
      const match = matchTitle(parsed, titleTarget)

      return { ...release, parsed, match }
    })
    .sort((a, b) => b.seeders - a.seeders)
  // Шум не вытесняет сопоставленные раздачи даже при большем числе сидов.
  const releases = found
    .filter(release => release.match.confidence !== 'low')
    .slice(0, MAX_RELEASES)
  const discoveryAliases = aliases
    .map(alias => normalizeTitle(alias.value))
    .filter(Boolean)
  const unmatched = found
    .filter(
      release =>
        release.match.confidence === 'low'
        && (manual
          || (!release.match.issues.includes('content')
            && relevantUnmatched(release.parsed, identity, discoveryAliases))),
    )
    .slice(0, MAX_RELEASES - releases.length)

  const asked = [...states.values()].filter(
    state => state.startedAt !== undefined,
  )
  const ok = asked.filter(state => state.ok).length
  const diagnostics: SearchDiagnostics = {
    ...context,
    asked: asked.length,
    ok,
    failed: asked.length - ok,
    skipped: (options.skipped ?? 0) + indexers.length - asked.length,
    raw: merged.length,
    kept: releases.length,
    ms: Date.now() - startedAt,
    customQuery: !!manual,
  }
  logFor('sources').info(
    {
      event: 'sources.search',
      origin: 'server',
      ...diagnostics,
      cached: false,
    },
    `Source search: ${ok} of ${asked.length} indexers answered, ${merged.length} found, ${releases.length} kept`,
  )
  return {
    releases,
    unmatched,
    indexerCount: indexers.length,
    failed,
    diagnostics,
  }
}
