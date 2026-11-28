import type {
  ArrApplyBody,
  ArrApplyResult,
  ArrConnectionBody,
  ArrErrorKind,
  ArrPreviewBody,
} from '../../dto/arrTransfer.ts'
import type { ArrPreparedRow } from './arrMatch.ts'
import type { ArrTarget } from './arrSource.ts'
import { randomUUID } from 'node:crypto'
import { canImportFollowFor, importPausedFollow } from '../follow/index.ts'
import { prepareArrRows } from './arrMatch.ts'
import {
  ArrImportError,
  readArrSource,
  resolveArrTarget,
} from './arrSource.ts'

const MINUTE = 60_000
const CONNECTION_TTL = 5 * MINUTE
const PREVIEW_DEADLINE = 10 * MINUTE
const PREVIEW_TTL = 30 * MINUTE

interface Connection {
  id: string
  target: ArrTarget
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

interface Job {
  id: string
  profileId: string
  abort: AbortController
  timer: ReturnType<typeof setTimeout>
  state: 'preparing' | 'ready'
  checked: number
  total: number
  rows: ArrPreparedRow[]
  expiresAt?: number
  error?: ArrErrorKind
  applied?: { selected: string[], result: ArrApplyResult }
}

export function createArrImportService() {
  const connections = new Map<string, Connection>()
  const resolving = new Set<string>()
  const jobs = new Map<string, Job>()

  function forgetConnection(ownerId: string) {
    const existing = connections.get(ownerId)
    if (existing)
      clearTimeout(existing.timer)
    connections.delete(ownerId)
  }

  function forgetJob(ownerId: string) {
    const existing = jobs.get(ownerId)
    if (existing) {
      clearTimeout(existing.timer)
      existing.abort.abort()
    }
    jobs.delete(ownerId)
  }

  function getJob(ownerId: string, id: string) {
    const job = jobs.get(ownerId)
    if (!job || job.id !== id)
      throw new ArrImportError('expired')
    if (job.expiresAt !== undefined && job.expiresAt <= Date.now()) {
      forgetJob(ownerId)
      throw new ArrImportError('expired')
    }
    return job
  }

  function finish(ownerId: string, job: Job) {
    if (jobs.get(ownerId) !== job)
      return
    clearTimeout(job.timer)
    job.state = 'ready'
    job.expiresAt = Date.now() + PREVIEW_TTL
    job.timer = setTimeout(forgetJob, PREVIEW_TTL, ownerId).unref()
  }

  function start(
    ownerId: string,
    { connectionId, approveLan, apiKey, profileId, language }: ArrPreviewBody,
  ) {
    if (jobs.get(ownerId)?.state === 'preparing' || resolving.has(ownerId))
      throw new ArrImportError('busy')

    const connection = connections.get(ownerId)
    if (!connection || connection.id !== connectionId)
      throw new ArrImportError('expired')
    if (connection.expiresAt <= Date.now()) {
      forgetConnection(ownerId)
      throw new ArrImportError('expired')
    }
    if (connection.target.addresses.length && !approveLan)
      throw new ArrImportError('address')
    if (!canImportFollowFor(profileId))
      throw new ArrImportError('profile')

    forgetConnection(ownerId)
    forgetJob(ownerId)

    const abort = new AbortController()
    const job: Job = {
      id: randomUUID(),
      profileId,
      abort,
      timer: setTimeout(
        () => abort.abort(new DOMException('Preview deadline', 'TimeoutError')),
        PREVIEW_DEADLINE,
      ).unref(),
      state: 'preparing',
      checked: 0,
      total: 0,
      rows: [],
    }
    jobs.set(ownerId, job)

    const kind = connection.target.kind
    // readArrSource owns the key; only normalized rows enter the preview task.
    void readArrSource(connection.target, apiKey, abort.signal)
      .then(async (rows) => {
        if (jobs.get(ownerId) !== job)
          return
        job.total = rows.length
        job.rows = await prepareArrRows(
          rows,
          kind,
          language,
          abort.signal,
          randomUUID,
          () => job.checked++,
        )
      })
      .catch((error: unknown) => {
        job.error = error instanceof ArrImportError ? error.kind : 'request'
      })
      .finally(() => finish(ownerId, job))

    return { id: job.id }
  }

  function apply(ownerId: string, body: ArrApplyBody): ArrApplyResult {
    const job = getJob(ownerId, body.previewId)
    if (job.state === 'preparing')
      throw new ArrImportError('busy')
    if (job.error)
      throw new ArrImportError(job.error)

    const selected = [...new Set(body.rowIds)].sort()
    if (job.applied) {
      if (
        selected.length !== job.applied.selected.length
        || !selected.every((id, index) => id === job.applied?.selected[index])
      ) {
        throw new ArrImportError('expired')
      }
      return job.applied.result
    }

    if (!canImportFollowFor(job.profileId))
      throw new ArrImportError('profile')
    const selectedSet = new Set(selected)
    const rows = job.rows.flatMap((row) => {
      return row.seed && selectedSet.has(row.preview.id)
        ? [{ id: row.preview.id, seed: row.seed }]
        : []
    })
    if (rows.length !== selected.length)
      throw new ArrImportError('request')

    const result: ArrApplyResult = {
      created: 0,
      skipped: 0,
      failed: 0,
      rows: [],
    }
    let profileAvailable = true
    for (const { id, seed } of rows) {
      if (profileAvailable) {
        try {
          const reason = importPausedFollow(seed, job.profileId)
          if (reason === 'created') {
            result.created++
            result.rows.push({ id, reason, outcome: 'created' })
            continue
          }
          if (reason === 'existing') {
            result.skipped++
            result.rows.push({ id, reason, outcome: 'skipped' })
            continue
          }
          profileAvailable = false
        }
        catch {
          // The row transaction was rolled back. Do not expose the exception.
        }
      }
      result.failed++
      result.rows.push({ id, reason: 'failed', outcome: 'failed' })
    }

    // Applying is synchronous, so another request can only see the saved
    // report or a different selection, never an intermediate write.
    job.applied = { selected, result }
    finish(ownerId, job)
    return result
  }

  return {
    async connection(ownerId: string, input: ArrConnectionBody) {
      if (resolving.has(ownerId) || jobs.get(ownerId)?.state === 'preparing')
        throw new ArrImportError('busy')
      resolving.add(ownerId)
      forgetConnection(ownerId)
      try {
        const target = await resolveArrTarget(input)
        if (!resolving.has(ownerId))
          throw new ArrImportError('expired')
        const id = randomUUID()
        const timer = setTimeout(
          forgetConnection,
          CONNECTION_TTL,
          ownerId,
        ).unref()
        connections.set(ownerId, {
          id,
          target,
          timer,
          expiresAt: Date.now() + CONNECTION_TTL,
        })
        return { id, origin: target.base.origin, addresses: target.addresses }
      }
      finally {
        resolving.delete(ownerId)
      }
    },
    start,
    preview(ownerId: string, id: string) {
      const job = getJob(ownerId, id)
      if (job.error)
        throw new ArrImportError(job.error)
      return {
        state: job.state,
        checked: job.checked,
        total: job.total,
        rows: job.rows.map(row => row.preview),
      }
    },
    cancel(ownerId: string, id: string) {
      getJob(ownerId, id)
      forgetJob(ownerId)
    },
    apply,
    close() {
      for (const ownerId of connections.keys()) forgetConnection(ownerId)
      for (const ownerId of jobs.keys()) forgetJob(ownerId)
      resolving.clear()
    },
  }
}
