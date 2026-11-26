import type { Indexer } from '../../db/schema.ts'
import type { TorznabCaps } from '../torznab/caps.ts'
import type { TitleIdentity } from '../tmdb/index.ts'
import type { IndexerFailure } from '../sources/search.ts'
import type { NewznabConnection, NewznabRelease } from './client.ts'
import { createHash, randomUUID } from 'node:crypto'
import {
  matchTitle,
  parseRelease,
  videoResolution,
} from '@torsher/release-parser'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { indexers } from '../../db/schema.ts'
import { mapLimit } from '../../utils/mapLimit.ts'
import { indexerPause, recordBackgroundOutcome } from '../indexers/backoff.ts'
import { decryptSecret } from '../secrets/index.ts'
import { syncTitleAliases, textQueriesOf } from '../sources/aliases.ts'
import { getTitleIdentity, tmdbEpisodeExists } from '../tmdb/index.ts'
import { SourceError } from '../torznab/client.ts'
import { fetchNewznabPage, fetchNzb } from './client.ts'

export interface NzbTarget {
  titleId: string
  season: number
  episode: number
}

interface Candidate extends NzbTarget {
  sourceId: string
  sourceName: string
  sourceRevision: string
  releaseKey: string
  releaseTitle: string
  download: string
  size?: number
  parsed: ReturnType<typeof parseRelease>
  rank: number
}

interface CachedCandidate {
  candidate: Candidate
  profileId: string
  expiresAt: number
}

const cache = new Map<string, CachedCandidate>()
const CACHE_TTL = 5 * 60_000
const CACHE_LIMIT = 512

function stableKey(...parts: unknown[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function revisionOf(indexer: Indexer) {
  return stableKey(
    indexer.id,
    indexer.url,
    indexer.apiKey,
    indexer.lanAddresses,
    indexer.downloadOrigins,
  )
}

function connectionOf(indexer: Indexer): NewznabConnection {
  return {
    url: indexer.url,
    apiKey: indexer.apiKey ? decryptSecret(indexer.apiKey) : undefined,
    lanAddresses: indexer.lanAddresses,
    downloadOrigins: indexer.downloadOrigins,
  }
}

function searchableWhere() {
  return and(
    eq(indexers.protocol, 'newznab'),
    eq(indexers.enabled, true),
    eq(indexers.missing, false),
    eq(indexers.checkStatus, 'ok'),
    isNotNull(indexers.caps),
  )
}

export function hasNewznabIndexers() {
  return !!getDb()
    .select({ id: indexers.id })
    .from(indexers)
    .where(searchableWhere())
    .limit(1)
    .get()
}

function sourceOf(candidate: Candidate, automation: boolean) {
  const row = getDb()
    .select()
    .from(indexers)
    .where(and(eq(indexers.id, candidate.sourceId), searchableWhere()))
    .get()
  return row
    && (!automation || row.allowAutomation)
    && revisionOf(row) === candidate.sourceRevision
    ? row
    : undefined
}

export function candidateCurrent(candidate: Candidate, automation: boolean) {
  return !!sourceOf(candidate, automation)
}

export async function downloadNewznabCandidate(
  candidate: Candidate,
  automation: boolean,
) {
  const row = sourceOf(candidate, automation)
  if (!row)
    throw new SourceError('bad_response', 'The source has changed')
  return fetchNzb(connectionOf(row), candidate.download)
}

export function newznabRequests(
  caps: TorznabCaps,
  identity: TitleIdentity,
  target: NzbTarget,
  titles: string[],
  custom = false,
) {
  const movie = identity.kind === 'movie'
  const mode = movie ? caps.movieSearch : caps.tvSearch
  const typed = movie ? 'movie' : 'tvsearch'
  const params = mode.available ? new Set(mode.params) : new Set<string>()
  const ids = [
    ['imdbid', identity.imdbId?.replace(/^tt/, '')],
    ['tvdbid', movie ? undefined : identity.tvdbId?.toString()],
    ['tmdbid', identity.tmdbId.toString()],
  ] as const
  const supportedId = custom
    ? undefined
    : ids.find(([key, value]) => value && params.has(key))
  const category = caps.categories.find(
    category => category.id === (movie ? 2000 : 5000),
  )
  const common = {
    limit: String(Math.min(caps.limits?.max ?? 50, 50)),
    ...(category && { cat: String(category.id) }),
  }
  const typedTarget = {
    ...(!movie && params.has('season') && { season: String(target.season) }),
    ...(!movie && params.has('ep') && { ep: String(target.episode) }),
  }
  const requests: Record<string, string>[] = []
  if (supportedId?.[1]) {
    requests.push({
      ...common,
      ...typedTarget,
      t: typed,
      [supportedId[0]]: supportedId[1],
    })
  }
  const generalText
    = caps.search.available
      && (caps.search.params.length === 0 || caps.search.params.includes('q'))
  const textMode = params.has('q') ? typed : generalText ? 'search' : undefined
  if (textMode) {
    for (const title of titles) {
      if (title.trim()) {
        requests.push({
          ...common,
          ...(textMode === typed && typedTarget),
          t: textMode,
          q:
            movie && identity.year && !custom
              ? `${title} ${identity.year}`
              : title,
        })
      }
    }
  }
  return requests
}

function candidateOf(
  target: NzbTarget,
  identity: TitleIdentity,
  aliases: string[],
  row: Indexer,
  release: NewznabRelease,
): Candidate | undefined {
  const parsed = parseRelease(release.title)
  const series = identity.kind === 'series'
  if (
    parsed.isPack
    || parsed.isOngoing
    || (series
      && (parsed.seasons.length !== 1
        || parsed.seasons[0] !== target.season
        || parsed.episodes?.from !== target.episode
        || parsed.episodes?.to !== target.episode))
      || (!series && parsed.kind === 'series')
  ) {
    return undefined
  }
  const matched = matchTitle(parsed, {
    kind: identity.kind,
    aliases,
    year: identity.year,
    endYear: identity.endYear,
    seasonYears: identity.seasonYears,
    season: series ? target.season : undefined,
  })
  if (matched.confidence !== 'high')
    return undefined
  return {
    ...target,
    sourceId: row.id,
    sourceName: row.name,
    sourceRevision: revisionOf(row),
    releaseKey: stableKey('newznab', row.id, release.guid),
    releaseTitle: release.title,
    download: release.download,
    size: release.size,
    parsed,
    rank: row.priority ?? 25,
  }
}

export async function searchNewznab(
  target: NzbTarget,
  options: {
    automation?: boolean
    query?: string
    identity?: TitleIdentity
  } = {},
) {
  const identity = options.identity ?? (await getTitleIdentity(target.titleId))
  if (
    !identity
    || (identity.kind === 'movie'
      ? target.season !== 0 || target.episode !== 0
      : target.episode < 1
        || !(await tmdbEpisodeExists(
          identity.tmdbId,
          target.season,
          target.episode,
          'en-US',
        )))
  ) {
    return undefined
  }

  const aliases = syncTitleAliases(target.titleId, identity)
  const titles = options.query ? [options.query] : textQueriesOf(aliases, 2)
  const rows = getDb()
    .select()
    .from(indexers)
    .where(searchableWhere())
    .orderBy(indexers.name)
    .all()
    .filter(row => !options.automation || row.allowAutomation)
    .filter(row => !indexerPause(row.id))
    .sort((a, b) => (a.priority ?? 25) - (b.priority ?? 25))
    .slice(0, 24)
  const failures: IndexerFailure[] = []
  const asked: Indexer[] = []
  const deadline = AbortSignal.timeout(options.automation ? 15_000 : 7_000)
  const found = await mapLimit(rows, 4, async (row) => {
    if (deadline.aborted)
      return []
    const foundForSource = new Map<string, Candidate>()
    try {
      const requests = newznabRequests(
        row.caps!,
        identity,
        target,
        titles,
        !!options.query,
      )
      if (!requests.length)
        return []
      asked.push(row)
      const connection = connectionOf(row)
      const names = aliases.map(alias => alias.value)
      for (const request of requests) {
        let offset: number | undefined
        const pageKeys = new Set<string>()
        for (let page = 0; page < 3 && !deadline.aborted; page++) {
          const { releases, nextOffset } = await fetchNewznabPage(
            connection,
            {
              ...request,
              ...(offset !== undefined && { offset: String(offset) }),
            },
            deadline,
          )
          const pageKey = JSON.stringify(
            releases.map(release => release.guid),
          )
          if (releases.length && pageKeys.has(pageKey))
            break
          pageKeys.add(pageKey)
          for (const release of releases) {
            const candidate = candidateOf(
              target,
              identity,
              names,
              row,
              release,
            )
            if (candidate && !foundForSource.has(candidate.releaseKey))
              foundForSource.set(candidate.releaseKey, candidate)
          }
          if (nextOffset === undefined || foundForSource.size >= 60)
            break
          offset = nextOffset
        }
      }
    }
    catch (error) {
      failures.push({
        id: row.id,
        name: row.name,
        kind: error instanceof SourceError ? error.kind : 'bad_response',
        retryAt: error instanceof SourceError ? error.retryAt : undefined,
      })
    }
    return [...foundForSource.values()]
  })
  recordBackgroundOutcome(asked, failures)
  return {
    identity,
    candidates: found.flat().slice(0, 120),
    failed: failures.length,
  }
}

export function viewerNewznabResults(
  candidates: Candidate[],
  profileId: string,
) {
  const now = Date.now()
  for (const [id, record] of cache) {
    if (record.expiresAt <= now)
      cache.delete(id)
  }
  return candidates.map((candidate) => {
    if (cache.size >= CACHE_LIMIT)
      cache.delete(cache.keys().next().value!)
    const id = randomUUID()
    cache.set(id, { candidate, profileId, expiresAt: now + CACHE_TTL })
    return {
      id,
      title: candidate.releaseTitle,
      source: candidate.sourceName,
      quality: videoResolution(candidate.parsed)?.value ?? null,
      size: candidate.size ?? null,
    }
  })
}

export function getViewerNewznabCandidate(
  id: string,
  target: NzbTarget,
  profileId: string,
) {
  const record = cache.get(id)
  const candidate = record?.candidate
  if (
    !record
    || !candidate
    || record.profileId !== profileId
    || record.expiresAt <= Date.now()
    || candidate.titleId !== target.titleId
    || candidate.season !== target.season
    || candidate.episode !== target.episode
    || !candidateCurrent(candidate, false)
  ) {
    return undefined
  }
  return candidate
}
