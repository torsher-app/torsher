import type {
  ImportProgressUndoEntry,
  ImportUndoEntry,
  ProfileTitle,
  TitleProgress,
} from '../../db/schema.ts'
import type { ExportMine, ExportProgress } from './document.ts'
import type { ConflictPolicy, IncomingMine, MineValues } from './merge.ts'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  libraries,
  libraryFolders,
  mediaFiles,
  profileTitles,
  titleProgress,
} from '../../db/schema.ts'
import { fileProgressId } from '../library/files.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { isWatched } from '../torrents/playback.ts'
import { mergeMine, ratingOutcome } from './merge.ts'

// SQLite ограничивает число параметров запроса
const CHUNK = 500
const CONFLICT_SAMPLES = 5

/** Данные одного профиля из файла экспорта */
export interface ProfileRows {
  progress: ExportProgress[]
  mine: ExportMine[]
}

export interface ProfileMergeCounts {
  progress: { new: number, updated: number, same: number }
  ratings: { new: number, same: number, conflicts: number }
  watchlist: { new: number, same: number }
  favorites: { new: number, same: number }
  dropped: { new: number, same: number }
  // Тайтлы не из каталога и файлы библиотеки, которых нет на сервере
  skipped: number
  conflictSamples: Array<{
    titleId: string
    title: string
    current: number
    incoming: number
  }>
  conflictsDated: boolean
}

interface IncomingProgress {
  titleId: string
  season: number
  episode: number
  position: number
  duration: number | null
  voiceStudio: string | null
  voiceType: string | null
  watchedAt: Date | null
  updatedAt: Date
}

function emptyCounts(): ProfileMergeCounts {
  return {
    progress: { new: 0, updated: 0, same: 0 },
    ratings: { new: 0, same: 0, conflicts: 0 },
    watchlist: { new: 0, same: 0 },
    favorites: { new: 0, same: 0 },
    dropped: { new: 0, same: 0 },
    skipped: 0,
    conflictSamples: [],
    conflictsDated: false,
  }
}

function date(value: string | null) {
  return value ? new Date(value) : undefined
}

function kindOf(titleId: string): IncomingMine['kind'] {
  return parseCatalogId(titleId)?.type === 'movie' ? 'movie' : 'series'
}

function fileKey(folder: string, path: string) {
  return `${folder}\u0000${path.normalize('NFC')}`
}

/** Файлы подключённых папок этого сервера по пути папки и файла */
function libraryFileIds(rows: ExportProgress[]) {
  const ids = new Map<string, string>()

  if (!rows.some(row => row.file))
    return ids

  for (const row of getDb()
    .select({
      id: mediaFiles.id,
      relPath: mediaFiles.relPath,
      folder: libraryFolders.path,
    })
    .from(mediaFiles)
    .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(eq(libraries.managed, false))
    .all()) {
    ids.set(fileKey(row.folder, row.relPath), row.id)
  }

  return ids
}

function incomingProgress(rows: ExportProgress[]) {
  const files = libraryFileIds(rows)
  const resolved: IncomingProgress[] = []
  let skipped = 0

  for (const row of rows) {
    const fileId
      = row.file && files.get(fileKey(row.file.folder, row.file.path))
    const titleId = row.title
      ? parseCatalogId(row.title)
        ? row.title
        : undefined
      : fileId
        ? fileProgressId(fileId)
        : undefined

    if (!titleId) {
      skipped++
      continue
    }

    resolved.push({
      titleId,
      season: row.season,
      episode: row.episode,
      voiceStudio: row.voiceStudio,
      voiceType: row.voiceType,
      updatedAt: new Date(row.updatedAt),
      ...watchedOf(row),
    })
  }

  return { resolved, skipped }
}

/**
 * Отметка и позиция строки файла. В файлах прошлых версий отметки нет: она
 * выводится из позиции, как тогда, а отметка с карточки (позиция 1 из 1)
 * становится отметкой без позиции
 */
function watchedOf(row: ExportProgress) {
  if (row.watchedAt !== undefined) {
    return {
      position: row.position,
      duration: row.duration,
      watchedAt: row.watchedAt ? new Date(row.watchedAt) : null,
    }
  }

  const watchedAt = isWatched(row.position, row.duration)
    ? new Date(row.updatedAt)
    : null

  return row.position === 1 && row.duration === 1
    ? { position: 0, duration: null, watchedAt }
    : { position: row.position, duration: row.duration, watchedAt }
}

function incomingMine(rows: ExportMine[]) {
  const resolved = new Map<string, IncomingMine>()
  let skipped = 0

  for (const row of rows) {
    if (!parseCatalogId(row.title)) {
      skipped++
      continue
    }

    resolved.set(row.title, {
      kind: kindOf(row.title),
      rating: row.rating ?? undefined,
      ratedAt: row.rating ? date(row.ratedAt) : undefined,
      watchlistAt: row.watchlistAt ? new Date(row.watchlistAt) : undefined,
      favoriteAt: date(row.favoriteAt),
      droppedAt: date(row.droppedAt),
    })
  }

  return { resolved, skipped }
}

function progressKey(row: {
  titleId: string
  season: number
  episode: number
}) {
  return `${row.titleId}\u0000${row.season}\u0000${row.episode}`
}

function currentProgress(profileId: string | null, titleIds: string[]) {
  const rows = new Map<string, TitleProgress>()

  if (!profileId)
    return rows

  const unique = [...new Set(titleIds)]

  for (let i = 0; i < unique.length; i += CHUNK) {
    for (const row of getDb()
      .select()
      .from(titleProgress)
      .where(
        and(
          eq(titleProgress.profileId, profileId),
          inArray(titleProgress.titleId, unique.slice(i, i + CHUNK)),
        ),
      )
      .all()) {
      rows.set(progressKey(row), row)
    }
  }

  return rows
}

function currentMine(profileId: string | null, titleIds: string[]) {
  const rows = new Map<string, ProfileTitle>()

  if (!profileId)
    return rows

  for (let i = 0; i < titleIds.length; i += CHUNK) {
    for (const row of getDb()
      .select()
      .from(profileTitles)
      .where(
        and(
          eq(profileTitles.profileId, profileId),
          inArray(profileTitles.titleId, titleIds.slice(i, i + CHUNK)),
        ),
      )
      .all()) {
      rows.set(row.titleId, row)
    }
  }

  return rows
}

// Позиция из файла заменяет свою, только если её смотрели позже
function progressOutcome(
  current: TitleProgress | undefined,
  incoming: IncomingProgress,
) {
  if (!current)
    return 'new'

  if (incoming.updatedAt <= current.updatedAt)
    return 'same'

  return current.position === incoming.position
    && current.duration === incoming.duration
    && current.watchedAt?.getTime() === incoming.watchedAt?.getTime()
    ? 'same'
    : 'updated'
}

function countMine(
  counts: ProfileMergeCounts,
  titleId: string,
  current: MineValues | undefined,
  incoming: IncomingMine,
  next: MineValues | undefined,
) {
  const outcome = ratingOutcome(current, incoming)

  if (outcome === 'new') {
    counts.ratings.new++
  }
  else if (outcome === 'same') {
    counts.ratings.same++
  }
  else if (outcome === 'conflict') {
    counts.ratings.conflicts++

    if (incoming.ratedAt)
      counts.conflictsDated = true

    if (counts.conflictSamples.length < CONFLICT_SAMPLES) {
      counts.conflictSamples.push({
        titleId,
        title: titleId,
        current: current!.rating!,
        incoming: incoming.rating!,
      })
    }
  }

  const result = next ?? current

  if (incoming.watchlistAt !== undefined) {
    if (!current?.watchlistAt && result?.watchlistAt)
      counts.watchlist.new++
    else counts.watchlist.same++
  }

  if (incoming.favoriteAt) {
    if (!current?.favoriteAt)
      counts.favorites.new++
    else counts.favorites.same++
  }

  if (incoming.droppedAt) {
    if (result?.droppedAt?.getTime() !== current?.droppedAt?.getTime())
      counts.dropped.new++
    else counts.dropped.same++
  }
}

interface MergePlan {
  counts: ProfileMergeCounts
  // Позиции и тайтлы, которые остаются как есть
  unchanged: number
  progress: Array<{ incoming: IncomingProgress, current?: TitleProgress }>
  mine: Array<{ titleId: string, current?: ProfileTitle, next: MineValues }>
}

/**
 * Что изменится в профиле: позиция — более свежая по времени просмотра,
 * «Моё» — по правилам `mergeMine`. `targetId` null — профиль будет создан.
 */
export function planProfileMerge(
  targetId: string | null,
  rows: ProfileRows,
  policy: ConflictPolicy,
  now = new Date(),
): MergePlan {
  const counts = emptyCounts()
  const progress = incomingProgress(rows.progress)
  const mine = incomingMine(rows.mine)
  const progressRows = currentProgress(
    targetId,
    progress.resolved.map(row => row.titleId),
  )
  const mineRows = currentMine(targetId, [...mine.resolved.keys()])
  const plan: MergePlan = { counts, unchanged: 0, progress: [], mine: [] }

  counts.skipped = progress.skipped + mine.skipped

  for (const incoming of progress.resolved) {
    const current = progressRows.get(progressKey(incoming))
    const outcome = progressOutcome(current, incoming)

    counts.progress[outcome]++

    if (outcome === 'same')
      plan.unchanged++
    else plan.progress.push({ incoming, current })
  }

  for (const [titleId, incoming] of mine.resolved) {
    const current = mineRows.get(titleId)
    const next = mergeMine(current, incoming, policy, now)

    countMine(counts, titleId, current, incoming, next)

    if (next)
      plan.mine.push({ titleId, current, next })
    else plan.unchanged++
  }

  return plan
}

function mineUndo(titleId: string, row?: ProfileTitle): ImportUndoEntry {
  return {
    titleId,
    before: row
      ? {
          watchlistAt: row.watchlistAt?.getTime() ?? null,
          favoriteAt: row.favoriteAt?.getTime() ?? null,
          rating: row.rating,
          ratedAt: row.ratedAt?.getTime() ?? null,
          droppedAt: row.droppedAt?.getTime() ?? null,
          updatedAt: row.updatedAt.getTime(),
        }
      : null,
  }
}

function progressUndo(
  incoming: IncomingProgress,
  row?: TitleProgress,
): ImportProgressUndoEntry {
  return {
    table: 'progress',
    titleId: incoming.titleId,
    season: incoming.season,
    episode: incoming.episode,
    before: row
      ? {
          position: row.position,
          duration: row.duration,
          torrentId: row.torrentId,
          fileIndex: row.fileIndex,
          voiceStudio: row.voiceStudio,
          voiceType: row.voiceType,
          watchedAt: row.watchedAt?.getTime() ?? null,
          updatedAt: row.updatedAt.getTime(),
        }
      : null,
    after: incoming.updatedAt.getTime(),
  }
}

/**
 * Записывает план слияния. Вызывается внутри транзакции импорта; время
 * позиции остаётся временем просмотра, а не импорта, — от него считаются
 * «Продолжить» и история.
 */
export function applyProfileMerge(
  targetId: string,
  plan: MergePlan,
  now: Date,
) {
  const db = getDb()
  const undo: Array<ImportUndoEntry | ImportProgressUndoEntry> = []

  for (const { incoming, current } of plan.progress) {
    const values = {
      position: incoming.position,
      duration: incoming.duration,
      voiceStudio: incoming.voiceStudio,
      voiceType: incoming.voiceType,
      watchedAt: incoming.watchedAt,
      updatedAt: incoming.updatedAt,
    }

    db.insert(titleProgress)
      .values({
        profileId: targetId,
        titleId: incoming.titleId,
        season: incoming.season,
        episode: incoming.episode,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          titleProgress.profileId,
          titleProgress.titleId,
          titleProgress.season,
          titleProgress.episode,
        ],
        set: values,
      })
      .run()
    undo.push(progressUndo(incoming, current))
  }

  for (const { titleId, current, next } of plan.mine) {
    const row = { profileId: targetId, titleId, ...next, updatedAt: now }

    db.insert(profileTitles)
      .values(row)
      .onConflictDoUpdate({
        target: [profileTitles.profileId, profileTitles.titleId],
        set: row,
      })
      .run()
    undo.push(mineUndo(titleId, current))
  }

  return undo
}

/**
 * Отмена позиции: возвращает прежнюю, если после импорта серию не смотрели.
 * `true` — вернули, `false` — оставили как есть.
 */
export function undoProgress(
  profileId: string,
  entry: ImportProgressUndoEntry,
) {
  const db = getDb()
  const where = and(
    eq(titleProgress.profileId, profileId),
    eq(titleProgress.titleId, entry.titleId),
    eq(titleProgress.season, entry.season),
    eq(titleProgress.episode, entry.episode),
  )
  const current = db.select().from(titleProgress).where(where).get()

  if (!current || current.updatedAt.getTime() !== entry.after)
    return false

  if (!entry.before) {
    db.delete(titleProgress).where(where).run()

    return true
  }

  const { watchedAt, ...before } = entry.before

  db.update(titleProgress)
    .set({
      ...before,
      updatedAt: new Date(before.updatedAt),
      ...(watchedAt === undefined
        ? {}
        : { watchedAt: watchedAt === null ? null : new Date(watchedAt) }),
    })
    .where(where)
    .run()

  return true
}
