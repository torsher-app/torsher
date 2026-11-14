import { authDiagnosticRule } from '../auth/logDiagnostics.ts'
import { followDiagnosticRule } from '../follow/logDiagnostics.ts'
import {
  engineRequestDiagnostic,
  storageDiagnosticRule,
} from '../storage/logDiagnostics.ts'
import type { LogEntry } from './ring.ts'
import { z } from 'zod'
import { engineDiagnosticRule } from '../engine/logDiagnostics.ts'
import { sourceDiagnosticRule } from '../sources/logDiagnostics.ts'
import { speedtestFailure } from '../speedtest/logDiagnostics.ts'
import {
  candidateDiagnostics,
  diagnosticCandidateId,
  diagnosticEvent,
  diagnosticId,
  diagnosticTitleId,
} from '../../dto/diagnostics.ts'

const count = z.number().int().min(0).max(1_000_000)
const duration = z.number().min(0).max(31_536_000_000)
const episode = z.number().int().min(0).max(9999)
const requestId = z.string().regex(/^(?:req-[a-z0-9]{1,16}|[\w-]{8,80})$/)
const version = z.string().regex(/^[\w.-]{1,80}$/)
const reasons = z.enum([
  'ContainerNotSupported',
  'VideoCodecNotSupported',
  'VideoBitDepthNotSupported',
  'AudioCodecNotSupported',
  'AudioTrackSwitchNotSupported',
  'SubtitleCodecNotSupported',
  'HlsNotSupported',
  'ToolsMissing',
  'ProbeFailed',
  'DurationUnknown',
])
// Every allowed field has its own grammar. Unknown fields, including log message,
// error stack and raw details, never cross this boundary.
const fields = {
  code: z.enum([
    'request_failed',
    'probe_failed',
    'segment_timeout',
    'engine_unavailable',
    'transcode_failed',
    'playback_not_found',
    'engine_exited',
    'engine_process_error',
  ]),
  failureCode: z.enum(['engine_exited', 'engine_process_error']),
  suppressed: count,
  suppressedSaturated: z.boolean(),
  suppressionReason: z.enum(['repeated', 'capacity']),
  windowStartedAt: z.string().datetime(),
  windowEndedAt: z.string().datetime(),
  uptimeMs: duration,
  exitCode: z.number().int().min(-255).max(255),
  requestId,
  actionId: diagnosticId,
  parentActionId: diagnosticId,
  clientSessionId: diagnosticId,
  clientRequestId: diagnosticId,
  decisionId: diagnosticId,
  rankingDecisionId: diagnosticId,
  resumeDecisionId: diagnosticId,
  continuationDecisionId: diagnosticId,
  session: diagnosticId,
  reportedSession: diagnosticId,
  reportedRequestId: requestId,
  deviceId: diagnosticId,
  profileId: diagnosticId,
  torrentId: diagnosticId,
  mediaFileId: diagnosticId,
  previousTorrentId: diagnosticId,
  presetId: diagnosticId,
  followId: diagnosticId,
  candidateId: diagnosticCandidateId,
  titleId: diagnosticTitleId,
  serverInstance: diagnosticId,
  serverVersion: version,
  actorKind: z.enum(['owner', 'device', 'system']),
  sessionBinding: z.enum(['owned', 'foreign', 'closed']),
  season: episode,
  episode,
  fromSeason: episode,
  fromEpisode: episode,
  previousSeason: episode,
  previousEpisode: episode,
  fileIndex: count,
  previousFileIndex: count,
  attempt: count,
  attemptIndex: count,
  found: count,
  eligible: count,
  lowConfidence: count,
  noSeeders: count,
  foreignAudio: count,
  upgraded: count,
  picked: count,
  width: count,
  height: count,
  rejectedEvents: count,
  rejectedBatches: count,
  position: duration,
  previousPosition: duration,
  duration,
  previousDuration: duration,
  elapsedMs: duration,
  ms: duration,
  cacheAgeMs: duration,
  statusCode: z.number().int().min(100).max(599),
  committedAt: z.string().datetime(),
  cacheHit: z.boolean(),
  watched: z.boolean(),
  previousWatched: z.boolean(),
  watchedBefore: z.boolean(),
  watchedAfter: z.boolean(),
  next: z.boolean(),
  followNewEpisode: z.boolean(),
  rankingApplied: z.boolean(),
  mode: z.enum(['hls', 'direct', 'remux', 'transcode', 'pick', 'grab']),
  branch: z.enum([
    'known_torrent',
    'follow_pick',
    'ranked_candidate',
    'requested',
  ]),
  outcome: z.enum([
    'started',
    'ready',
    'stale',
    'resolving',
    'file_found',
    'episode_absent',
    'open_rejected',
    'accepted',
    'failed',
    'cancelled',
  ]),
  reason: z.enum([
    'no_history',
    'resume_rewatch',
    'resume_incomplete',
    'metadata_unavailable',
    'metadata_error',
    'no_aired_unwatched',
    'next_unwatched',
    'follow_new',
    'resume',
    'client',
    'idle',
    'shutdown',
  ]),
  saveReason: z.enum(['exit', 'next', 'source_switch', 'pause', 'checkpoint']),
  selectionHistory: z.enum(['unavailable', 'current_decision']),
  selectionReason: z.enum([
    'unavailable',
    'cutoff',
    'window_expired',
    'upgrade',
    'mixed',
    'pending_ready',
  ]),
  preferenceReason: z.enum([
    'season_meaningful',
    'season_recent',
    'unavailable',
  ]),
  baselineReason: z.enum([
    'unavailable',
    'season_meaningful',
    'meaningful',
    'recent',
  ]),
  quality: z.enum([
    '2160p',
    '1440p',
    '1080p',
    '1080i',
    '720p',
    '576p',
    '480p',
    '360p',
  ]),
  operationId: z.enum([
    'getHome',
    'getHomeContinue',
    'getTitleProgress',
    'getTitleContinue',
    'getTitleUpNext',
    'getTitleSources',
    'getTitleLibrary',
    'postTitleOpen',
    'postTitleWatch',
    'openFollowPick',
    'postPlayback',
    'putWatchState',
    'deletePlayback',
  ]),
}
const serverEvents = new Set([
  'server.failure',
  'server.failure_summary',
  'continue.decided',
  'resume.decided',
  'continuation.preference',
  'upnext.decided',
  'source.resolve',
  'source.ranked',
  'source.attempt',
  'source.selected',
  'source.opened',
  'source.follow_pick',
  'follow.choice',
  'playback.requested',
  'playback.ready',
  'playback.closed',
  'progress.saved',
  'progress.file_saved',
  'request.completed',
  'diagnostics.rate_limit',
])
const skipped = z.object({
  total: count,
  truncated: z.boolean(),
  ranges: z
    .array(
      z.object({
        season: episode,
        from: episode,
        to: episode,
        reason: z.enum(['watched', 'unavailable']),
      }),
    )
    .max(20),
})
const followDecision = z.object({
  selectionHistory: fields.selectionHistory.optional(),
  selectionReason: fields.selectionReason.optional(),
  cutoffStep: count.optional(),
  candidateStep: count.optional(),
  voiceAtCutoff: z.boolean().optional(),
  ownVoice: z.boolean().optional(),
  sameTopic: z.boolean().optional(),
  waitHours: count.optional(),
  score: z.number().min(-1e9).max(1e9).optional(),
  seeders: count.optional(),
  audioPriority: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  typePriority: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  cutoffEpisodes: count.optional(),
  expiredEpisodes: count.optional(),
  upgradeEpisodes: count.optional(),
  noSpaceEpisodes: count.optional(),
  windowTotal: count.optional(),
  upgradeTotal: count.optional(),
  windows: z
    .array(z.object({ season: episode, episode, until: z.string().datetime() }))
    .max(20)
    .optional(),
})
const detailsFields = {
  target: z.object({ season: episode, episode }),
  preferredTorrent: z
    .object({ torrentId: diagnosticId, fileIndex: count })
    .nullable(),
  baseline: z
    .object({
      file: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('torrent'),
          torrentId: diagnosticId,
          fileIndex: count,
        }),
        z.object({ kind: z.literal('library'), mediaFileId: diagnosticId }),
      ]),
      video: z
        .object({ width: count, height: count, basis: z.literal('probe') })
        .nullable(),
    })
    .nullable(),
  decision: followDecision,
  follow: z.object({
    followId: diagnosticId,
    basis: z.enum(['upgrade_from', 'downloaded', 'picked']),
    candidateId: diagnosticCandidateId.optional(),
    farthestSeason: episode.optional(),
    farthestEpisode: episode.optional(),
    farthestWatched: z.boolean().optional(),
    farthestPosition: duration.optional(),
    farthestDuration: duration.nullable().optional(),
  }),
  skipped,
  reasons: z.array(reasons).max(16),
  encode: z.object({ width: count, height: count }),
  episodes: z
    .array(z.object({ season: episode, episode, fileIndex: count.optional() }))
    .max(20),
  total: count,
  truncated: z.boolean(),
  followTargetUsed: z.boolean(),
  candidates: z
    .array(
      z.object({
        diagnostics: candidateDiagnostics.optional(),
        candidateId: diagnosticCandidateId,
        rank: count.optional(),
        score: z.number().min(-1e9).max(1e9).optional(),
        audioPriority: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
        typePriority: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
        confidence: z.enum(['high', 'medium', 'low']).optional(),
        seeders: count.optional(),
        quality: fields.quality.nullable().optional(),
        resolution: z
          .object({
            value: z.enum(['2160p', '1080p', '720p', 'SD']),
            basis: z.enum(['probe', 'file', 'title', 'source', 'codec']),
            sure: z.boolean(),
          })
          .nullable()
          .optional(),
      }),
    )
    .max(3),
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function select(
  input: Record<string, unknown>,
  schema: Record<string, z.ZodType>,
) {
  const result: Record<string, unknown> = {}
  for (const [key, rule] of Object.entries(schema)) {
    if (input[key] === undefined)
      continue
    const parsed = rule.safeParse(input[key])
    if (parsed.success)
      result[key] = parsed.data
  }
  return result
}
function detailObject(value: unknown) {
  if (typeof value !== 'string' || value.length > 65536)
    return undefined
  try {
    return object(JSON.parse(value))
  }
  catch {
    return undefined
  }
}
export interface ReportEvent {
  observedAt: string
  origin: 'client' | 'server'
  event: string
  facts: Record<string, unknown>
  diagnostic?: z.infer<typeof diagnosticEvent>
  details?: Record<string, unknown>
  repeat?: number
}
export type Projection
  = | { kind: 'event', value: ReportEvent }
    | { kind: 'invalid' | 'unstructured' | 'outside_window' }

export function projectRecord(
  input: unknown,
  cutoffAt: number,
  retentionMs: number,
): Projection {
  const raw = object(input)
  if (!raw || (typeof raw.time !== 'number' && typeof raw.time !== 'string'))
    return { kind: 'invalid' }
  const at = new Date(raw.time).getTime()
  if (!Number.isFinite(at))
    return { kind: 'invalid' }
  if (at > cutoffAt || at <= cutoffAt - retentionMs)
    return { kind: 'outside_window' }
  const observedAt = new Date(at).toISOString()
  if (raw.event === 'speedtest.failed') {
    if (raw.origin !== 'server' || raw.source !== 'network')
      return { kind: 'unstructured' }
    const parsed = speedtestFailure.safeParse(raw)
    if (!parsed.success)
      return { kind: 'unstructured' }
    return {
      kind: 'event',
      value: {
        observedAt,
        origin: 'server',
        event: 'speedtest.failed',
        facts: parsed.data,
      },
    }
  }
  const authRule = authDiagnosticRule(raw.event)
  if (authRule) {
    if (raw.origin !== 'server' || raw.source !== 'auth')
      return { kind: 'unstructured' }
    const parsed = authRule.safeParse(raw)
    if (!parsed.success)
      return { kind: 'unstructured' }
    return {
      kind: 'event',
      value: {
        observedAt,
        origin: 'server',
        event: String(raw.event),
        facts: parsed.data,
        ...(typeof raw.repeat === 'number'
          && Number.isSafeInteger(raw.repeat)
          && raw.repeat > 1
          ? { repeat: Math.min(raw.repeat, 1_000_000) }
          : {}),
      },
    }
  }
  const followRule = followDiagnosticRule(raw.event)
  if (followRule) {
    if (raw.origin !== 'server' || raw.source !== 'catalog')
      return { kind: 'unstructured' }
    const parsed = followRule.safeParse(raw)
    if (!parsed.success)
      return { kind: 'unstructured' }
    return {
      kind: 'event',
      value: {
        observedAt,
        origin: 'server',
        event: String(raw.event),
        facts: parsed.data,
        ...(typeof raw.repeat === 'number'
          && Number.isSafeInteger(raw.repeat)
          && raw.repeat > 1
          ? { repeat: Math.min(raw.repeat, 1_000_000) }
          : {}),
      },
    }
  }
  const storageRule = storageDiagnosticRule(raw.event)
  const requestRule
    = raw.event === 'engine.request_failed' ? engineRequestDiagnostic : undefined
  if (storageRule || requestRule) {
    if (
      raw.origin !== 'server'
      || raw.source !== (storageRule ? 'storage' : 'engine')
    ) {
      return { kind: 'unstructured' }
    }
    const parsed = (storageRule ?? requestRule)!.safeParse(raw)
    if (!parsed.success)
      return { kind: 'unstructured' }
    return {
      kind: 'event',
      value: {
        observedAt,
        origin: 'server',
        event: String(raw.event),
        facts: parsed.data,
        ...(typeof raw.repeat === 'number'
          && Number.isSafeInteger(raw.repeat)
          && raw.repeat > 1
          ? { repeat: Math.min(raw.repeat, 1_000_000) }
          : {}),
      },
    }
  }
  const sourceRule = sourceDiagnosticRule(raw.event)
  if (sourceRule) {
    if (raw.origin !== 'server' || raw.source !== 'sources')
      return { kind: 'unstructured' }
    const parsed = sourceRule.safeParse(raw)
    if (!parsed.success)
      return { kind: 'unstructured' }
    return {
      kind: 'event',
      value: {
        observedAt,
        origin: 'server',
        event: String(raw.event),
        facts: parsed.data,
        ...(typeof raw.repeat === 'number'
          && Number.isSafeInteger(raw.repeat)
          && raw.repeat > 1
          ? { repeat: Math.min(raw.repeat, 1_000_000) }
          : {}),
      },
    }
  }
  const engineRule = engineDiagnosticRule(raw.event)
  if (engineRule) {
    if (raw.origin !== 'server' || raw.source !== 'engine')
      return { kind: 'unstructured' }
    const parsed = engineRule.schema.safeParse(raw)
    if (!parsed.success)
      return { kind: 'unstructured' }
    return {
      kind: 'event',
      value: {
        observedAt,
        origin: 'server',
        event: String(raw.event),
        facts: parsed.data,
        ...(typeof raw.repeat === 'number'
          && Number.isSafeInteger(raw.repeat)
          && raw.repeat > 1
          ? { repeat: Math.min(raw.repeat, 1_000_000) }
          : {}),
      },
    }
  }
  const facts = select(raw, fields)
  if (
    raw.origin === 'server'
    && (raw.event === 'server.failure'
      || raw.event === 'server.failure_summary')
    && ['server', 'playback', 'engine'].includes(String(raw.source))
  ) {
    facts.failureSource = raw.source
  }
  const repeat
    = typeof raw.repeat === 'number'
      && Number.isSafeInteger(raw.repeat)
      && raw.repeat > 1
      ? Math.min(raw.repeat, 1_000_000)
      : undefined
  if (raw.origin === 'client' && raw.source === 'client') {
    const parsed = diagnosticEvent.safeParse(detailObject(raw.details))
    if (!parsed.success || parsed.data.event !== raw.event)
      return { kind: 'unstructured' }
    return {
      kind: 'event',
      value: {
        observedAt,
        origin: 'client',
        event: parsed.data.event,
        facts,
        diagnostic: parsed.data,
        ...(repeat ? { repeat } : {}),
      },
    }
  }
  if (
    raw.origin !== 'server'
    || typeof raw.event !== 'string'
    || !serverEvents.has(raw.event)
  ) {
    return { kind: 'unstructured' }
  }
  const detail = detailObject(raw.details)
  const details = detail ? select(detail, detailsFields) : undefined
  return {
    kind: 'event',
    value: {
      observedAt,
      origin: 'server',
      event: raw.event,
      facts,
      ...(details && Object.keys(details).length ? { details } : {}),
      ...(repeat ? { repeat } : {}),
    },
  }
}

export function projectRingEntry(
  entry: LogEntry,
  cutoffAt: number,
  retentionMs: number,
) {
  return projectRecord(
    {
      ...entry.context,
      time: entry.time,
      source: entry.source,
      details: entry.details,
      repeat: entry.repeat,
    },
    cutoffAt,
    retentionMs,
  )
}

/** Stable safe representation, also the exact cross-source dedup key. */
export function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
