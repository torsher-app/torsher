import type { Follow } from '../../db/schema.ts'
import type { RejectionCode, SeasonPlan } from './decide.ts'
import { z } from 'zod'
import { diagnosticId, diagnosticTitleId } from '../../dto/diagnostics.ts'
import { EngineError } from '../engine/client.ts'
import { SourceError } from '../torznab/client.ts'
import { storageErrno } from '../storage/logDiagnostics.ts'

const codes = {
  title_unsure: true,
  screen_copy: true,
  no_russian: true,
  no_original: true,
  no_language: true,
  quality: true,
  size: true,
  blocklisted: true,
  voice_strict: true,
  no_wanted: true,
  already_downloading: true,
  no_seeders: true,
  wait: true,
  outranked: true,
  not_available: true,
  not_better: true,
  watched: true,
  manual: true,
} satisfies Record<RejectionCode, true>
const rejectionCodes = Object.keys(codes) as RejectionCode[]
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const episode = z.number().int().min(0).max(9999)
const identity = { titleId: diagnosticTitleId, followId: diagnosticId }
const reasonPattern = `(?:${rejectionCodes.join('|')}):[1-9]\\d{0,5}`
const reasons = z
  .string()
  .max(500)
  .regex(new RegExp(`^(?:none|${reasonPattern}(?:,${reasonPattern}){0,4})$`))
  .transform(value =>
    value === 'none'
      ? []
      : value.split(',').map((item) => {
          const [code, total] = item.split(':')
          return { code: code as RejectionCode, count: Number(total) }
        }),
  )
const failure = {
  errorKind: z.enum(['engine', 'source', 'filesystem', 'unknown']),
  engineKind: z
    .enum([
      'unavailable',
      'not_found',
      'rejected',
      'timeout',
      'moving',
      'failed',
    ])
    .optional(),
  sourceKind: z
    .enum([
      'auth',
      'timeout',
      'unreachable',
      'bad_response',
      'remote',
      'unsupported',
    ])
    .optional(),
  errno: z
    .enum([
      'EACCES',
      'EPERM',
      'EROFS',
      'ENOTDIR',
      'EEXIST',
      'ENOENT',
      'ENOSPC',
      'EDQUOT',
      'EIO',
      'ESTALE',
    ])
    .optional(),
  status: z.number().int().min(100).max(599).optional(),
}
export const followDiagnosticEvents = {
  'follow.search': z.object({
    ...identity,
    season: episode,
    modeAtSearchStart: z.enum(['download', 'notify']),
    episodes: count,
    toGrab: count,
    pending: count,
    rejected: count,
    found: count,
    indexers: count,
    failed: count,
    reasons,
    cached: z.boolean(),
    network: z.boolean(),
  }),
  'follow.postponed': z.object({
    ...identity,
    reason: z.enum([
      'title_missing',
      'indexers_paused',
      'no_indexers',
      'not_released',
    ]),
    until: z.string().datetime(),
  }),
  'follow.grabbed': z.object({
    ...identity,
    torrentId: diagnosticId,
    infoHash: z.string().regex(/^[a-f0-9]{40}$/),
    season: episode,
    episodes: z
      .string()
      .regex(/^\d{1,4}(?:,\d{1,4}){0,19}$/)
      .transform(value => value.split(',').map(Number)),
    episodeCount: count,
    episodesTruncated: z.boolean(),
  }),
  'follow.search_failed': z.object({ ...identity, ...failure }),
  'follow.acquire_failed': z.object({ ...identity, ...failure }),
  'follow.tick_failed': z.object({
    titleId: diagnosticTitleId.optional(),
    followId: diagnosticId.optional(),
    ...failure,
  }),
}
export function followDiagnosticRule(event: unknown) {
  return typeof event === 'string'
    && Object.hasOwn(followDiagnosticEvents, event)
    ? followDiagnosticEvents[event as keyof typeof followDiagnosticEvents]
    : undefined
}
export function followPlanFacts(plan: SeasonPlan, episodes: number) {
  const selected = new Set([
    ...plan.grabs.map(grab => grab.candidate),
    ...plan.pending.map(item => item.candidate),
  ])
  const counts = new Map<RejectionCode, number>()
  for (const candidate of plan.candidates) {
    for (const code of new Set(candidate.rejections.map(item => item.code)))
      counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return {
    episodes,
    toGrab: plan.grabs.length,
    pending: plan.pending.length,
    rejected: plan.candidates.filter(
      candidate =>
        !selected.has(candidate) && candidate.rejections.length > 0,
    ).length,
    reasons:
      rejectionCodes
        .filter(code => counts.has(code))
        .sort((a, b) => counts.get(b)! - counts.get(a)!)
        .slice(0, 5)
        .map(code => `${code}:${Math.min(counts.get(code)!, 999999)}`)
        .join(',') || 'none',
  }
}
export function followErrorFacts(error: unknown) {
  if (error instanceof EngineError) {
    return {
      errorKind: 'engine',
      engineKind: error.kind,
      ...(error.status === undefined ? {} : { status: error.status }),
    }
  }
  if (error instanceof SourceError) {
    return {
      errorKind: 'source',
      sourceKind: error.kind,
      ...(error.status === undefined ? {} : { status: error.status }),
    }
  }
  const errno = storageErrno(error)
  return errno === 'unknown'
    ? { errorKind: 'unknown' }
    : { errorKind: 'filesystem', errno }
}
// Не меняем исключение (включая frozen Error) и не удерживаем его после GC.
const failureTitles = new WeakMap<object, Pick<Follow, 'titleId' | 'id'>>()
export function rememberFollowFailure(
  error: unknown,
  follow: Pick<Follow, 'titleId' | 'id'>,
) {
  if (
    error !== null
    && (typeof error === 'object' || typeof error === 'function')
  ) {
    failureTitles.set(error, { id: follow.id, titleId: follow.titleId })
  }
}
export function followFailureIdentity(error: unknown) {
  const follow
    = error !== null && (typeof error === 'object' || typeof error === 'function')
      ? failureTitles.get(error)
      : undefined
  return follow ? { titleId: follow.titleId, followId: follow.id } : {}
}
