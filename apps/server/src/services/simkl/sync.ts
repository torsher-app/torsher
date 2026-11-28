import type { SimklConnection, SimklOutbound } from '../../db/schema.ts'
import type { RemoteWatch, SimklSession } from './client.ts'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { diaryEntries, diarySeen, simklOutbox, simklReceipts } from '../../db/schema.ts'
import { titleAllowed, titleAllowedCached } from '../profiles/access.ts'
import { getTitleSummary, tmdbEpisodeExists } from '../tmdb/index.ts'
import { TmdbError } from '../tmdb/client.ts'
import { parseCatalogId, toCatalogId } from '../tmdb/mappers.ts'
import { ensureDiaryTimeZone } from '../transfer/diaryTimeZone.ts'
import { SimklError, SimklRequestError } from './client.ts'
import { simklOriginKey, simklRemoteKey } from './identity.ts'
import { outboundKey, receiptKey, receiptOf, requireCurrent, setConnection } from './store.ts'

type ExactWatch = Omit<RemoteWatch, 'tmdbId'> & { titleId: string }
type Sending = SimklOutbound & { simklId: number }

const LANGUAGE = 'en-US'
const MAX_HISTORY_ROWS = 100_000

function keyFor(row: Pick<RemoteWatch, 'simklId' | 'season' | 'episode'>) {
  return simklRemoteKey(row.simklId, row.season, row.episode)
}

function saveReceipt(connection: SimklConnection, row: ExactWatch, diaryId: string, kind: 'pull' | 'push' | 'dispatch') {
  const db = getDb()
  const remoteKey = keyFor(row)
  db.insert(simklReceipts).values({
    profileId: connection.profileId,
    accountFingerprint: connection.accountFingerprint,
    remoteKey,
    diaryId,
    titleId: row.titleId,
    watchedAt: row.watchedAt,
    kind,
  }).onConflictDoUpdate({
    target: [simklReceipts.profileId, simklReceipts.accountFingerprint, simklReceipts.remoteKey],
    set: { diaryId, titleId: row.titleId, watchedAt: row.watchedAt, kind },
    setWhere: and(eq(simklReceipts.kind, 'dispatch'), eq(simklReceipts.diaryId, diaryId)),
  }).run()
}

function clearDispatch(connection: SimklConnection, row: ExactWatch, diaryId: string) {
  getDb().delete(simklReceipts).where(and(
    receiptKey(connection, keyFor(row)),
    eq(simklReceipts.kind, 'dispatch'),
    eq(simklReceipts.diaryId, diaryId),
  )).run()
}

function completeOutbound(connection: SimklConnection, row: Sending, confirmed: boolean) {
  const db = getDb()
  db.transaction(() => {
    if (confirmed)
      saveReceipt(connection, row, row.diaryId, 'push')
    else
      clearDispatch(connection, row, row.diaryId)
    db.delete(simklOutbox).where(outboundKey(row)).run()
  })
}

function relevantOutbox(connection: SimklConnection, row: Pick<RemoteWatch, 'simklId' | 'season' | 'episode'>) {
  return getDb().select().from(simklOutbox).where(and(
    eq(simklOutbox.profileId, connection.profileId),
    eq(simklOutbox.generation, connection.generation),
    eq(simklOutbox.simklId, row.simklId),
    eq(simklOutbox.season, row.season),
    eq(simklOutbox.episode, row.episode),
    eq(simklOutbox.dispatched, true),
  )).all()
}

function attachEcho(connection: SimklConnection, row: ExactWatch): 'new' | 'existing' | 'ambiguous' {
  const remoteKey = keyFor(row)
  const previous = receiptOf(connection, remoteKey)
  const matched = relevantOutbox(connection, row)
  if (previous && previous.titleId !== row.titleId)
    return 'ambiguous'
  if (previous && previous.kind !== 'dispatch') {
    for (const task of matched)
      completeOutbound(connection, { ...task, simklId: row.simklId }, false)
    return 'existing'
  }

  // The same instant is an echo candidate only for this account, this object and
  // a request our worker may have dispatched. An undated observation proves neither.
  const exact = row.watchedAt === null ? [] : matched.filter(task => task.watchedAt === row.watchedAt)
  if (exact.length > 1 || (row.watchedAt === null && (previous || matched.length)))
    return 'ambiguous'
  const task = exact[0]
  if (task) {
    if (task.titleId !== row.titleId)
      return 'ambiguous'
    completeOutbound(connection, { ...task, simklId: row.simklId }, true)
    return 'existing'
  }
  if (previous?.watchedAt === row.watchedAt) {
    saveReceipt(connection, row, previous.diaryId, 'push')
    return 'existing'
  }

  // A date on a different canonical fact is still valid history of its own.
  for (const waiting of matched)
    completeOutbound(connection, { ...waiting, simklId: row.simklId }, false)
  if (previous)
    clearDispatch(connection, row, previous.diaryId)
  return 'new'
}

function writeHistory(connection: SimklConnection, row: ExactWatch, signal: AbortSignal) {
  const db = getDb()
  return db.transaction(() => {
    requireCurrent(connection, signal, 'pull')
    if (!titleAllowedCached(connection.profileId, row.titleId))
      return false
    const echo = attachEcho(connection, row)
    if (echo !== 'new')
      return echo !== 'ambiguous'

    const { titleId, season, episode } = row
    const ref = { profileId: connection.profileId, titleId, season, episode }
    const originKey = simklOriginKey(connection.accountFingerprint, keyFor(row))
    const existing = db.select().from(diaryEntries).where(and(
      eq(diaryEntries.profileId, connection.profileId),
      eq(diaryEntries.origin, 'simkl'),
      eq(diaryEntries.originKey, originKey),
    )).get()
    if (existing) {
      // A portable v3 import already preserved the upstream identity. Do not
      // overwrite the user's edits or recover an explicitly removed seen mark.
      if (existing.titleId !== titleId || existing.season !== season || existing.episode !== episode)
        return false
      saveReceipt(connection, row, existing.id, 'pull')
      return true
    }

    ensureDiaryTimeZone()
    const now = new Date()
    const inserted = db.insert(diaryEntries).values({
      ...ref,
      origin: 'simkl',
      originKey,
      instant: row.watchedAt === null ? null : new Date(row.watchedAt),
      precision: row.watchedAt === null ? 'unknown' : 'instant',
      createdAt: now,
      updatedAt: now,
    }).returning({ id: diaryEntries.id }).get()
    db.insert(diarySeen).values(ref).onConflictDoUpdate({
      target: [diarySeen.profileId, diarySeen.titleId, diarySeen.season, diarySeen.episode],
      set: { episode },
    }).run()
    saveReceipt(connection, row, inserted.id, 'pull')
    return true
  })
}

async function matchWatch(row: RemoteWatch, profileId: string, signal: AbortSignal) {
  if (!row.tmdbId)
    return
  const titleId = toCatalogId(row.episode ? 'tv' : 'movie', row.tmdbId)
  try {
    if (row.episode) {
      if (!await tmdbEpisodeExists(row.tmdbId, row.season, row.episode, LANGUAGE))
        return
    }
    else if ((await getTitleSummary(titleId, LANGUAGE, { signal }))?.details.id !== titleId) {
      return
    }

    if (await titleAllowed(profileId, titleId))
      return titleId
  }
  catch (error) {
    if (!(error instanceof TmdbError) || error.kind !== 'not_found')
      throw error
  }
}

export async function pullHistory(connection: SimklConnection, session: SimklSession, full: boolean, signal: AbortSignal) {
  const current = requireCurrent(connection, signal, 'pull')
  const cursor = await session.activities()
  const old = full ? undefined : current.cursor
  const remote: RemoteWatch[] = []
  const watched = { movies: false, shows: false }
  for (const kind of ['movies', 'shows'] as const) {
    if (old && old[kind] === cursor[kind] && (old[kind] !== null || old.all === cursor.all))
      continue
    requireCurrent(connection, signal, 'pull')
    for (const row of await session.history(kind, old?.all ?? undefined))
      remote.push(row)
    watched[kind] = !old?.all
    if (remote.length > MAX_HISTORY_ROWS)
      throw new SimklError('provider')
  }

  // Reject conflicting identities rather than silently applying the first
  // response row when the library changes between status buckets.
  const byKey = new Map<string, RemoteWatch>()
  for (const item of remote) {
    const key = keyFor(item)
    const previous = byKey.get(key)
    if (previous && (item.tmdbId !== previous.tmdbId || item.watchedAt !== previous.watchedAt))
      throw new SimklError('provider')
    byKey.set(key, item)
  }

  let skipped = 0
  for (const row of byKey.values()) {
    requireCurrent(connection, signal, 'pull')
    const key = keyFor(row)
    const prior = receiptOf(connection, key)
    const direct = row.tmdbId && toCatalogId(row.episode ? 'tv' : 'movie', row.tmdbId)
    if (prior && prior.kind !== 'dispatch' && direct === prior.titleId
      && !relevantOutbox(connection, row).length) {
      continue
    }

    const titleId = await matchWatch(row, connection.profileId, signal)
    if (!titleId || !writeHistory(connection, { ...row, titleId }, signal))
      skipped++
  }

  requireCurrent(connection, signal, 'pull')
  const db = getDb()
  db.transaction(() => {
    if (watched.movies || watched.shows) {
      const reservations = db.select().from(simklReceipts).where(and(
        eq(simklReceipts.profileId, connection.profileId),
        eq(simklReceipts.accountFingerprint, connection.accountFingerprint),
        eq(simklReceipts.kind, 'dispatch'),
      )).all()
      for (const reservation of reservations) {
        const domain = reservation.remoteKey.endsWith(':movie') ? 'movies' : 'shows'
        if (watched[domain] && !byKey.has(reservation.remoteKey))
          db.delete(simklReceipts).where(receiptKey(connection, reservation.remoteKey)).run()
      }

      const dispatched = db.select().from(simklOutbox).where(and(
        eq(simklOutbox.profileId, connection.profileId),
        eq(simklOutbox.generation, connection.generation),
        inArray(simklOutbox.state, ['sending', 'uncertain', 'attention']),
        eq(simklOutbox.dispatched, true),
      )).orderBy(asc(simklOutbox.watchedAt), asc(simklOutbox.attemptId)).all()
      for (const task of dispatched) {
        const id = task.simklId
        if (!id || !watched[task.episode ? 'shows' : 'movies'])
          continue
        if (!byKey.has(keyFor({ ...task, simklId: id }))) {
          clearDispatch(connection, { ...task, simklId: id }, task.diaryId)
          db.update(simklOutbox).set({
            state: 'queued',
            dispatched: false,
            nextTryAt: Date.now(),
          }).where(outboundKey(task)).run()
        }
      }
    }
    setConnection(connection, { cursor, lastSyncAt: Date.now(), skipped, syncError: false })
  })
}

function taskState(task: SimklOutbound, values: Partial<SimklOutbound>) {
  getDb().update(simklOutbox).set(values).where(outboundKey(task)).run()
}

export function postponeOutbound(task: SimklOutbound, error: unknown) {
  const uncertain = task.dispatched
  const now = Date.now()
  const count = task.retries + 1
  if (error instanceof SimklRequestError && error.limited) {
    taskState(task, { state: uncertain ? 'uncertain' : 'queued', nextTryAt: error.retryAt })
  }
  else if (count > 8 || (error instanceof SimklRequestError && !error.ambiguous && !error.unauthorized)) {
    taskState(task, { state: 'attention', retries: count })
  }
  else {
    const spacing = Math.min(60_000 * 2 ** (count - 1), 6 * 60 * 60_000)
    taskState(task, {
      state: uncertain ? 'uncertain' : 'queued',
      retries: count,
      nextTryAt: now + spacing + Math.round(Math.random() * (spacing / 10)),
    })
  }
}

async function resolveTask(connection: SimklConnection, task: SimklOutbound, session: SimklSession, signal: AbortSignal) {
  const ref = parseCatalogId(task.titleId)
  if (!ref || !await titleAllowed(connection.profileId, task.titleId))
    return
  if (task.episode) {
    try {
      if (!await tmdbEpisodeExists(ref.tmdbId, task.season, task.episode, LANGUAGE))
        return
    }
    catch (error) {
      if (error instanceof TmdbError && error.kind === 'not_found')
        return
      throw error
    }
  }
  requireCurrent(connection, signal, 'push')
  return session.resolve(ref.tmdbId, task.season, task.episode)
}

export async function deliver(connection: SimklConnection, original: SimklOutbound, session: SimklSession, signal: AbortSignal) {
  let task = original
  let appendedThisRun = false
  try {
    const current = requireCurrent(connection, signal, 'push')
    const simklId = task.simklId ?? await resolveTask(connection, task, session, signal)
    requireCurrent(connection, signal, 'push')
    if (!simklId || !titleAllowedCached(connection.profileId, task.titleId)) {
      taskState(task, { state: 'attention' })
      return
    }

    const prior = receiptOf(connection, keyFor({ ...task, simklId }))
    if (!task.dispatched && prior?.kind === 'dispatch') {
      if (current.pull) {
        taskState(task, { state: 'attention' })
        return
      }
      const observed = await session.lookup({ ...task, simklId })
      requireCurrent(connection, signal, 'push')
      if (observed.kind === 'seen' && observed.watchedAt !== null) {
        if (observed.watchedAt === prior.watchedAt)
          saveReceipt(connection, { ...task, simklId, watchedAt: prior.watchedAt }, prior.diaryId, 'push')
        else
          clearDispatch(connection, { ...task, simklId }, prior.diaryId)
        completeOutbound(connection, { ...task, simklId }, false)
        return
      }
      if (observed.kind !== 'absent') {
        taskState(task, { state: 'attention' })
        return
      }
      clearDispatch(connection, { ...task, simklId }, prior.diaryId)
    }

    if (task.dispatched) {
      if (current.pull) {
        // In two-way mode the ordinary pull is the only provider state read.
        taskState(task, { state: 'attention' })
        return
      }
      const observed = await session.lookup({ ...task, simklId })
      requireCurrent(connection, signal, 'push')
      if (observed.kind === 'seen' && observed.watchedAt !== null) {
        completeOutbound(connection, { ...task, simklId }, observed.watchedAt === task.watchedAt)
        return
      }
      if (observed.kind !== 'absent') {
        taskState(task, { state: 'attention' })
        return
      }
      task = { ...task, dispatched: false, simklId }
      getDb().transaction(() => {
        clearDispatch(connection, { ...task, simklId }, task.diaryId)
        taskState(task, { state: 'queued', dispatched: false })
      })
    }

    requireCurrent(connection, signal, 'push')
    task = { ...task, simklId, state: 'sending', dispatched: true }
    getDb().transaction(() => {
      taskState(task, { state: task.state, dispatched: true, simklId })
      saveReceipt(connection, { ...task, simklId }, task.diaryId, 'dispatch')
    })
    appendedThisRun = true
    const accepted = await session.append({ ...task, simklId }, task.watchedAt)
    requireCurrent(connection, signal, 'push')
    if (accepted === 'added') {
      completeOutbound(connection, { ...task, simklId }, true)
    }
    else {
      taskState(task, {
        state: current.pull ? 'attention' : 'uncertain',
        nextTryAt: Date.now() + 30_000,
      })
    }
  }
  catch (error) {
    requireCurrent(connection, signal, 'push')
    const definitive = error instanceof SimklRequestError && !error.ambiguous
    // A restart can enter here with a persisted dispatch. A refusal of its
    // lookup says nothing about the outcome of the original append.
    if (appendedThisRun && definitive && task.simklId) {
      clearDispatch(connection, { ...task, simklId: task.simklId }, task.diaryId)
      taskState(task, { dispatched: false })
      task = { ...task, dispatched: false }
    }
    postponeOutbound(task, error)
    throw error
  }
}
