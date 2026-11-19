import { assertMaintenancePolicyChange } from '../libraryMaintenance/admission.ts'
import type {
  ImportProgressUndoEntry,
  ImportSummary,
  ImportUndoEntry,
  ProfileImport,
  ProfileTitle,
} from '../../db/schema.ts'
import type {
  ImportedViewing,
  ImportEntry,
  ImportFile,
  ImportKind,
  ImportSource,
  PendingViewingGroup,
} from './formats.ts'
import type { MatchResult } from './match.ts'
import type { ConflictPolicy, IncomingMine, MineValues } from './merge.ts'
import type { HistoryImportCounts, PersonalRows } from './personalSpace.ts'
import type { ProfileRows } from './profileData.ts'
import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { and, asc, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  diaryEntries,
  profileImportRows,
  profileImports,
  profileTitles,
} from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { TmdbError } from '../tmdb/client.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import {
  DocumentError,
  looksLikeExport,
  parseExportDocument,
} from './document.ts'
import { ensureDiaryTimeZone } from './diaryTimeZone.ts'
import { personalRowsOf, planPersonalMerge } from './personalSpace.ts'
import { undoJournal, UndoJournalBuilder } from './undoJournal.ts'
import { ImportFormatError, parseImportFiles } from './formats.ts'
import { matchEntry, matchKey } from './match.ts'
import { mergeMine, ratingOutcome } from './merge.ts'
import {
  applyProfileMerge,
  planProfileMerge,
  undoProgress,
} from './profileData.ts'

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

export class HistoryMatchConflictError extends Error {
  readonly reason: 'titleKind' | 'sourceIdentity'

  constructor(reason: 'titleKind' | 'sourceIdentity') {
    super('historyMatchConflict')
    this.name = 'HistoryMatchConflictError'
    this.reason = reason
  }
}

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
  // Экспорт профиля Torsher: тайтлы уже с ID, сопоставлять нечего
  document?: ProfileRows
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
          logFor('catalog').warn(
            { kind: err.kind },
            'Profile import matching failed',
          )

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

function textOf(file: ImportFile) {
  // gzip: экспорт можно загрузить и сжатым
  const data
    = file.data[0] === 0x1F && file.data[1] === 0x8B
      ? gunzipSync(file.data)
      : file.data

  return data.toString('utf8')
}

/** Экспорт Torsher с одним профилем или `undefined`, если это другой файл */
function exportRowsOf(files: ImportFile[]): ProfileRows | undefined {
  if (files.length !== 1)
    return undefined

  let text: string

  try {
    text = textOf(files[0]!)
  }
  catch {
    throw new ImportFormatError('broken', files[0]!.name)
  }

  if (!looksLikeExport(text))
    return undefined

  try {
    const document = parseExportDocument(text)

    if (document.profiles.length !== 1)
      throw new ImportFormatError('serverExport', files[0]!.name)

    return {
      progress: document.progress,
      mine: document.mine,
      personal: personalRowsOf(document, document.profiles[0]!.key),
    }
  }
  catch (err) {
    if (err instanceof DocumentError) {
      throw new ImportFormatError(
        err.kind === 'newerVersion' ? 'newerVersion' : 'broken',
        files[0]!.name,
      )
    }

    throw err
  }
}

function replaceJob(profileId: string, job: ImportJob) {
  const previous = activeJobOf(profileId)

  if (previous)
    jobs.delete(previous.id)

  jobs.set(job.id, job)
}

/**
 * Разбирает файлы сразу (неподдерживаемый файл — ошибка запроса) и
 * запускает сопоставление в фоне. У профиля одна задача: новая заменяет
 * прежнюю, ещё не применённую. Экспорт профиля Torsher готов сразу.
 */
export function startImport(profileId: string, files: ImportFile[]) {
  const document = exportRowsOf(files)

  if (document) {
    const job: ImportJob = {
      id: randomUUID(),
      profileId,
      state: 'ready',
      entries: [],
      skipped: 0,
      sources: ['torsher'],
      results: new Map(),
      total: 0,
      done: 0,
      finishedAt: Date.now(),
      document,
    }

    replaceJob(profileId, job)

    return job
  }

  const parsed = parseImportFiles(files)
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

  replaceJob(profileId, job)
  runMatching(job).catch(() => {
    job.state = 'failed'
    job.error = 'catalog'
    job.finishedAt = Date.now()
    logFor('catalog').error('Profile import matching crashed')
  })

  return job
}

export function cancelImport(profileId: string, id: string) {
  jobOf(profileId, id)
  jobs.delete(id)
}

interface UnmatchedEntry {
  entry: ImportEntry
  result: Exclude<MatchResult, { status: 'matched' }>
  viewings?: PendingViewingGroup
}

interface Grouped {
  matched: Map<string, IncomingMine & { title: string }>
  history: Map<string, ImportedViewing[]>
  unmatched: UnmatchedEntry[]
  historyConflicts: number
  historyKnown: number
}

function groupingOf(job: ImportJob, entry: ImportEntry) {
  const match = matchKey(entry)
  const key = entry.viewing ? JSON.stringify([match, entry.kind]) : match
  const result = job.results.get(match) ?? { status: 'notFound' as const }
  if (
    entry.viewing
    && entry.kind
    && result.status === 'matched'
    && entry.kind !== kindOfTitle(result.titleId)
  ) {
    return { key, result: { status: 'notFound' as const } }
  }
  return { key, result }
}

function viewingIdentity(viewing: Extract<ImportedViewing, { kind: 'entry' }>) {
  return JSON.stringify([viewing.origin, viewing.originKey])
}

function pendingHistoryRows(profileId: string) {
  return getDb()
    .select({
      id: profileImportRows.id,
      kind: profileImportRows.kind,
      viewings: profileImportRows.viewings,
    })
    .from(profileImportRows)
    .where(
      and(
        eq(profileImportRows.profileId, profileId),
        eq(profileImportRows.list, 'history'),
      ),
    )
    .all()
}

function sourceMatchKey(key: string) {
  return createHash('sha256').update(key).digest('hex')
}

function viewingMatch(
  key: string | null | undefined,
  item: { season: number, episode: number },
  kind: ImportKind | null | undefined,
) {
  return JSON.stringify([key ?? null, kind, item.season, item.episode])
}

function knownUnmatchedHistory(job: ImportJob) {
  const pending = new Map<string, string>()
  const saved = new Map<string, string>()
  const keys = new Set(
    job.entries.flatMap((entry) => {
      const item = entry.viewing
      return item?.kind === 'entry'
        && groupingOf(job, entry).result.status !== 'matched'
        ? [item.originKey]
        : []
    }),
  )

  if (
    !job.entries.some(
      entry =>
        entry.viewing && groupingOf(job, entry).result.status !== 'matched',
    )
  ) {
    return { pending, saved }
  }

  for (const { kind, viewings } of pendingHistoryRows(job.profileId)) {
    if (!viewings)
      continue
    for (const item of viewings.items) {
      const proof = viewingMatch(sourceMatchKey(viewings.matchKey), item, kind)
      pending.set(item.kind === 'entry' ? viewingIdentity(item) : proof, proof)
    }
  }

  const originKeys = [...keys]
  for (let i = 0; i < originKeys.length; i += CHUNK) {
    const rows = getDb()
      .select({
        origin: diaryEntries.origin,
        originKey: diaryEntries.originKey,
        sourceMatchKey: diaryEntries.sourceMatchKey,
        titleId: diaryEntries.titleId,
        season: diaryEntries.season,
        episode: diaryEntries.episode,
      })
      .from(diaryEntries)
      .where(
        and(
          eq(diaryEntries.profileId, job.profileId),
          inArray(diaryEntries.originKey, originKeys.slice(i, i + CHUNK)),
        ),
      )
      .all()
    for (const row of rows) {
      saved.set(
        JSON.stringify([row.origin, row.originKey]),
        viewingMatch(row.sourceMatchKey, row, kindOfTitle(row.titleId)),
      )
    }
  }
  return { pending, saved }
}

function uniqueHistory(job: ImportJob) {
  const events = new Map<string, { entry: ImportEntry, target: string }>()
  const conflicts = new Set<string>()
  for (const entry of job.entries) {
    const viewing = entry.viewing
    if (viewing?.kind !== 'entry')
      continue

    const identity = viewingIdentity(viewing)
    const { key, result } = groupingOf(job, entry)
    const target = JSON.stringify([
      result.status === 'matched' ? result.titleId : key,
      viewing.season,
      viewing.episode,
    ])
    const first = events.get(identity)
    if (!first) {
      events.set(identity, { entry, target })
      continue
    }

    if (first.target !== target)
      conflicts.add(identity)
  }
  return {
    entries: new Set(
      [...events].flatMap(([id, { entry }]) =>
        conflicts.has(id) ? [] : [entry],
      ),
    ),
    conflicts: conflicts.size,
  }
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
  const history: Grouped['history'] = new Map()
  const unmatched = new Map<string, UnmatchedEntry>()
  const events = uniqueHistory(job)
  const { pending, saved } = knownUnmatchedHistory(job)
  let historyKnown = 0
  let historyConflicts = events.conflicts

  for (const entry of job.entries) {
    const { key, result } = groupingOf(job, entry)
    const viewing = entry.viewing
    if (viewing?.kind === 'entry' && !events.entries.has(entry))
      continue

    if (result.status !== 'matched') {
      if (viewing) {
        const proof = viewingMatch(sourceMatchKey(key), viewing, entry.kind)
        const identity
          = viewing.kind === 'entry' ? viewingIdentity(viewing) : proof
        const stored = saved.get(identity)
        const enqueued = pending.get(identity)
        const earlier = stored ?? enqueued
        if (earlier !== undefined) {
          if (earlier !== proof)
            historyConflicts++
          else if (stored !== undefined)
            historyKnown++
          continue
        }
        pending.set(identity, proof)
      }

      const unmatchedKey = `${entry.list}:${key}`
      const item = unmatched.get(unmatchedKey) ?? { entry, result }
      if (viewing) {
        item.viewings ??= { matchKey: key, items: [] }
        item.viewings.items.push(viewing)
      }
      unmatched.set(unmatchedKey, item)
      continue
    }

    if (viewing) {
      const viewings = history.get(result.titleId) ?? []
      viewings.push(
        viewing.kind === 'entry'
          ? { ...viewing, sourceMatchKey: sourceMatchKey(key) }
          : viewing,
      )
      history.set(result.titleId, viewings)
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
    else if (entry.list === 'watched') {
      current.watchedMarkedAt = null
    }
    else if (entry.list === 'watchlist') {
      const at = entry.at ?? null

      if (current.watchlistAt === undefined)
        current.watchlistAt = at
      else if (at && (!current.watchlistAt || at < current.watchlistAt))
        current.watchlistAt = at
    }

    matched.set(result.titleId, current)
  }

  return {
    matched,
    history,
    unmatched: [...unmatched.values()],
    historyConflicts,
    historyKnown,
  }
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

function planHistory(
  profileId: string,
  history: Grouped['history'],
  now: Date,
  confirm = false,
) {
  const rows: PersonalRows = {
    diary: [],
    seen: [],
    cycles: [],
    cycleProgress: [],
    cyclePlayback: [],
    titlePreferences: [],
    profilePreferences: [],
  }
  const timestamp = now.toISOString()
  for (const [title, viewings] of history) {
    for (const item of viewings) {
      const target = {
        profile: profileId,
        title,
        season: item.season,
        episode: item.episode,
      }
      if (item.kind === 'seen') {
        rows.seen.push(target)
        continue
      }
      rows.diary.push({
        ...target,
        ...item.date,
        id: randomUUID(),
        origin: item.origin,
        originKey: item.originKey,
        sourceMatchKey: item.sourceMatchKey,
        rewatch: item.rewatch,
        note: item.note,
        viewingContext: item.viewingContext,
        context: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
  }
  const plan = planPersonalMerge(
    profileId,
    rows,
    confirm ? 'external-confirmed' : 'external',
  )
  return { ...plan, counts: plan.history! }
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
  watched: { new: number, same: number }
  unsure: number
  notFound: number
  skipped: number
  conflictSamples: ImportConflictSample[]
  // «Более поздняя» имеет смысл, только когда у конфликтов есть даты
  conflictsDated: boolean
  progress?: { new: number, updated: number, same: number }
  favorites?: { new: number, same: number }
  dropped?: { new: number, same: number }
  personal?: { changed: number, unchanged: number, skipped: number }
  history?: HistoryImportCounts
}

function documentPreviewOf(job: ImportJob, document: ProfileRows) {
  const { counts } = planProfileMerge(job.profileId, document, 'newer')

  return {
    sources: job.sources,
    ratings: counts.ratings,
    watchlist: counts.watchlist,
    watched: counts.watched,
    unsure: 0,
    notFound: 0,
    skipped: counts.skipped,
    // Названий в файле нет: пример «у вас 7, в файле 9» без названия не нужен
    conflictSamples: [],
    conflictsDated: counts.conflictsDated,
    progress: counts.progress,
    favorites: counts.favorites,
    dropped: counts.dropped,
    personal: counts.personal,
  }
}

function previewOf(job: ImportJob): ImportPreview {
  if (job.document)
    return documentPreviewOf(job, job.document)

  const { matched, history, unmatched, historyConflicts, historyKnown }
    = groupEntries(job)
  const rows = currentRows(job.profileId, [...matched.keys()])
  const preview: ImportPreview = {
    sources: job.sources,
    ratings: { new: 0, same: 0, conflicts: 0 },
    watchlist: { new: 0, same: 0 },
    watched: { new: 0, same: 0 },
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

    if (incoming.watchedMarkedAt !== undefined) {
      if (current?.watchedMarkedAt)
        preview.watched.same++
      else preview.watched.new++
    }

    if (incoming.watchlistAt !== undefined) {
      const rated
        = incoming.kind === 'movie'
          && (current?.rating
            || incoming.rating
            || current?.watchedMarkedAt
            || incoming.watchedMarkedAt !== undefined)

      if (current?.watchlistAt || rated)
        preview.watchlist.same++
      else preview.watchlist.new++
    }
  }

  if (job.entries.some(entry => entry.viewing)) {
    const { counts } = planHistory(job.profileId, history, new Date())
    preview.history = {
      ...counts,
      same: counts.same + historyKnown,
      skipped: counts.skipped + historyConflicts,
    }
    // Top-level skipped belongs to legacy table-level UI. history.skipped
    // names the subset due to a viewing identity that could not be imported.
    preview.skipped += preview.history.skipped
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

function writeMine(
  profileId: string,
  titleId: string,
  values: MineValues,
  now: Date,
) {
  assertMaintenancePolicyChange({ titleId })
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

  if (job.document)
    return applyDocument(job, job.document, policy)

  const { matched, history, unmatched, historyConflicts, historyKnown }
    = groupEntries(job)
  const now = new Date()
  const journal = new UndoJournalBuilder(profileId)
  const summary: ImportSummary = {
    imported: 0,
    unchanged: 0,
    unmatched: unmatched.length,
  }
  const importId = randomUUID()
  const db = getDb()

  db.transaction((tx) => {
    const rows = currentRows(profileId, [...matched.keys()])
    for (const [titleId, incoming] of matched) {
      const current = rows.get(titleId)
      const next = mergeMine(current, incoming, policy, now)

      if (!next)
        continue

      journal.record('mine', [titleId], titleId)
      writeMine(profileId, titleId, next, now)
    }

    if (job.entries.some(entry => entry.viewing)) {
      const plan = planHistory(profileId, history, now)
      summary.history = {
        ...plan.counts,
        same: plan.counts.same + historyKnown,
        skipped: plan.counts.skipped + historyConflicts,
      }
      if (plan.writes.length)
        ensureDiaryTimeZone()
      for (const write of plan.writes) write(profileId, journal)
    }

    const undo = journal.finish()
    const updatedTitles = new Set(undo.groups.map(group => group.titleId))
    const inputTitles = new Set([...matched.keys(), ...history.keys()])
    summary.imported = updatedTitles.size
    summary.unchanged = inputTitles.size - updatedTitles.size

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

    unmatched.forEach(({ entry, result, viewings }, position) => {
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
          viewings,
          suggestion: result.status === 'unsure' ? result.suggestion : null,
          position,
        })
        .run()
    })
  })

  jobs.delete(id)
  logFor('catalog').info(
    { profileId, importId, ...summary },
    'Profile data imported',
  )

  return { id: importId, ...summary }
}

/** Экспорт профиля Torsher: позиции и «Моё» одной транзакцией */
function applyDocument(
  job: ImportJob,
  document: ProfileRows,
  policy: ConflictPolicy,
) {
  const now = new Date()
  const importId = randomUUID()
  const db = getDb()
  let summary: ImportSummary = { imported: 0, unchanged: 0, unmatched: 0 }

  db.transaction((tx) => {
    const plan = planProfileMerge(job.profileId, document, policy, now)
    if (document.personal)
      ensureDiaryTimeZone()

    const journal = new UndoJournalBuilder(job.profileId)
    applyProfileMerge(job.profileId, plan, now, journal)
    const undo = journal.finish()
    const { counts } = plan
    const changedTitles = new Set(
      undo.groups.flatMap(group =>
        group.titleId === null ? [] : [group.titleId],
      ),
    )

    summary = {
      // Progress episodes and mine changes may belong to the same title.
      imported: changedTitles.size,
      unchanged: [...plan.unchangedTitles].filter(
        title => !changedTitles.has(title),
      ).length,
      // Native data already has identifiers. Skipped rows never enter matching.
      unmatched: 0,
      ...(counts.personal && { personal: counts.personal }),
      ...(counts.skipped > 0 && { skipped: counts.skipped }),
    }

    tx.insert(profileImports)
      .values({
        id: importId,
        profileId: job.profileId,
        sources: job.sources.join(','),
        conflicts: policy,
        summary,
        undo,
        appliedAt: now,
      })
      .run()
  })

  jobs.delete(job.id)
  logFor('catalog').info(
    { profileId: job.profileId, importId, ...summary },
    'Profile data imported',
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

  const journal = row.undo!
  return db.transaction((tx) => {
    const result = Array.isArray(journal)
      ? undoLegacyImport(profileId, row.appliedAt.getTime(), journal)
      : undoJournal(profileId, journal)

    tx.update(profileImports)
      .set({ undoneAt: new Date(), undo: null })
      .where(eq(profileImports.id, id))
      .run()
    tx.delete(profileImportRows)
      .where(eq(profileImportRows.importId, id))
      .run()
    return result
  })
}

function undoLegacyImport(
  profileId: string,
  applied: number,
  entries: Array<ImportUndoEntry | ImportProgressUndoEntry>,
) {
  const mineUndo = entries.filter(
    (item): item is ImportUndoEntry => !('table' in item),
  )
  const progressUndo = entries.filter(item => 'table' in item)
  const rows = currentRows(
    profileId,
    mineUndo.map(item => item.titleId),
  )
  let restored = 0
  let kept = 0

  for (const entry of progressUndo) {
    if (undoProgress(profileId, entry))
      restored++
    else kept++
  }

  for (const { titleId, before } of mineUndo) {
    const current = rows.get(titleId)

    if (
      !current
      || current.mutationToken !== null
      || current.updatedAt.getTime() !== applied
    ) {
      kept++
      continue
    }

    if (before) {
      writeMine(
        profileId,
        titleId,
        {
          watchlistAt: before.watchlistAt ? new Date(before.watchlistAt) : null,
          favoriteAt: before.favoriteAt ? new Date(before.favoriteAt) : null,
          rating: before.rating,
          ratedAt: before.ratedAt ? new Date(before.ratedAt) : null,
          droppedAt: before.droppedAt ? new Date(before.droppedAt) : null,
          watchedMarkedAt:
            before.watchedMarkedAt === undefined
              ? current.watchedMarkedAt
              : before.watchedMarkedAt === null
                ? null
                : new Date(before.watchedMarkedAt),
        },
        new Date(before.updatedAt),
      )
    }
    else {
      getDb()
        .delete(profileTitles)
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
  if (row.list === 'history') {
    matchUnmatchedHistory(profileId, row, titleId, now)
    return
  }

  const incoming: IncomingMine = {
    kind: kindOfTitle(titleId),
    ...(row.list === 'rating'
      ? { rating: row.rating ?? undefined, ratedAt: row.at ?? undefined }
      : row.list === 'watchlist'
        ? { watchlistAt: row.at }
        : { watchedMarkedAt: null }),
  }
  const db = getDb()

  db.transaction((tx) => {
    const current = currentRows(profileId, [titleId]).get(titleId)
    const next = mergeMine(current, incoming, conflicts, now)

    if (next) {
      writeMine(
        profileId,
        titleId,
        next,
        new Date(
          Math.max(now.getTime(), (current?.updatedAt.getTime() ?? -1) + 1),
        ),
      )
    }

    tx.delete(profileImportRows).where(eq(profileImportRows.id, rowId)).run()
  })
}

function matchUnmatchedHistory(
  profileId: string,
  row: {
    id: string
    kind: ImportKind | null
    viewings: PendingViewingGroup | null
  },
  titleId: string,
  now: Date,
) {
  const kind = kindOfTitle(titleId)
  const group = row.viewings
  if (!group || (row.kind && row.kind !== kind))
    throw new HistoryMatchConflictError('titleKind')

  const db = getDb()
  db.transaction((tx) => {
    const related = pendingHistoryRows(profileId).filter(
      item => item.viewings?.matchKey === group.matchKey,
    )
    const proof = sourceMatchKey(group.matchKey)
    const viewings = related
      .flatMap(item => item.viewings!.items)
      .map(item =>
        item.kind === 'entry' ? { ...item, sourceMatchKey: proof } : item,
      )
    if (kind === 'movie' && viewings.some(item => item.episode > 0))
      throw new HistoryMatchConflictError('titleKind')

    const plan = planHistory(
      profileId,
      new Map([[titleId, viewings]]),
      now,
      true,
    )
    if (plan.counts.skipped)
      throw new HistoryMatchConflictError('sourceIdentity')

    if (plan.writes.length)
      ensureDiaryTimeZone()
    // Manual resolution is an explicit later action outside batch undo.
    for (const write of plan.writes) write(profileId)

    for (let i = 0; i < related.length; i += CHUNK) {
      tx.delete(profileImportRows)
        .where(
          inArray(
            profileImportRows.id,
            related.slice(i, i + CHUNK).map(item => item.id),
          ),
        )
        .run()
    }
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
