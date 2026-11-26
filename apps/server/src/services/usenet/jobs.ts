import type { UsenetClient } from './config.ts'
import type { UsenetProblem } from './errors.ts'
import type { SabObservation } from './sab.ts'
import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gte, lte, ne, or } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mediaFiles, usenetJobs } from '../../db/schema.ts'
import { requestFollowSearch } from '../follow/search.ts'
import {
  MaintenanceBusyError,
  withMaintenanceLease,
} from '../libraryMaintenance/admission.ts'
import { durableMaintenance } from '../libraryMaintenance/durable.ts'
import {
  asSabClient,
  configuredClient,
  usenetHeld,
  usenetRestoreBlocked,
} from './config.ts'
import { UsenetError } from './errors.ts'
import { recordUsenetFollow } from './follow.ts'
import { importUsenet, releaseUnpublishedImport } from './import.ts'
import { observeSab, recoverSab, SAB_BATCH_SIZE, submitSab } from './sab.ts'

const MAX_ACTIVE = 100
const JOBS_LIMIT = 150
const MAX_NZB = 8 * 1024 * 1024
const POLL_INITIAL = 15_000
const POLL_MAX = 300_000
const work = new Set<string>()

type Job = typeof usenetJobs.$inferSelect
type Changes = Partial<
  Pick<
    Job,
    | 'active'
    | 'state'
    | 'nzoId'
    | 'progress'
    | 'problem'
    | 'storage'
    | 'receipt'
  >
>

export interface UsenetIntent {
  sourceId: string
  sourceRevision: string
  releaseKey: string
  releaseTitle: string
  titleId: string
  season?: number
  episode?: number
  origin: 'manual' | 'follow'
  profileId?: string
  followId?: string
}

function view(job: Job) {
  return {
    id: job.id,
    titleId: job.titleId,
    season: job.season,
    episode: job.episode,
    releaseTitle: job.releaseTitle,
    origin: job.origin,
    state: job.state,
    problem: job.problem,
    progress: job.progress,
    mediaFileId: job.mediaFileId,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  }
}

export type UsenetJobView = ReturnType<typeof view>

export function activeUsenetTargets(titleId: string) {
  return new Set(
    getDb()
      .select({ season: usenetJobs.season, episode: usenetJobs.episode })
      .from(usenetJobs)
      .where(and(eq(usenetJobs.active, true), eq(usenetJobs.titleId, titleId)))
      .all()
      .map(row => `${row.season}:${row.episode}`),
  )
}

export function blockedUsenetReleaseKeys(titleId: string) {
  return new Set(
    getDb()
      .select({ key: usenetJobs.releaseKey })
      .from(usenetJobs)
      .where(
        and(
          eq(usenetJobs.origin, 'follow'),
          eq(usenetJobs.titleId, titleId),
          eq(usenetJobs.state, 'failed'),
          eq(usenetJobs.problem, 'release_failed'),
        ),
      )
      .all()
      .map(row => row.key),
  )
}

export function listUsenetJobs(titleId?: string) {
  return getDb()
    .select()
    .from(usenetJobs)
    .where(titleId ? eq(usenetJobs.titleId, titleId) : undefined)
    .orderBy(desc(usenetJobs.active), desc(usenetJobs.updatedAt))
    .limit(JOBS_LIMIT)
    .all()
    .map(view)
}

function getJob(id: string) {
  const job = getDb()
    .select()
    .from(usenetJobs)
    .where(eq(usenetJobs.id, id))
    .get()
  if (!job)
    throw new UsenetError('not_found')
  return job
}

function update(job: Job, change: Changes) {
  return getDb()
    .update(usenetJobs)
    .set({ ...change, updatedAt: new Date() })
    .where(eq(usenetJobs.id, job.id))
    .returning()
    .get()
}

function durableUpdate(job: Job, change: Changes) {
  return durableMaintenance(() => update(job, change))
}

function setAttention(job: Job, problem: UsenetProblem) {
  return update(job, { state: 'attention', problem })
}

function requireClient(follow = false) {
  const client = configuredClient()
  if (
    usenetHeld()
    || !client?.enabled
    || !client.verified
    || (follow && !client.followEnabled)
  ) {
    throw new UsenetError('not_ready')
  }
  return client
}

function checkClient(client: UsenetClient, follow = false) {
  const current = requireClient(follow)
  if (current.generation !== client.generation)
    throw new UsenetError('client_changed')

  if (
    current.localRoot !== client.localRoot
    || current.remoteRoot !== client.remoteRoot
    || current.encryptedApiKey !== client.encryptedApiKey
    || current.lanAddresses.join(',') !== client.lanAddresses.join(',')
  ) {
    throw new UsenetError('review_required')
  }
  return current
}

function targetFile(titleId: string, season: number, episode: number) {
  return getDb()
    .select({ id: mediaFiles.id })
    .from(mediaFiles)
    .where(
      and(
        eq(mediaFiles.titleId, titleId),
        eq(mediaFiles.season, season),
        eq(mediaFiles.state, 'present'),
        or(
          eq(mediaFiles.episode, episode),
          and(
            lte(mediaFiles.episode, episode),
            gte(mediaFiles.episodeTo, episode),
          ),
        ),
      ),
    )
    .get()
}

function reserve(intent: UsenetIntent, client: UsenetClient) {
  const season = intent.season ?? 0
  const episode = intent.episode ?? 0
  if (
    !Number.isSafeInteger(season)
    || season < 0
    || !Number.isSafeInteger(episode)
    || episode < 0
    || (season !== 0 && episode === 0)
  ) {
    throw new UsenetError('invalid')
  }

  return durableMaintenance(() => {
    const db = getDb()
    const prior = db
      .select()
      .from(usenetJobs)
      .where(
        and(
          eq(usenetJobs.titleId, intent.titleId),
          eq(usenetJobs.season, season),
          eq(usenetJobs.episode, episode),
          eq(usenetJobs.active, true),
        ),
      )
      .get()
    if (prior) {
      if (prior.releaseKey !== intent.releaseKey)
        throw new UsenetError('target_busy')
      return { job: prior, created: false }
    }

    if (targetFile(intent.titleId, season, episode))
      throw new UsenetError('target_busy')
    const activeCount
      = db
        .select({ value: count() })
        .from(usenetJobs)
        .where(eq(usenetJobs.active, true))
        .get()
        ?.value ?? 0
    if (activeCount >= MAX_ACTIVE)
      throw new UsenetError('not_ready')

    const job = db
      .insert(usenetJobs)
      .values({
        ...intent,
        id: randomUUID(),
        season,
        episode,
        clientGeneration: client.generation,
        state: 'pending',
        active: true,
      })
      .returning()
      .get()
    return { job, created: true }
  })
}

function recordSubmitted(job: Job, nzoId: string) {
  return durableMaintenance(() => {
    const updated = update(job, { nzoId, state: 'queued', problem: null })
    recordUsenetFollow(job, 'grabbed')
    return updated
  })
}

export async function enqueueUsenet(
  intent: UsenetIntent,
  fetchNzb: () => Promise<Uint8Array>,
  assertIntentCurrent?: () => boolean,
) {
  if (
    intent.origin === 'follow'
    && blockedUsenetReleaseKeys(intent.titleId).has(intent.releaseKey)
  ) {
    throw new UsenetError('release_failed')
  }

  const client = requireClient(intent.origin === 'follow')
  if (usenetRestoreBlocked())
    throw new UsenetError('not_ready')

  return await withMaintenanceLease(
    { titleId: intent.titleId, producer: true },
    async () => {
      const { job, created } = reserve(intent, client)
      if (!created)
        return view(job)

      work.add(job.id)
      try {
        let nzb: Uint8Array
        try {
          nzb = await fetchNzb()
          if (!nzb.byteLength || nzb.byteLength > MAX_NZB)
            throw new UsenetError('invalid')
        }
        catch {
          return view(
            durableUpdate(job, {
              active: false,
              state: 'released',
              problem: 'source_unavailable',
            }),
          )
        }

        let sab: ReturnType<typeof asSabClient>
        try {
          checkClient(client, intent.origin === 'follow')
          if (usenetRestoreBlocked())
            throw new UsenetError('not_ready')
          sab = asSabClient(client)
          if (
            targetFile(job.titleId, job.season, job.episode)
            || (assertIntentCurrent && !assertIntentCurrent())
          ) {
            throw new UsenetError('target_busy')
          }
        }
        catch {
          return view(
            durableUpdate(job, {
              active: false,
              state: 'released',
              problem: 'interrupted',
            }),
          )
        }

        // FULL durability is necessary before triggering the external write.
        const submitting = durableMaintenance(() =>
          getDb()
            .update(usenetJobs)
            .set({ state: 'submitting', updatedAt: new Date() })
            .where(
              and(
                eq(usenetJobs.id, job.id),
                eq(usenetJobs.state, 'pending'),
                eq(usenetJobs.active, true),
              ),
            )
            .returning()
            .get(),
        )
        if (!submitting)
          throw new UsenetError('review_required')
        let nzoId: string
        try {
          nzoId = await submitSab(sab, job.id, nzb)
        }
        catch {
          // A transport error, malformed response or duplicate can all occur
          // after SAB started processing the submission.
          return view(
            durableUpdate(submitting, {
              state: 'attention',
              problem: 'submit_uncertain',
            }),
          )
        }
        return view(recordSubmitted(submitting, nzoId))
      }
      finally {
        work.delete(job.id)
      }
    },
  )
}

function importProblem(error: unknown): UsenetProblem {
  if (error instanceof UsenetError)
    return error.kind
  if (error instanceof MaintenanceBusyError)
    return 'not_ready'
  switch ((error as NodeJS.ErrnoException | undefined)?.code) {
    case 'ENOENT':
    case 'EACCES':
    case 'ELOOP':
    case 'EPERM':
    case 'ENOTDIR':
      return 'path_unreadable'
    case 'EEXIST':
      return 'import_conflict'
    case 'ENOSPC':
      return 'insufficient_space'
    default:
      return 'import_failed'
  }
}

async function complete(job: Job, client: UsenetClient, signal?: AbortSignal) {
  const current = durableUpdate(job, {
    state: 'importing',
    progress: 1,
    problem: null,
  })
  try {
    await importUsenet(current, client, () => checkClient(client), signal)
  }
  catch (error) {
    if (!signal?.aborted) {
      const problem = importProblem(error)
      if (problem !== 'not_ready' && problem !== 'review_required')
        setAttention(current, problem)
    }
  }
}

async function observe(
  job: Job,
  state: SabObservation | undefined,
  client: UsenetClient,
  signal?: AbortSignal,
) {
  checkClient(client)
  if (!state) {
    setAttention(job, 'job_missing')
    return
  }
  if (state.state === 'failed') {
    if (state.releaseFailed) {
      const followId = durableMaintenance(() => {
        update(job, {
          state: 'failed',
          active: false,
          problem: 'release_failed',
          progress: null,
        })
        return recordUsenetFollow(job, 'blocklisted')
      })
      if (followId)
        requestFollowSearch(followId, 'retry')
    }
    else {
      setAttention(job, 'download_failed')
    }
    return
  }

  if (state.state === 'completed') {
    if (!state.storage) {
      setAttention(job, 'output_invalid')
      return
    }
    const current = durableUpdate(job, { storage: state.storage })
    await complete(current, client, signal)
    return
  }

  update(job, { state: state.state, progress: state.progress, problem: null })
}

async function reconcile(job: Job, client: UsenetClient, signal?: AbortSignal) {
  if (job.state === 'pending') {
    durableUpdate(job, {
      active: false,
      state: 'released',
      problem: 'interrupted',
    })
    return
  }
  if (job.clientGeneration !== client.generation) {
    setAttention(job, 'client_changed')
    return
  }

  if (job.receipt || (job.state === 'importing' && job.storage)) {
    await complete(job, client, signal)
    return
  }

  const sab = asSabClient(client)
  if (!job.nzoId) {
    const nzoId = await recoverSab(sab, job.id)
    checkClient(client)
    if (!nzoId) {
      setAttention(job, 'submit_uncertain')
      return
    }
    const occupied = getDb()
      .select({ id: usenetJobs.id })
      .from(usenetJobs)
      .where(
        and(
          eq(usenetJobs.clientGeneration, client.generation),
          eq(usenetJobs.nzoId, nzoId),
        ),
      )
      .get()
    if (occupied) {
      setAttention(job, 'submit_uncertain')
      return
    }
    job = recordSubmitted(job, nzoId)
  }
  const nzoId = job.nzoId!
  const observations = await observeSab(sab, [nzoId])
  await observe(job, observations.get(nzoId), client, signal)
}

async function exclusive<T>(
  jobs: Job[],
  run: (available: Job[]) => Promise<T>,
) {
  const available = jobs.filter(job => !work.has(job.id))
  for (const job of available) work.add(job.id)

  try {
    return await run(available)
  }
  finally {
    for (const job of available) work.delete(job.id)
  }
}

export async function reconcileUsenetJob(id: string) {
  const job = getJob(id)
  if (!job.active)
    return view(job)
  const client = requireClient()
  await exclusive([job], async ([candidate]) => {
    if (candidate)
      await reconcile(candidate, client)
  })
  return view(getJob(id))
}

/** Owner action only. The route confirms that the owner checked SAB first. */
export async function releaseUsenetJob(id: string) {
  if (usenetHeld())
    throw new UsenetError('not_ready')

  const job = getJob(id)
  return await exclusive([job], async ([candidate]) => {
    if (!candidate || candidate.state !== 'attention' || !candidate.active)
      throw new UsenetError('review_required')

    return await releaseUnpublishedImport(candidate, () => {
      if (usenetHeld())
        throw new UsenetError('not_ready')
      return view(
        durableUpdate(candidate, {
          active: false,
          state: 'released',
          storage: null,
          receipt: null,
        }),
      )
    })
  })
}

function getsObserved(job: Job, client: UsenetClient) {
  return (
    job.clientGeneration === client.generation
    && Boolean(job.nzoId)
    && !job.receipt
    && job.state !== 'importing'
    && (job.state !== 'attention' || job.problem === 'job_missing')
  )
}

function getsReconciled(job: Job, client: UsenetClient) {
  if (job.clientGeneration !== client.generation)
    return job.problem !== 'client_changed'
  return (
    job.state === 'pending'
    || job.state === 'submitting'
    || job.state === 'importing'
    || (job.state === 'attention' && job.problem === 'submit_uncertain')
  )
}

function recordPollProblem(job: Job, error: unknown, signal?: AbortSignal) {
  if (!signal?.aborted) {
    const problem = error instanceof UsenetError ? error.kind : 'unavailable'
    getDb()
      .update(usenetJobs)
      .set({ problem, updatedAt: new Date() })
      .where(
        and(
          eq(usenetJobs.id, job.id),
          eq(usenetJobs.active, true),
          ne(usenetJobs.state, 'attention'),
        ),
      )
      .run()
  }
}

export async function pollUsenet(signal?: AbortSignal) {
  const client = configuredClient()
  if (signal?.aborted || !client?.enabled || !client.verified || usenetHeld())
    return

  const active = getDb()
    .select()
    .from(usenetJobs)
    .where(eq(usenetJobs.active, true))
    .orderBy(asc(usenetJobs.updatedAt))
    .limit(MAX_ACTIVE)
    .all()
  const known = active
    .filter(job => getsObserved(job, client))
    .slice(0, SAB_BATCH_SIZE)
  const unresolved = active
    .filter(job => getsReconciled(job, client))
    .slice(0, 2)
  if (!known.length && !unresolved.length)
    return

  await exclusive(known, async (jobs) => {
    if (!jobs.length || signal?.aborted)
      return
    let result: Awaited<ReturnType<typeof observeSab>>
    try {
      const ids = jobs.map(job => job.nzoId!)
      result = await observeSab(asSabClient(client), ids)
    }
    catch (error) {
      for (const job of jobs) recordPollProblem(job, error, signal)
      throw error
    }
    for (const job of jobs) {
      if (signal?.aborted)
        return
      try {
        await observe(job, result.get(job.nzoId!), client, signal)
      }
      catch (error) {
        recordPollProblem(job, error, signal)
        throw error
      }
    }
  })

  await exclusive(unresolved, async (jobs) => {
    for (const job of jobs) {
      if (signal?.aborted)
        return
      try {
        await reconcile(job, client, signal)
      }
      catch (error) {
        // Keep the submission state so that a transient outage never
        // converts an unknown POST outcome into a fresh attempt.
        recordPollProblem(job, error, signal)
        throw error
      }
    }
  })
}

export function startUsenetScheduler() {
  const stopped = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let delay = POLL_INITIAL

  async function run() {
    try {
      await pollUsenet(stopped.signal)
      delay = POLL_INITIAL
    }
    catch {
      delay = Math.min(delay * 2, POLL_MAX)
    }
    if (!stopped.signal.aborted)
      timer = setTimeout(() => void run(), delay).unref()
  }
  void run()

  return () => {
    stopped.abort()
    clearTimeout(timer)
  }
}
