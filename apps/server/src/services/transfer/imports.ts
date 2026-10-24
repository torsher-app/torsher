import type {
  ImportSummary,
  ImportUndoEntry,
  ProfileImport,
  ProfileTitle,
} from '../../db/schema.ts'
import type {
  ImportEntry,
  ImportFile,
  ImportKind,
  ImportSource,
} from './formats.ts'
import type { MatchResult } from './match.ts'
import type { ConflictPolicy, IncomingMine, MineValues } from './merge.ts'
import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  profileImportRows,
  profileImports,
  profileTitles,
} from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { TmdbError } from '../tmdb/client.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { parseImportFiles } from './formats.ts'
import { matchEntry, matchKey } from './match.ts'
import { mergeMine, ratingOutcome } from './merge.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const MATCH_CONCURRENCY = 4
// Готовый предпросмотр ждёт решения владельца, потом забывается
const JOB_TTL_MS = 30 * 60 * 1000
export const UNDO_WINDOW_MS = 7 * DAY_MS
const KEEP_IMPORTS_MS = 90 * DAY_MS
const CONFLICT_SAMPLES = 5
// SQLite ограничивает число параметров запроса
const CHUNK = 500

export class ImportNotFoundError extends Error {}
export class ImportStateError extends Error {}

type JobState = 'matching' | 'ready' | 'failed'

interface ImportJob {
  id: string
  profileId: string
  state: JobState
  entries: ImportEntry[]
  skipped: number
  sources: ImportSource[]
  results: Map<string, MatchResult>
  total: number
  done: number
  error?: 'catalog'
  finishedAt?: number
}

const jobs = new Map<string, ImportJob>()

function forgetStale(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS)
      jobs.delete(id)
  }
}

function jobOf(profileId: string, id: string) {
  forgetStale()

  const job = jobs.get(id)

  if (!job || job.profileId !== profileId)
    throw new ImportNotFoundError()

  return job
}

function activeJobOf(profileId: string) {
  forgetStale()

  return [...jobs.values()].find(job => job.profileId === profileId)
}

async function runMatching(job: ImportJob) {
  const unique = new Map<string, ImportEntry>()

  for (const entry of job.entries) {
    const key = matchKey(entry)

    if (!unique.has(key))
      unique.set(key, entry)
  }

  const queue = [...unique]

  job.total = queue.length

  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (jobs.get(job.id) !== job || job.state !== 'matching')
        return

      const [key, entry] = next

      try {
        job.results.set(key, await matchEntry(entry))
      }
      catch (err) {
        // Без каталога сопоставлять нечем: не помечаем всё «не найдено»
        if (err instanceof TmdbError && err.kind !== 'not_found') {
          job.state = 'failed'
          job.error = 'catalog'
          job.finishedAt = Date.now()
          logFor('catalog').warn({ err }, 'Ratings import matching failed')

          return
        }

        job.results.set(key, { status: 'notFound' })
      }

      job.done++
    }
  }

  await Promise.all(Array.from({ length: MATCH_CONCURRENCY }, () => worker()))

  if (job.state === 'matching') {
    job.state = 'ready'
    job.finishedAt = Date.now()
  }
}

/**
 * Разбирает файлы сразу (неподдерживаемый файл — ошибка запроса) и
 * запускает сопоставление в фоне. У профиля одна задача: новая заменяет
 * прежнюю, ещё не применённую.
 */
export function startImport(profileId: string, files: ImportFile[]) {
  const parsed = parseImportFiles(files)
  const previous = activeJobOf(profileId)

  if (previous)
    jobs.delete(previous.id)

  const job: ImportJob = {
    id: randomUUID(),
    profileId,
    state: 'matching',
    entries: parsed.entries,
    skipped: parsed.skipped,
    sources: parsed.sources,
    results: new Map(),
    total: 0,
    done: 0,
  }

  jobs.set(job.id, job)
  runMatching(job).catch((err) => {
    job.state = 'failed'
    job.error = 'catalog'
    job.finishedAt = Date.now()
    logFor('catalog').error({ err }, 'Ratings import matching crashed')
  })

  return job
}

export function cancelImport(profileId: string, id: string) {
  jobOf(profileId, id)
  jobs.delete(id)
}

interface Grouped {
  // По тайтлу каталога: что пришло из файла
  matched: Map<string, IncomingMine & { title: string }>
  unmatched: Array<{
    entry: ImportEntry
    result: Exclude<MatchResult, { status: 'matched' }>
  }>
}

function kindOfTitle(titleId: string): ImportKind {
  return parseCatalogId(titleId)?.type === 'movie' ? 'movie' : 'series'
}

/**
 * Строки файла по тайтлам. Несколько оценок одного тайтла (пересмотры,
 * два файла) — самая поздняя; «Позже» — самая ранняя отметка.
 */
function groupEntries(job: ImportJob): Grouped {
  const matched: Grouped['matched'] = new Map()
  const unmatched: Grouped['unmatched'] = []
  const seenUnmatched = new Set<string>()

  for (const entry of job.entries) {
    const key = matchKey(entry)
    const result = job.results.get(key) ?? { status: 'notFound' as const }

    if (result.status !== 'matched') {
      const unmatchedKey = `${entry.list}:${key}`

      if (!seenUnmatched.has(unmatchedKey)) {
        seenUnmatched.add(unmatchedKey)
        unmatched.push({ entry, result })
      }

      continue
    }

    const current = matched.get(result.titleId) ?? {
      kind: kindOfTitle(result.titleId),
      title: entry.title,
    }

    if (entry.list === 'rating') {
      const later
        = !current.rating
          || (entry.at && (!current.ratedAt || entry.at >= current.ratedAt))

      if (later) {
        current.rating = entry.rating
        current.ratedAt = entry.at
      }
    }
    else {
      const at = entry.at ?? null

      if (current.watchlistAt === undefined)
        current.watchlistAt = at
      else if (at && (!current.watchlistAt || at < current.watchlistAt))
        current.watchlistAt = at
    }

    matched.set(result.titleId, current)
  }

  return { matched, unmatched }
}

function currentRows(profileId: string, titleIds: string[]) {
  const rows = new Map<string, ProfileTitle>()

  for (let i = 0; i < titleIds.length; i += CHUNK) {
    const chunk = titleIds.slice(i, i + CHUNK)

    for (const row of getDb()
      .select()
      .from(profileTitles)
      .where(
        and(
          eq(profileTitles.profileId, profileId),
          inArray(profileTitles.titleId, chunk),
        ),
      )
      .all()) {
      rows.set(row.titleId, row)
    }
  }

  return rows
}

export interface ImportConflictSample {
  titleId: string
  title: string
  current: number
  incoming: number
}

export interface ImportPreview {
  sources: ImportSource[]
  ratings: { new: number, same: number, conflicts: number }
  watchlist: { new: number, same: number }
  unsure: number
  notFound: number
  skipped: number
  conflictSamples: ImportConflictSample[]
  // «Более поздняя» имеет смысл, только когда у конфликтов есть даты
  conflictsDated: boolean
}

function previewOf(job: ImportJob): ImportPreview {
  const { matched, unmatched } = groupEntries(job)
  const rows = currentRows(job.profileId, [...matched.keys()])
  const preview: ImportPreview = {
    sources: job.sources,
    ratings: { new: 0, same: 0, conflicts: 0 },
    watchlist: { new: 0, same: 0 },
    unsure: unmatched.filter(item => item.result.status === 'unsure').length,
    notFound: unmatched.filter(item => item.result.status === 'notFound')
      .length,
    skipped: job.skipped,
    conflictSamples: [],
    conflictsDated: false,
  }

  for (const [titleId, incoming] of matched) {
    const current = rows.get(titleId)
    const outcome = ratingOutcome(current, incoming)

    if (outcome === 'new') {
      preview.ratings.new++
    }
    else if (outcome === 'same') {
      preview.ratings.same++
    }
    else if (outcome === 'conflict') {
      preview.ratings.conflicts++

      if (incoming.ratedAt)
        preview.conflictsDated = true

      if (preview.conflictSamples.length < CONFLICT_SAMPLES) {
        preview.conflictSamples.push({
          titleId,
          title: incoming.title,
          current: current!.rating!,
          incoming: incoming.rating!,
        })
      }
    }

    if (incoming.watchlistAt !== undefined) {
      const rated
        = incoming.kind === 'movie' && (current?.rating || incoming.rating)

      if (current?.watchlistAt || rated)
        preview.watchlist.same++
      else preview.watchlist.new++
    }
  }

  return preview
}

export interface ImportJobView {
  id: string
  state: JobState
  progress: { done: number, total: number }
  error?: 'catalog'
  preview?: ImportPreview
}

function viewOf(job: ImportJob, withPreview: boolean): ImportJobView {
  return {
    id: job.id,
    state: job.state,
    progress: { done: job.done, total: job.total },
    error: job.error,
    preview: withPreview && job.state === 'ready' ? previewOf(job) : undefined,
  }
}

export function getImportJob(profileId: string, id: string) {
  return viewOf(jobOf(profileId, id), true)
}

function undoValues(row: ProfileTitle | undefined): ImportUndoEntry['before'] {
  if (!row)
    return null

  return {
    watchlistAt: row.watchlistAt?.getTime() ?? null,
    favoriteAt: row.favoriteAt?.getTime() ?? null,
    rating: row.rating,
    ratedAt: row.ratedAt?.getTime() ?? null,
    droppedAt: row.droppedAt?.getTime() ?? null,
    updatedAt: row.updatedAt.getTime(),
  }
}

function writeMine(
  profileId: string,
  titleId: string,
  values: MineValues,
  now: Date,
) {
  const row = { profileId, titleId, ...values, updatedAt: now }

  getDb()
    .insert(profileTitles)
    .values(row)
    .onConflictDoUpdate({
      target: [profileTitles.profileId, profileTitles.titleId],
      set: row,
    })
    .run()
}

/**
 * Применяет предпросмотр одной транзакцией. Прежние значения изменённых
 * строк уходят в запись импорта для отмены, несопоставленное — в строки,
 * которые владелец разберёт сам.
 */
export function applyImport(
  profileId: string,
  id: string,
  policy: ConflictPolicy,
) {
  const job = jobOf(profileId, id)

  if (job.state !== 'ready')
    throw new ImportStateError()

  const { matched, unmatched } = groupEntries(job)
  const rows = currentRows(profileId, [...matched.keys()])
  const now = new Date()
  const undo: ImportUndoEntry[] = []
  const summary: ImportSummary = {
    imported: 0,
    unchanged: 0,
    unmatched: unmatched.length,
  }
  const importId = randomUUID()
  const db = getDb()

  db.transaction((tx) => {
    for (const [titleId, incoming] of matched) {
      const current = rows.get(titleId)
      const next = mergeMine(current, incoming, policy, now)

      if (!next) {
        summary.unchanged++
        continue
      }

      undo.push({ titleId, before: undoValues(current) })
      writeMine(profileId, titleId, next, now)
      summary.imported++
    }

    tx.insert(profileImports)
      .values({
        id: importId,
        profileId,
        sources: job.sources.join(','),
        conflicts: policy,
        summary,
        undo,
        appliedAt: now,
      })
      .run()

    unmatched.forEach(({ entry, result }, position) => {
      tx.insert(profileImportRows)
        .values({
          importId,
          profileId,
          list: entry.list,
          status: result.status,
          title: entry.title || entry.imdbId || String(entry.tmdbId ?? ''),
          year: entry.year ?? null,
          kind: entry.kind ?? null,
          rating: entry.rating ?? null,
          at: entry.at ?? null,
          suggestion: result.status === 'unsure' ? result.suggestion : null,
          position,
        })
        .run()
    })
  })

  jobs.delete(id)
  logFor('catalog').info(
    { profileId, importId, ...summary },
    'Ratings imported',
  )

  return { id: importId, ...summary }
}

function canUndo(row: ProfileImport, now = Date.now()) {
  return (
    !row.undoneAt
    && !!row.undo
    && now - row.appliedAt.getTime() < UNDO_WINDOW_MS
  )
}

/**
 * Возвращает строки, как были до импорта. Тайтл, который после импорта
 * меняли руками, остаётся как есть: свежая правка важнее отмены.
 */
export function undoImport(profileId: string, id: string) {
  const db = getDb()
  const row = db
    .select()
    .from(profileImports)
    .where(
      and(eq(profileImports.id, id), eq(profileImports.profileId, profileId)),
    )
    .get()

  if (!row)
    throw new ImportNotFoundError()

  if (!canUndo(row))
    throw new ImportStateError()

  const applied = row.appliedAt.getTime()
  const rows = currentRows(
    profileId,
    row.undo!.map(item => item.titleId),
  )
  let restored = 0
  let kept = 0

  db.transaction((tx) => {
    for (const { titleId, before } of row.undo!) {
      const current = rows.get(titleId)

      if (!current || current.updatedAt.getTime() !== applied) {
        kept++
        continue
      }

      if (before) {
        writeMine(
          profileId,
          titleId,
          {
            watchlistAt: before.watchlistAt
              ? new Date(before.watchlistAt)
              : null,
            favoriteAt: before.favoriteAt ? new Date(before.favoriteAt) : null,
            rating: before.rating,
            ratedAt: before.ratedAt ? new Date(before.ratedAt) : null,
            droppedAt: before.droppedAt ? new Date(before.droppedAt) : null,
          },
          new Date(before.updatedAt),
        )
      }
      else {
        tx.delete(profileTitles)
          .where(
            and(
              eq(profileTitles.profileId, profileId),
              eq(profileTitles.titleId, titleId),
            ),
          )
          .run()
      }

      restored++
    }

    tx.update(profileImports)
      .set({ undoneAt: new Date(), undo: null })
      .where(eq(profileImports.id, id))
      .run()
    tx.delete(profileImportRows)
      .where(eq(profileImportRows.importId, id))
      .run()
  })

  return { restored, kept }
}

export function importOverview(profileId: string) {
  const db = getDb()
  const job = activeJobOf(profileId)
  const last = db
    .select()
    .from(profileImports)
    .where(
      and(
        eq(profileImports.profileId, profileId),
        isNull(profileImports.undoneAt),
      ),
    )
    .orderBy(desc(profileImports.appliedAt))
    .get()
  const unmatched = db
    .select({ total: count() })
    .from(profileImportRows)
    .where(eq(profileImportRows.profileId, profileId))
    .get()!
    .total

  return {
    job: job ? viewOf(job, false) : null,
    last: last
      ? {
          id: last.id,
          appliedAt: last.appliedAt,
          summary: last.summary,
          canUndo: canUndo(last),
        }
      : null,
    unmatched,
  }
}

export function unmatchedRows(
  profileId: string,
  offset: number,
  limit: number,
) {
  const db = getDb()
  const where = eq(profileImportRows.profileId, profileId)
  const items = db
    .select({ row: profileImportRows })
    .from(profileImportRows)
    .innerJoin(
      profileImports,
      eq(profileImports.id, profileImportRows.importId),
    )
    .where(where)
    .orderBy(desc(profileImports.appliedAt), asc(profileImportRows.position))
    .limit(limit)
    .offset(offset)
    .all()
    .map(item => item.row)
  const total = db
    .select({ total: count() })
    .from(profileImportRows)
    .where(where)
    .get()!
    .total

  return { items, total }
}

function rowOf(profileId: string, rowId: string) {
  const row = getDb()
    .select({ row: profileImportRows, conflicts: profileImports.conflicts })
    .from(profileImportRows)
    .innerJoin(
      profileImports,
      eq(profileImports.id, profileImportRows.importId),
    )
    .where(
      and(
        eq(profileImportRows.id, rowId),
        eq(profileImportRows.profileId, profileId),
      ),
    )
    .get()

  if (!row)
    throw new ImportNotFoundError()

  return row
}

/** Ручное сопоставление: строка ложится по политике конфликтов своего импорта */
export function matchUnmatchedRow(
  profileId: string,
  rowId: string,
  titleId: string,
) {
  const { row, conflicts } = rowOf(profileId, rowId)
  const now = new Date()
  const incoming: IncomingMine = {
    kind: kindOfTitle(titleId),
    ...(row.list === 'rating'
      ? { rating: row.rating ?? undefined, ratedAt: row.at ?? undefined }
      : { watchlistAt: row.at }),
  }
  const db = getDb()

  db.transaction((tx) => {
    const current = currentRows(profileId, [titleId]).get(titleId)
    const next = mergeMine(current, incoming, conflicts, now)

    if (next)
      writeMine(profileId, titleId, next, now)

    tx.delete(profileImportRows).where(eq(profileImportRows.id, rowId)).run()
  })
}

export function dismissUnmatchedRow(profileId: string, rowId: string) {
  rowOf(profileId, rowId)
  getDb()
    .delete(profileImportRows)
    .where(eq(profileImportRows.id, rowId))
    .run()
}

/** Отмена доступна неделю, история импорта и несопоставленное — 90 дней */
export function purgeImports(now = Date.now()) {
  const db = getDb()

  db.update(profileImports)
    .set({ undo: null })
    .where(lt(profileImports.appliedAt, new Date(now - UNDO_WINDOW_MS)))
    .run()
  db.delete(profileImports)
    .where(lt(profileImports.appliedAt, new Date(now - KEEP_IMPORTS_MS)))
    .run()
}

/** Для тестов: незавершённые задачи живут в памяти процесса */
export function resetImportJobs() {
  jobs.clear()
}

/** Для тестов: дождаться окончания сопоставления */
export async function importJobSettled(id: string) {
  while (jobs.get(id)?.state === 'matching')
    await new Promise(resolve => setTimeout(resolve, 5))
}
