import type { SimklConnection } from '../../db/schema.ts'
import type { SimklStatus } from '../../dto/simkl.ts'
import { and, asc, eq, inArray, lte, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { diaryEntries, simklConnections, simklOutbox } from '../../db/schema.ts'
import {
  cancelSimklDevice,
  connectSimklDevice,
  deviceStatus,
  forgetSimklProfile,
  pollSimklDevice as poll,
  removeSimklConnection,
  revokeWarning,
  sessionFor,
  stopSimklAuthorizations,
} from './auth.ts'
import { SimklError, SimklRequestError } from './client.ts'
import { connectionOf, openGrant, outboxStats, requireCurrent, setConnection } from './store.ts'
import { deliver, postponeOutbound, pullHistory } from './sync.ts'

export { cancelSimklDevice, connectSimklDevice }
export { enqueueSimklCompletion } from './store.ts'

const AUTOMATIC_PULL_DELAY = 30 * 60_000
const MANUAL_PULL_DELAY = 30_000
const TASK_TIMEOUT = 10 * 60_000
const WORKER_INTERVAL = 30_000

type PullMode = 'auto' | 'manual' | 'full'
interface Task {
  controller: AbortController
  kind: 'pull' | 'push'
  done: Promise<void>
}

const active = new Map<string, Task>()
const deferredPull = new Map<string, { mode: PullMode, generation: string }>()
const pullPriority = { auto: 0, manual: 1, full: 2 }
let worker: ReturnType<typeof setInterval> | undefined
let ticking: Promise<void> | undefined

function abortTask(profileId: string, kind?: Task['kind']) {
  if (!kind || kind === 'pull')
    deferredPull.delete(profileId)

  const task = active.get(profileId)
  if (task && (!kind || task.kind === kind))
    task.controller.abort()
}

export function forgetSimklConnection(profileId: string, connection: SimklConnection | undefined) {
  abortTask(profileId)
  forgetSimklProfile(profileId, connection)
}

export function pollSimklDevice(profileId: string) {
  return poll(profileId, () => abortTask(profileId))
}

export function simklProfileStatus(profileId: string): SimklStatus {
  const row = connectionOf(profileId)
  const { pending, issues } = row ? outboxStats(profileId) : { pending: 0, issues: 0 }
  return {
    available: !!config.simklClientId,
    connection: row
      ? {
          generation: row.generation,
          scope: row.scope,
          account: row.account,
          pull: row.pull,
          push: row.push,
          reauthorize: row.reauthorize || config.simklClientId !== row.clientId,
        }
      : null,
    challenge: deviceStatus(profileId),
    syncing: active.get(profileId)?.kind === 'pull' || deferredPull.has(profileId),
    lastSyncAt: row?.lastSyncAt ? new Date(row.lastSyncAt).toISOString() : null,
    syncError: !!row?.syncError,
    pending,
    issues,
    skipped: (row?.skipped ?? 0) + (row?.overflow ?? 0),
    revokeWarning: revokeWarning(profileId),
  }
}

export async function disconnectSimkl(profileId: string) {
  abortTask(profileId)
  await removeSimklConnection(profileId)
}

export async function changeSimklDirections(
  profileId: string,
  { expectedGeneration, ...directions }: { expectedGeneration: string, pull: boolean, push: boolean },
) {
  const connection = connectionOf(profileId)
  if (!connection)
    throw new SimklError('expired')
  if (connection.generation !== expectedGeneration)
    throw new SimklError('identity')
  if (directions.push && (connection.scope !== 'write' || connection.reauthorize || config.simklClientId !== connection.clientId))
    throw new SimklError('scope')
  if (!directions.push && connection.push) {
    // The local binding and its outbox disappear synchronously. A fresh
    // device grant is required for read-only operation.
    await disconnectSimkl(profileId)
    return
  }
  if (!directions.pull)
    abortTask(profileId, 'pull')
  setConnection(connection, directions)
  if (directions.pull && !connection.pull)
    startSimklPull(profileId, 'manual')
}

function recordFailure(connection: SimklConnection, error: unknown, kind: Task['kind']) {
  const values: Partial<SimklConnection> = kind === 'pull' ? { syncError: true } : {}
  if (error instanceof SimklRequestError) {
    if (error.unauthorized) {
      const current = connectionOf(connection.profileId)
      try {
        // An access token can expire before our local estimate. Schedule one
        // refresh for an older grant; a freshly rejected token needs a new login.
        const issuedAt = current
          ? current.expiresAt - openGrant(current).expires_in * 1000
          : Date.now()
        if (error.status === 401 && error.code !== 'invalid_grant'
          && current?.generation === connection.generation && current.expiresAt > 0
          && Date.now() - issuedAt > 5 * 60_000) {
          values.expiresAt = 0
        }
        else {
          values.reauthorize = true
        }
      }
      catch {
        values.reauthorize = true
      }
    }
    if (error.limited)
      values.blockedUntil = error.retryAt
  }
  if (Object.keys(values).length)
    setConnection(connection, values)
}

function runTask(
  connection: SimklConnection,
  kind: Task['kind'],
  run: (signal: AbortSignal) => Promise<void>,
) {
  if (active.has(connection.profileId))
    return

  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TASK_TIMEOUT)])
  const done = Promise.resolve().then(async () => {
    try {
      await run(signal)
    }
    catch (error) {
      if (!controller.signal.aborted)
        recordFailure(connection, error, kind)
    }
    finally {
      active.delete(connection.profileId)
      const deferred = deferredPull.get(connection.profileId)
      deferredPull.delete(connection.profileId)
      if (deferred?.generation === connection.generation && !controller.signal.aborted) {
        try {
          startSimklPull(connection.profileId, deferred.mode)
        }
        catch (error) {
          recordFailure(connection, error, 'pull')
        }
      }
    }
  })
  active.set(connection.profileId, { kind, controller, done })
  return done
}

export function startSimklPull(profileId: string, mode: PullMode) {
  const connection = connectionOf(profileId)
  if (!connection?.pull || connection.reauthorize || connection.clientId !== config.simklClientId) {
    if (mode === 'auto')
      return
    throw new SimklError('scope')
  }
  const now = Date.now()
  const delay = mode === 'auto' ? AUTOMATIC_PULL_DELAY : MANUAL_PULL_DELAY
  if (connection.blockedUntil > now || (connection.lastPullAt !== null && connection.lastPullAt > now - delay))
    return
  const task = active.get(profileId)
  if (task?.kind === 'push') {
    const previous = deferredPull.get(profileId)
    if (!previous || previous.generation !== connection.generation || pullPriority[mode] > pullPriority[previous.mode])
      deferredPull.set(profileId, { mode, generation: connection.generation })
    return
  }

  const started = runTask(connection, 'pull', async (signal) => {
    const session = await sessionFor(connection, signal)
    await pullHistory(connection, session, mode === 'full', signal)
  })
  if (started)
    setConnection(connection, { lastPullAt: now, syncError: false })
}

export function afterSimklCompletion(profileId: string, diaryId: string) {
  if (!worker || !config.simklClientId)
    return
  queueMicrotask(() => {
    // Playback writes inside a SQLite transaction. Check that it committed before
    // triggering any provider read. Outbound dispatch is entirely by the outbox.
    if (worker && getDb().select({ id: diaryEntries.id }).from(diaryEntries).where(and(
      eq(diaryEntries.profileId, profileId),
      eq(diaryEntries.id, diaryId),
    )).get()) {
      startSimklPull(profileId, 'auto')
    }
  })
}

export function retrySimkl(profileId: string) {
  const connection = connectionOf(profileId)
  if (!connection?.push || connection.reauthorize || connection.clientId !== config.simklClientId)
    throw new SimklError('scope')
  const now = Date.now()
  const db = getDb()
  db.update(simklOutbox).set({ retries: 0, state: 'queued', nextTryAt: now }).where(and(
    eq(simklOutbox.profileId, profileId),
    eq(simklOutbox.generation, connection.generation),
    eq(simklOutbox.state, 'attention'),
    eq(simklOutbox.dispatched, false),
  )).run()
  if (connection.pull) {
    startSimklPull(profileId, 'full')
    return
  }
  db.update(simklOutbox).set({ retries: 0, state: 'uncertain', nextTryAt: now }).where(and(
    eq(simklOutbox.profileId, profileId),
    eq(simklOutbox.generation, connection.generation),
    eq(simklOutbox.state, 'attention'),
    eq(simklOutbox.dispatched, true),
  )).run()
}

async function processSimklOutbox() {
  const clientId = config.simklClientId
  if (!clientId)
    return
  const db = getDb()
  const earlier = alias(simklOutbox, 'earlier')
  // First completion wins the canonical date. A past failure at one title
  // must not let its later playback overtake it or block unrelated titles.
  const predecessor = db.select({ attemptId: earlier.attemptId }).from(earlier).where(and(
    eq(earlier.profileId, simklOutbox.profileId),
    eq(earlier.generation, simklOutbox.generation),
    eq(earlier.titleId, simklOutbox.titleId),
    eq(earlier.season, simklOutbox.season),
    eq(earlier.episode, simklOutbox.episode),
    sql`"earlier".rowid < "simkl_outbox".rowid`,
  ))
  const rows = db.select({ row: simklOutbox, connection: simklConnections })
    .from(simklOutbox)
    .innerJoin(simklConnections, and(
      eq(simklOutbox.profileId, simklConnections.profileId),
      eq(simklOutbox.generation, simklConnections.generation),
    ))
    .where(and(
      inArray(simklOutbox.state, ['queued', 'sending', 'uncertain']),
      lte(simklOutbox.nextTryAt, Date.now()),
      eq(simklConnections.clientId, clientId),
      eq(simklConnections.push, true),
      eq(simklConnections.reauthorize, false),
      lte(simklConnections.blockedUntil, Date.now()),
      notExists(predecessor),
    ))
    .orderBy(asc(simklOutbox.nextTryAt), asc(simklOutbox.watchedAt), asc(simklOutbox.attemptId))
    .limit(50)
    .all()

  const groups = Map.groupBy(rows, row => row.connection.profileId)
  for (const group of groups.values()) {
    const connection = group[0]!.connection
    void runTask(connection, 'push', async (signal) => {
      let session
      try {
        session = await sessionFor(connection, signal)
      }
      catch (error) {
        // Refresh is shared by the batch. Persist backoff for its jobs even
        // though none reached deliver, preserving any earlier dispatches.
        if (error instanceof SimklRequestError && !error.unauthorized && !signal.aborted) {
          for (const { row } of group)
            postponeOutbound(row, error)
        }
        throw error
      }

      for (const { row } of group) {
        requireCurrent(connection, signal, 'push')
        await deliver(connection, row, session, signal)
      }
    })
  }
}

export function startSimklWorker() {
  if (worker || !config.simklClientId)
    return
  const tick = () => {
    ticking ??= processSimklOutbox().catch(() => {}).finally(() => {
      ticking = undefined
    })
  }
  worker = setInterval(tick, WORKER_INTERVAL).unref()
  tick()
}

export async function stopSimklWorker() {
  clearInterval(worker)
  worker = undefined
  stopSimklAuthorizations()
  deferredPull.clear()
  await ticking
  const tasks = [...active.values()]
  for (const task of tasks)
    task.controller.abort()
  await Promise.allSettled(tasks.map(task => task.done))
}
