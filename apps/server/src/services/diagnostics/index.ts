import type { DiagnosticFailureCode } from './failures.ts'
import { createFailureRecorder } from './failures.ts'
import type { FastifyRequest } from 'fastify'
import type { DiagnosticAck, DiagnosticBatch } from '../../dto/diagnostics.ts'
import type { LogSource } from '../logs/index.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { config } from '../../config.ts'
import { diagnosticId } from '../../dto/diagnostics.ts'
import {
  getLogLevel,
  journalHasEvent,
  journalVersion,
  logFor,
  logStorageStatus,
} from '../logs/index.ts'
import { getSetting } from '../settings/index.ts'

export interface DiagnosticContext {
  titleId?: string
  season?: number
  episode?: number
  requestId?: string
  actionId?: string
  parentActionId?: string
  clientSessionId?: string
  clientRequestId?: string
  rankingDecisionId?: string
  decisionId?: string
  attempt?: number
  saveReason?: 'exit' | 'next' | 'source_switch' | 'pause' | 'checkpoint'
  profileId?: string
  deviceId?: string
  actorKind?: 'owner' | 'device' | 'system'
}

export function diagnosticsEnabled() {
  return getSetting<boolean>('userActionDiagnostics') !== false
}
export function diagnosticsCollecting() {
  return ['info', 'debug'].includes(getLogLevel()) && diagnosticsEnabled()
}

/** Capture once at handler entry; no ambient action state across awaits. */
export function diagnosticContext(request: FastifyRequest): DiagnosticContext {
  const result: DiagnosticContext = {
    requestId: request.id,
    profileId: request.profileId || undefined,
    deviceId: request.deviceId ?? undefined,
    actorKind: request.deviceId ? 'device' : 'owner',
  }
  for (const key of [
    'actionId',
    'parentActionId',
    'clientSessionId',
    'clientRequestId',
    'rankingDecisionId',
    'decisionId',
  ] as const) {
    const header = `x-torsher-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`
    const parsed = diagnosticId.safeParse(request.headers[header])
    if (parsed.success)
      result[key] = parsed.data
  }
  const attempt = request.headers['x-torsher-attempt']
  if (typeof attempt === 'string' && /^\d{1,3}$/.test(attempt))
    result.attempt = Number(attempt)
  const reason = request.headers['x-torsher-save-reason']
  if (
    typeof reason === 'string'
    && ['exit', 'next', 'source_switch', 'pause', 'checkpoint'].includes(reason)
  ) {
    result.saveReason = reason as DiagnosticContext['saveReason']
  }
  return result
}

// Only internal callers supply facts: no request/response spread, text or URL.
export function recordDecision(
  source: Extract<LogSource, 'catalog' | 'sources' | 'playback'>,
  event: string,
  context: DiagnosticContext | undefined,
  facts: Record<string, string | number | boolean | null | undefined>,
  details?: object,
) {
  if (!diagnosticsCollecting())
    return
  const serialized = details ? JSON.stringify(details) : undefined
  logFor(source).info(
    {
      ...context,
      event,
      origin: 'server',
      ...facts,
      serverInstance: logStorageStatus().serverInstance,
      ...(serialized && Buffer.byteLength(serialized) <= 3000
        ? { details: serialized }
        : {}),
    },
    event,
  )
}

export function diagnosticsStatus(request: FastifyRequest) {
  return {
    enabled: diagnosticsEnabled(),
    collecting: diagnosticsCollecting(),
    schemaVersion: 1 as const,
    supportFacts: 1 as const,
    serverVersion: config.version,
    serverTime: new Date().toISOString(),
    deviceId: request.deviceId,
    profileId: request.profileId,
    ...logStorageStatus(),
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
/** State belongs to an application instance, is bounded, and resets on restart. */
export function createDiagnosticReceiver() {
  const seen = new Map<string, number>()
  const buckets = new Map<string, { at: number, tokens: number }>()
  let global = { at: Date.now(), tokens: 1000 }
  let rejectedEvents = 0
  let rejectedBatches = 0
  const maintain = () => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (now - bucket.at >= 60_000)
        buckets.delete(key)
    }
    if (rejectedBatches) {
      if (diagnosticsCollecting()) {
        logFor('client').info(
          {
            event: 'diagnostics.rate_limit',
            origin: 'server',
            serverInstance: logStorageStatus().serverInstance,
            rejectedEvents,
            rejectedBatches,
          },
          'Diagnostic events rate limited',
        )
      }
      rejectedEvents = 0
      rejectedBatches = 0
    }
  }
  const timer = setInterval(maintain, 60_000)
  timer.unref()
  const rejected = (count: number) => {
    rejectedEvents += count
    rejectedBatches++
    return true
  }
  function spend(
    bucket: { at: number, tokens: number },
    count: number,
    rate: number,
    capacity: number,
  ) {
    const now = Date.now()
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + (Math.max(0, now - bucket.at) * rate) / 60_000,
    )
    bucket.at = now
    if (bucket.tokens < count)
      return false
    bucket.tokens -= count
    return true
  }
  return {
    limited(actor: string, count: number) {
      if (buckets.size >= 1000) {
        for (const [key, value] of buckets) {
          if (Date.now() - value.at >= 60_000)
            buckets.delete(key)
        }
        if (buckets.size >= 1000 && !buckets.has(actor))
          return rejected(count)
      }
      const bucket = buckets.get(actor) ?? { at: Date.now(), tokens: 64 }
      buckets.set(actor, bucket)
      const limited
        = !spend(global, count, 1000, 1000) || !spend(bucket, count, 120, 64)
      return limited ? rejected(count) : false
    },
    receive(
      batch: DiagnosticBatch,
      request: FastifyRequest,
      sessionState: (id: string) => 'owned' | 'foreign' | 'closed',
    ): DiagnosticAck {
      const { serverInstance, fileSinkState } = logStorageStatus()
      const result: DiagnosticAck = {
        accepted: [],
        duplicate: [],
        rejected: [],
        serverInstance,
        fileSinkState,
      }
      const now = Date.now()
      for (const [key, at] of seen) {
        if (now - at >= DAY_MS)
          seen.delete(key)
      }
      for (const event of batch.events) {
        const reject = (code: DiagnosticAck['rejected'][number]['code']) =>
          result.rejected.push({ eventId: event.eventId, code })
        if (!diagnosticsEnabled()) {
          reject('disabled')
          continue
        }
        if (!diagnosticsCollecting()) {
          reject('level_filtered')
          continue
        }
        if (
          event.eventId !== `${event.clientSessionId}:${event.clientSeq}`
          || Buffer.byteLength(JSON.stringify(event)) > 4096
        ) {
          reject('invalid_event')
          continue
        }
        const binding = event.session ? sessionState(event.session) : undefined
        if (binding === 'foreign') {
          reject('invalid_event')
          continue
        }
        const key = `${request.userId}:${request.deviceId}:${request.profileId}:${event.eventId}`
        if (seen.has(key)) {
          result.duplicate.push(event.eventId)
          continue
        }
        // Candidate facts are explicitly client reported; never log a raw request.
        const {
          requestId: reportedRequestId,
          session: reportedSession,
          ...clean
        } = event
        const supportFact = [
          'client.environment',
          'client.error',
          'client.error_summary',
          'playback.snapshot',
        ].includes(event.event)
        const scalars = supportFact
          ? { event: event.event }
          : Object.fromEntries(
              Object.entries(clean).filter(
                ([, value]) => typeof value !== 'object',
              ),
            )
        const record = {
          eventId: event.eventId,
          actionId: event.actionId,
          clientSessionId: event.clientSessionId,
          clientSeq: event.clientSeq,
          clientRequestId: event.clientRequestId,
          requestId: request.id,
          reportedRequestId,
          reportedSession,
          session: binding === 'owned' ? reportedSession : undefined,
          sessionBinding: binding,
          deviceId: request.deviceId ?? undefined,
          profileId: request.profileId,
          actorKind: request.deviceId ? 'device' : 'owner',
          origin: 'client',
          serverInstance,
          ...(event.event === 'client.started'
            ? { serverVersion: config.version }
            : {}),
          ...scalars,
          details: JSON.stringify(event),
        }
        if (Buffer.byteLength(JSON.stringify(record)) > 3800) {
          reject('invalid_event')
          continue
        }
        const before = journalVersion()
        logFor('client').info(record, event.event)
        if (journalVersion() === before || !journalHasEvent(event.eventId)) {
          reject('journal_unavailable')
          continue
        }
        if (seen.size >= 10_000)
          seen.delete(seen.keys().next().value!)
        seen.set(key, now)
        result.accepted.push(event.eventId)
      }
      result.fileSinkState = logStorageStatus().fileSinkState
      return result
    },
    clear() {
      clearInterval(timer)
      rejectedEvents = 0
      rejectedBatches = 0
      seen.clear()
      buckets.clear()
      global = { at: Date.now(), tokens: 1000 }
    },
  }
}

export function newDecisionId() {
  return randomUUID()
}

const snapshots = new Map<string, { facts: string, id: string, at: number }>()
/** Reuse only identical short-lived projections; never retain full product payloads. */
export function decisionSnapshot(
  event: string,
  key: string,
  context: DiagnosticContext | undefined,
  facts: Record<string, string | number | boolean | null | undefined>,
  details?: object,
) {
  if (!diagnosticsCollecting())
    return undefined
  const now = Date.now()
  const signature = JSON.stringify([facts, details])
  const previous = snapshots.get(`${event}:${key}`)
  if (previous && previous.facts === signature && now - previous.at < 60_000)
    return previous.id
  if (snapshots.size >= 1000)
    snapshots.delete(snapshots.keys().next().value!)
  const id = newDecisionId()
  snapshots.set(`${event}:${key}`, { facts: signature, id, at: now })
  recordDecision(
    'catalog',
    event,
    context,
    { decisionId: id, ...facts },
    details,
  )
  return id
}

const checkpoints = new Map<string, { at: number, state: string }>()
/** Positions change every checkpoint; retain transitions and at most one periodic snapshot/minute. */
export function recordCheckpoint(
  event: string,
  context: DiagnosticContext | undefined,
  facts: Record<string, string | number | boolean | null | undefined>,
) {
  if (!diagnosticsCollecting())
    return
  const key = `${event}:${facts.profileId ?? context?.profileId}:${facts.titleId ?? facts.torrentId}:${facts.season}:${facts.episode}:${facts.fileIndex}`
  const state = JSON.stringify([
    facts.torrentId,
    facts.mediaFileId,
    facts.fileIndex,
    facts.watchedAfter,
    facts.statusCode,
  ])
  const previous = checkpoints.get(key)
  if (
    (!context?.saveReason || context.saveReason === 'checkpoint')
    && previous?.state === state
    && Date.now() - previous.at < 60_000
  ) {
    return
  }
  if (checkpoints.size >= 1000)
    checkpoints.delete(checkpoints.keys().next().value!)
  checkpoints.set(key, { at: Date.now(), state })
  recordDecision('playback', event, context, facts)
}

const failures = createFailureRecorder((source, fields) =>
  logFor(source).info(fields, String(fields.event)),
)
/** Classified errors only; preserve the original operation and error propagation. */
export function recordFailure(
  source: 'server' | 'playback' | 'engine',
  code: DiagnosticFailureCode,
  context?: DiagnosticContext,
  facts: {
    session?: string
    reportedSession?: string
    statusCode?: number
    uptimeMs?: number
    exitCode?: number
  } = {},
) {
  if (!diagnosticsCollecting())
    return
  failures.record(
    source,
    code,
    { ...context, ...facts },
    logStorageStatus().serverInstance,
    Date.now(),
  )
}

/** Read-only report accessor: exporting never changes the journal or collection policy. */
export function failureSummarySnapshot() {
  return failures.snapshot(logStorageStatus().serverInstance, Date.now())
}
