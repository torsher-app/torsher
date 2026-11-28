import type { ExternalListCounts } from '../../dto/externalLists.ts'
import type { SourceSnapshot, SourceTitle } from './mdblist.ts'
import type { StoredList } from './state.ts'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { externalListDecisions } from '../../db/schema.ts'
import { getMineRow, updateMine } from '../mine/index.ts'
import { personalTitleStatus } from '../mine/personal.ts'
import { titleAllowedCached } from '../profiles/access.ts'
import { TmdbError } from '../tmdb/client.ts'
import { findByExternalId } from '../tmdb/find.ts'
import { getTitleSummary } from '../tmdb/index.ts'
import { toCatalogId } from '../tmdb/mappers.ts'
import { profileLanguage, profileOf } from './state.ts'

export const MAX_ADDITIONS = 50
const MAX_COLD_LOOKUPS = 50
const PARALLEL_CHECKS = 4

interface Candidate {
  titleId: string
  title: string
}

type Review = 'existing' | 'handled' | 'excluded' | 'restricted' | 'watched'
type Outcome
  = | { kind: 'add' | 'existing', candidate: Candidate }
    | { kind: Exclude<Review, 'existing'> | 'unmatched' | 'pending' }

export interface PreparedCandidates {
  counts: ExternalListCounts
  additions: Candidate[]
  existing: Candidate[]
  checkOffset: number
}

function decision(profileId: string, titleId: string) {
  return getDb()
    .select({ decision: externalListDecisions.decision })
    .from(externalListDecisions)
    .where(
      and(
        eq(externalListDecisions.profileId, profileId),
        eq(externalListDecisions.titleId, titleId),
      ),
    )
    .get()
    ?.decision
}

function localReview(
  profileId: string,
  titleId: string,
  language: string,
): Review | undefined {
  const previous = decision(profileId, titleId)
  if (previous)
    return previous
  if (!titleAllowedCached(profileId, titleId))
    return 'restricted'
  const status = personalTitleStatus(profileId, titleId, language)
  if (status === 'watched' || status === 'dropped')
    return 'watched'
  if (getMineRow(profileId, titleId)?.watchlistAt)
    return 'existing'
}

function emptyCounts(found: number): ExternalListCounts {
  return {
    found,
    added: 0,
    existing: 0,
    handled: 0,
    excluded: 0,
    restricted: 0,
    watched: 0,
    unmatched: 0,
    pending: 0,
    deferred: 0,
  }
}

class LookupBudgetError extends Error {}

export async function prepareCandidates(
  snapshot: SourceSnapshot,
  config: Pick<StoredList, 'profileId' | 'media' | 'checkOffset'>,
  signal: AbortSignal,
): Promise<PreparedCandidates> {
  const { profileId, media } = config
  const language = profileLanguage(profileOf(profileId))
  const ranked = snapshot.items
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        (a.row?.rank ?? Infinity) - (b.row?.rank ?? Infinity)
        || a.index - b.index,
    )
  const offset = ranked.length ? config.checkOffset % ranked.length : 0
  const results: Outcome[] = []
  let cursor = 0
  let cold = 0
  let nextOffset: number | undefined
  const summaries = new Map<string, ReturnType<typeof getTitleSummary>>()
  const matches = new Map<string, ReturnType<typeof findByExternalId>>()

  async function inspect(
    row: SourceTitle | undefined,
    index: number,
  ): Promise<Outcome> {
    if (!row || (media !== 'all' && media !== row.type))
      return { kind: 'unmatched' }

    const beforeLoad = () => {
      signal.throwIfAborted()
      if (cold >= MAX_COLD_LOOKUPS) {
        if (nextOffset === undefined)
          nextOffset = index
        throw new LookupBudgetError()
      }
      cold++
    }
    const options = { requireFresh: true, signal, beforeLoad }
    let id = row.tmdbId ? toCatalogId(row.type, row.tmdbId) : undefined
    try {
      if (!id && row.imdbId) {
        const key = `${row.type}:${row.imdbId}`
        let matching = matches.get(key)
        if (!matching) {
          matching = findByExternalId(
            row.imdbId,
            'imdb_id',
            row.type === 'movie' ? 'movie' : 'series',
            true,
            options,
          )
          matches.set(key, matching)
        }
        id = await matching
      }
      if (!id)
        return { kind: 'unmatched' }

      const previous = decision(profileId, id)
      if (previous)
        return { kind: previous }

      signal.throwIfAborted()
      let loading = summaries.get(id)
      if (!loading) {
        loading = getTitleSummary(id, language, options)
        summaries.set(id, loading)
      }
      const summary = await loading
      if (signal.aborted)
        return { kind: 'pending' }
      if (
        !summary
        || (row.imdbId && summary.imdbId && row.imdbId !== summary.imdbId)
      ) {
        return { kind: 'unmatched' }
      }
      const review = localReview(profileId, id, language)
      if (review && review !== 'existing')
        return { kind: review }

      return {
        kind: review ?? 'add',
        candidate: { titleId: id, title: summary.details.title },
      }
    }
    catch (error) {
      return {
        kind:
          error instanceof TmdbError && error.kind === 'not_found'
            ? 'unmatched'
            : 'pending',
      }
    }
  }

  async function worker() {
    while (cursor < ranked.length && !signal.aborted) {
      const index = (cursor++ + offset) % ranked.length
      results[index] = await inspect(ranked[index]!.row, index)
    }
  }

  await Promise.all(Array.from({ length: PARALLEL_CHECKS }, () => worker()))
  const counts = emptyCounts(ranked.length)
  const additions: Candidate[] = []
  const existing: Candidate[] = []
  const seen = new Set<string>()
  for (let index = 0; index < ranked.length; index++) {
    const result = results[index]
    if (!result) {
      counts.pending++
      continue
    }
    if (!('candidate' in result)) {
      counts[result.kind]++
      continue
    }
    const { candidate } = result
    if (seen.has(candidate.titleId)) {
      counts.handled++
      continue
    }
    seen.add(candidate.titleId)
    if (result.kind === 'existing') {
      counts.existing++
      existing.push(candidate)
    }
    else if (additions.length < MAX_ADDITIONS) {
      counts.added++
      additions.push(candidate)
    }
    else {
      counts.deferred++
    }
  }
  return {
    counts,
    additions,
    existing,
    checkOffset:
      nextOffset ?? (ranked.length ? (offset + cursor) % ranked.length : 0),
  }
}

function recordHandled(profileId: string, titleId: string) {
  getDb()
    .insert(externalListDecisions)
    .values({ profileId, titleId, decision: 'handled' })
    .onConflictDoNothing()
    .run()
}

/** Synchronous transaction body. Re-check current local state, never load more candidates. */
export function applyCandidates(
  profileId: string,
  prepared: PreparedCandidates,
) {
  const language = profileLanguage(profileOf(profileId))
  const counts = { ...prepared.counts }
  for (const { titleId } of prepared.additions) {
    const review = localReview(profileId, titleId, language)
    if (review) {
      counts.added--
      counts[review]++
      if (review === 'existing')
        recordHandled(profileId, titleId)
      continue
    }

    updateMine(profileId, titleId, { watchlist: true })
    recordHandled(profileId, titleId)
  }
  for (const { titleId } of prepared.existing) {
    const review = localReview(profileId, titleId, language)
    if (review === 'existing' || review === 'watched' || review === undefined) {
      // Even if consumption cleared it in the meantime, it was in Watch later.
      recordHandled(profileId, titleId)
    }
    if (review !== 'existing') {
      counts.existing--
      counts[review ?? 'handled']++
    }
  }
  return counts
}
