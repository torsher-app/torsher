import type { MineDate, MineDiaryEntry } from '../../dto/minePersonal.ts'
import type { CurrentProfile } from './personalAccess.ts'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  diaryEntries,
  diarySeen,
  manualDiaryRequests,
} from '../../db/schema.ts'
import { titleAllowedCached } from '../profiles/access.ts'
import { simklSourceUrl } from '../simkl/identity.ts'
import {
  diaryTimeZone,
  ensureDiaryTimeZone,
} from '../transfer/diaryTimeZone.ts'
import { calendarDayAt } from './calendar.ts'
import { requireAvailableEpisode } from './cycles.ts'
import { summaryOf } from './cards.ts'
import { allowMineTitle, MinePersonalError } from './personalAccess.ts'
import { rewatchForEntry } from './rewatch.ts'
import { localMineMetadata, localTitleDetails } from './personalMetadata.ts'

type Entry = typeof diaryEntries.$inferSelect
export interface DiaryRef {
  titleId: string
  season: number
  episode: number
}

export function entryDate(
  entry: Pick<Entry, 'precision' | 'instant' | 'day'>,
): MineDate {
  if (entry.precision === 'instant')
    return { precision: 'instant', instant: entry.instant!.toISOString() }
  return entry.precision === 'day'
    ? { precision: 'day', day: entry.day! }
    : { precision: 'unknown' }
}

export function diaryEntryWire(
  entry: Omit<
    Entry,
    'mutationToken' | 'sourceMatchKey' | 'profileId'
  >,
  language: string,
  timeZone: string,
): MineDiaryEntry {
  return {
    id: entry.id,
    titleId: entry.titleId,
    season: entry.season,
    episode: entry.episode,
    kind: entry.titleId.startsWith('tmdb:movie:')
      ? 'movie'
      : entry.episode
        ? 'episode'
        : 'series',
    date: entryDate(entry),
    calendarDay:
      entry.day
      ?? (entry.instant ? calendarDayAt(entry.instant.getTime(), timeZone) : null),
    note: entry.note,
    viewingContext: entry.viewingContext,
    origin: entry.origin,
    sourceUrl: entry.origin === 'simkl' ? simklSourceUrl(entry.originKey) : undefined,
    rewatch: entry.rewatch,
    cycleId: entry.context?.kind === 'cycle' ? entry.context.cycleId : null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    metadata: localMineMetadata(
      entry.titleId,
      language,
      entry.season,
      entry.episode,
    ),
  }
}

function dateValues(date: MineDate, now: Date, timeZone: string) {
  const instant = date.precision === 'instant' ? new Date(date.instant) : null
  const day = date.precision === 'day' ? date.day : null
  if (
    (instant && instant > now)
    || (day && day > calendarDayAt(now.getTime(), timeZone))
  ) {
    throw new MinePersonalError('invalidDate', 400)
  }
  return { precision: date.precision, instant, day }
}

function entryIn(profileId: string, id: string) {
  return and(eq(diaryEntries.profileId, profileId), eq(diaryEntries.id, id))
}

function ownEntry(profileId: string, id: string) {
  const entry = getDb()
    .select()
    .from(diaryEntries)
    .where(entryIn(profileId, id))
    .get()
  if (!entry || !titleAllowedCached(profileId, entry.titleId))
    throw new MinePersonalError('notFound', 404)
  return entry
}

async function validateTarget(
  current: CurrentProfile,
  ref: DiaryRef,
  language: string,
  title: Awaited<ReturnType<typeof allowMineTitle>>,
) {
  if (ref.episode === 0 && ref.season === 0)
    return title
  if (title.type !== 'tv' || ref.episode < 1)
    throw new MinePersonalError('invalidEpisode', 400)
  const profileId = current()
  await requireAvailableEpisode(profileId, ref.titleId, ref, language)
  current()
  if (!titleAllowedCached(profileId, ref.titleId))
    throw new MinePersonalError('notFound', 404)
  return title
}

export async function validateDiaryTarget(
  current: CurrentProfile,
  ref: DiaryRef,
  language: string,
) {
  return validateTarget(
    current,
    ref,
    language,
    await allowMineTitle(ref.titleId, current),
  )
}

export async function createManualEntry(
  current: CurrentProfile,
  {
    requestId,
    target,
    date,
    note = null,
    viewingContext = null,
    rewatch = false,
  }: {
    requestId: string
    target: DiaryRef
    date: MineDate
    note?: string | null
    rewatch?: boolean
    viewingContext?: string | null
  },
  language: string,
) {
  const profileId = current()
  const db = getDb()
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        target.titleId,
        target.season,
        target.episode,
        date.precision,
        date.precision === 'instant'
          ? new Date(date.instant).toISOString()
          : date.precision === 'day'
            ? date.day
            : null,
        note,
        viewingContext,
        ...(rewatch ? [true] : []),
      ]),
    )
    .digest('hex')
  const receipt = () =>
    db
      .select()
      .from(manualDiaryRequests)
      .where(
        and(
          eq(manualDiaryRequests.profileId, profileId),
          eq(manualDiaryRequests.requestId, requestId),
        ),
      )
      .get()

  function replay(command: string) {
    if (command !== fingerprint)
      throw new MinePersonalError('conflict', 409)
    const entry = db
      .select()
      .from(diaryEntries)
      .where(entryIn(profileId, requestId))
      .get()
    return {
      entry:
        entry?.origin === 'manual' && entry.originKey === requestId
          ? diaryEntryWire(entry, language, diaryTimeZone())
          : null,
    }
  }

  const title = await allowMineTitle(target.titleId, current)
  const previous = receipt()
  if (previous)
    return replay(previous.command)

  await validateTarget(current, target, language, title)
  // Search cards do not populate the details cache read by the diary and overview.
  if (!localTitleDetails(target.titleId, language))
    await summaryOf(target.titleId, language)
  current()
  if (!titleAllowedCached(profileId, target.titleId))
    throw new MinePersonalError('notFound', 404)
  return db.transaction(() => {
    const concurrent = receipt()
    if (concurrent)
      return replay(concurrent.command)
    const existing = db
      .select()
      .from(diaryEntries)
      .where(entryIn(profileId, requestId))
      .get()
    if (existing)
      throw new MinePersonalError('conflict', 409)
    const now = new Date()
    const timeZone = ensureDiaryTimeZone()
    const entry = db
      .insert(diaryEntries)
      .values({
        id: requestId,
        profileId,
        ...target,
        ...dateValues(date, now, timeZone),
        origin: 'manual',
        originKey: requestId,
        note,
        viewingContext,
        rewatch,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    db.insert(manualDiaryRequests)
      .values({ profileId, requestId, command: fingerprint })
      .run()
    db.insert(diarySeen)
      .values({ profileId, ...target })
      .onConflictDoUpdate({
        target: [
          diarySeen.profileId,
          diarySeen.titleId,
          diarySeen.season,
          diarySeen.episode,
        ],
        set: { episode: target.episode },
      })
      .run()
    return { entry: diaryEntryWire(entry, language, timeZone) }
  })
}

export function patchDiaryEntry(
  current: CurrentProfile,
  id: string,
  patch: {
    date?: MineDate
    note?: string | null
    viewingContext?: string | null
    rewatch?: boolean
  },
  language: string,
) {
  const profileId = current()
  const db = getDb()
  return db.transaction(() => {
    const entry = ownEntry(profileId, id)
    if (
      patch.rewatch !== undefined
      && (entry.origin !== 'manual' || entry.context?.kind === 'cycle')
    ) {
      throw new MinePersonalError('conflict', 409)
    }
    const now = new Date()
    const timeZone = diaryTimeZone()
    const change = {
      ...(patch.date && dateValues(patch.date, now, timeZone)),
      ...(patch.rewatch !== undefined && { rewatch: patch.rewatch }),
      ...(patch.note !== undefined && { note: patch.note }),
      ...(patch.viewingContext !== undefined && {
        viewingContext: patch.viewingContext,
      }),
    }
    const next = Object.keys(change).length
      ? db
        .update(diaryEntries)
        .set({ ...change, updatedAt: now })
        .where(entryIn(profileId, id))
        .returning()
        .get()!
      : entry
    const rewatch
      = next.rewatch
        || (next.origin === 'trakt' && rewatchForEntry(profileId, id, timeZone))
    return diaryEntryWire({ ...next, rewatch }, language, timeZone)
  })
}

export function deleteDiaryEntry(current: CurrentProfile, id: string) {
  const profileId = current()
  const db = getDb()
  db.transaction(() => {
    ownEntry(profileId, id)
    db.delete(diaryEntries).where(entryIn(profileId, id)).run()
  })
}
