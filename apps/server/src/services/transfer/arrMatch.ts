import type { ArrPreviewRow } from '../../dto/arrTransfer.ts'
import type { EpisodeRef } from '../follow/index.ts'
import type { TitleSummary } from '../mine/cards.ts'
import type { ExternalSource } from '../tmdb/find.ts'
import type { ArrSourceRow, ArrTarget } from './arrSource.ts'
import { setTimeout as sleep } from 'node:timers/promises'
import { localDay } from '../../utils/localDay.ts'
import { followOf, scheduleOf } from '../follow/index.ts'
import { compareEpisodes, firstUnaired } from '../follow/wanted.ts'
import { TmdbError } from '../tmdb/client.ts'
import { findTvCandidates } from '../tmdb/find.ts'
import { getTitleSummary } from '../tmdb/index.ts'
import { toCatalogId } from '../tmdb/mappers.ts'

const LOOKUP_WORKERS = 4

interface FollowSeed {
  titleId: string
  start: EpisodeRef
  originalLanguage?: string
}

export interface ArrPreparedRow {
  preview: ArrPreviewRow
  seed?: FollowSeed
}

function ordinaryEpisode(episode: EpisodeRef | undefined) {
  return episode
    && Number.isSafeInteger(episode.season)
    && episode.season > 0
    && Number.isSafeInteger(episode.episode)
    && episode.episode > 0
    ? episode
    : undefined
}

export function arrSeriesStart(summary: TitleSummary, today = localDay()) {
  const raw = scheduleOf(summary)
  const seasons = raw.seasons.filter(item => item.number > 0)
  let last = ordinaryEpisode(raw.last)
  let next = ordinaryEpisode(raw.next)
  const nextDate = summary.airing?.next?.airDate

  // Cached TMDB details can still describe an aired episode as the next one.
  if (next && nextDate && nextDate <= today) {
    if (!last || compareEpisodes(next, last) > 0)
      last = next
    next = undefined
  }
  if (last && next && compareEpisodes(next, last) <= 0)
    next = undefined
  if (
    !last
    && !next
    && (raw.last
      || raw.next
      || !seasons.length
      || seasons.some(item => item.airedEpisodeCount > 0))
  ) {
    return undefined
  }
  // When TMDB gives a last regular episode with no season count, the next
  // ordinary episode cannot safely be inferred.
  if (
    last
    && !next
    && !seasons.some(
      item =>
        item.number === last.season && item.episodeCount >= last.episode,
    )
  ) {
    return undefined
  }

  return firstUnaired({ seasons, last, next })
}

function makeLookups(language: string, signal: AbortSignal) {
  const details = new Map<string, Promise<TitleSummary | undefined>>()
  const finds = new Map<string, Promise<number[]>>()
  let retryAt = 0
  let configurationError: TmdbError | undefined

  async function request<T>(read: () => Promise<T>) {
    try {
      // Several workers may observe different Retry-After values.
      while (Date.now() < retryAt)
        await sleep(retryAt - Date.now(), undefined, { signal })
      signal.throwIfAborted()
      if (configurationError)
        throw configurationError
      return await read()
    }
    catch (error) {
      if (error instanceof TmdbError) {
        if (error.retryAfterMs)
          retryAt = Math.max(retryAt, Date.now() + error.retryAfterMs)
        if (error.kind === 'config')
          configurationError = error
      }
      throw error
    }
  }

  return {
    details(id: string) {
      let promise = details.get(id)
      if (!promise) {
        promise = request(() =>
          getTitleSummary(id, language, { requireFresh: true, signal }),
        )
        details.set(id, promise)
      }
      return promise
    },
    find(id: string, source: ExternalSource) {
      const key = `${source}:${id}`
      let promise = finds.get(key)
      if (!promise) {
        promise = request(() => findTvCandidates(id, source, signal))
        finds.set(key, promise)
      }
      return promise
    },
  }
}

function sourceDuplicates(rows: ArrSourceRow[]) {
  const byId = new Map<
    number,
    { index: number, signature: string, conflict: boolean }
  >()
  for (const [index, row] of rows.entries()) {
    if (!row.id)
      continue
    const signature = JSON.stringify(row)
    const previous = byId.get(row.id)
    if (!previous)
      byId.set(row.id, { index, signature, conflict: false })
    else if (previous.signature !== signature)
      previous.conflict = true
  }
  return byId
}

async function identifySeries(
  row: ArrSourceRow,
  lookup: ReturnType<typeof makeLookups>,
) {
  if (row.tmdbId)
    return row.tmdbId

  let identified: number | undefined
  let conflict = false
  const pairs = [
    [row.tvdbId, 'tvdb_id'],
    [row.imdbId, 'imdb_id'],
  ] as const
  for (const [id, source] of pairs) {
    if (!id)
      continue
    const [candidate, second] = await lookup.find(String(id), source)
    if (second || (candidate && identified && candidate !== identified))
      conflict = true
    identified ??= candidate
  }
  return conflict ? 'conflict' : identified
}

function withReason(
  row: ArrPreviewRow,
  reason: ArrPreviewRow['reasons'][number],
) {
  return {
    ...row,
    selectable: false,
    selected: false,
    reasons: [...row.reasons, reason],
  }
}

async function prepareRow(
  preview: ArrPreviewRow,
  row: ArrSourceRow,
  kind: ArrTarget['kind'],
  lookup: ReturnType<typeof makeLookups>,
): Promise<ArrPreparedRow> {
  const fail = (reason: ArrPreviewRow['reasons'][number]): ArrPreparedRow => ({
    preview: withReason(preview, reason),
  })
  try {
    const tmdbId
      = kind === 'radarr' ? row.tmdbId : await identifySeries(row, lookup)
    if (tmdbId === 'conflict')
      return fail('conflict')
    if (!tmdbId)
      return fail('unmatched')

    const type = kind === 'radarr' ? 'movie' : 'tv'
    const titleId = toCatalogId(type, tmdbId)
    const summary = await lookup.details(titleId)
    if (!summary)
      return fail('unmatched')
    if (summary.details.id !== titleId)
      return fail('conflict')
    if (
      (row.tvdbId && summary.tvdbId && row.tvdbId !== summary.tvdbId)
      || (row.imdbId && summary.imdbId && row.imdbId !== summary.imdbId)
    ) {
      return fail('conflict')
    }

    preview.title = summary.details.title
    if (followOf(titleId))
      return fail('existing')
    const start
      = type === 'movie' ? { season: 0, episode: 0 } : arrSeriesStart(summary)
    if (!start)
      return fail('unknown_cursor')

    return {
      preview: {
        ...preview,
        selectable: true,
        selected: !preview.reasons.length,
      },
      seed: {
        titleId,
        start,
        originalLanguage: summary.details.originalLanguage,
      },
    }
  }
  catch (error) {
    return fail(
      error instanceof TmdbError && error.kind === 'not_found'
        ? 'unmatched'
        : 'tmdb_unavailable',
    )
  }
}

export async function prepareArrRows(
  rows: ArrSourceRow[],
  kind: ArrTarget['kind'],
  language: string,
  signal: AbortSignal,
  rowId: () => string,
  checked: () => void,
) {
  const duplicates = sourceDuplicates(rows)
  const lookup = makeLookups(language, signal)
  const prepared: ArrPreparedRow[] = []
  let next = 0

  async function work() {
    while (next < rows.length) {
      if (signal.aborted && signal.reason?.name !== 'TimeoutError')
        return
      const index = next++
      const row = rows[index]!
      const preview: ArrPreviewRow = {
        id: rowId(),
        sourceTitle: row.sourceTitle,
        sourceStatus: row.sourceStatus,
        year: row.year,
        reasons: row.reasons,
        selectable: false,
        selected: false,
      }

      const sameId = row.id ? duplicates.get(row.id) : undefined
      const reason = sameId?.conflict
        ? 'conflict'
        : sameId && sameId.index !== index
          ? 'duplicate'
          : row.skip
      prepared[index] = reason
        ? { preview: withReason(preview, reason) }
        : await prepareRow(preview, row, kind, lookup)
      checked()
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(LOOKUP_WORKERS, rows.length) }, work),
  )
  if (signal.aborted && signal.reason?.name !== 'TimeoutError')
    return []
  const byTitle = new Map<string, ArrPreparedRow>()
  for (const row of prepared) {
    if (!row.seed)
      continue
    const first = byTitle.get(row.seed.titleId)
    if (!first) {
      byTitle.set(row.seed.titleId, row)
      continue
    }
    first.preview.reasons = [
      ...new Set([...first.preview.reasons, ...row.preview.reasons]),
    ]
    first.preview.selected = !first.preview.reasons.length
    row.seed = undefined
    row.preview = withReason(row.preview, 'duplicate')
  }
  return prepared
}
