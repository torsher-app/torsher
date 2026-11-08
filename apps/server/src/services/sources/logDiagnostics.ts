import type { SearchOutcome } from './search.ts'
import { z } from 'zod'
import { diagnosticId, diagnosticTitleId } from '../../dto/diagnostics.ts'
import { logFor } from '../logs/index.ts'
import { SourceError } from '../torznab/client.ts'

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const ms = z.number().int().min(0).max(31_536_000_000)
const errorKind = z.enum([
  'auth',
  'timeout',
  'unreachable',
  'bad_response',
  'remote',
  'unsupported',
  'unknown',
])
const status = z.number().int().min(100).max(599)
const summary = z.object({
  titleId: diagnosticTitleId.optional(),
  season: count.optional(),
  asked: count,
  ok: count,
  failed: count,
  skipped: count,
  raw: count,
  kept: count,
  ms,
  customQuery: z.boolean(),
})

// У каждой эксплуатационной строки свой контракт для safe report.
export const sourceDiagnosticEvents = {
  'sources.search': summary.extend({ cached: z.literal(false) }),
  'sources.cache_hit': summary.extend({ cached: z.literal(true) }),
  'sources.indexer_failed': z.object({
    titleId: diagnosticTitleId.optional(),
    season: count.optional(),
    indexerId: diagnosticId,
    errorKind: z.enum([...errorKind.options, 'late']),
    status: status.optional(),
    mode: z.enum(['id', 'text']),
    ms,
  }),
  'sources.backoff_paused': z.object({
    indexerId: diagnosticId,
    failures: count,
    until: z.string().datetime(),
  }),
  'sources.backoff_returned': z.object({
    indexerId: diagnosticId,
    failures: count,
  }),
  'sources.check_failed': z.object({
    operation: z.enum([
      'indexer_add',
      'indexer_check',
      'manager_import',
      'manager_sync',
    ]),
    indexerId: diagnosticId.optional(),
    managerId: diagnosticId.optional(),
    errorKind,
    status: status.optional(),
  }),
}
export type SearchDiagnostics = z.infer<typeof summary>
export function sourceDiagnosticRule(event: unknown) {
  return typeof event === 'string'
    && Object.hasOwn(sourceDiagnosticEvents, event)
    ? sourceDiagnosticEvents[event as keyof typeof sourceDiagnosticEvents]
    : undefined
}
export function sourceErrorFacts(err: unknown) {
  return err instanceof SourceError
    ? {
        errorKind: err.kind,
        ...(err.status === undefined ? {} : { status: err.status }),
      }
    : { errorKind: 'unknown' }
}
export function logSearchCacheHit(outcome: SearchOutcome) {
  if (outcome.diagnostics) {
    logFor('sources').debug(
      {
        event: 'sources.cache_hit',
        origin: 'server',
        ...outcome.diagnostics,
        cached: true,
      },
      'Source search cache hit',
    )
  }
}
export function logSourceCheckError(
  err: unknown,
  context: {
    operation:
      'indexer_add' | 'indexer_check' | 'manager_import' | 'manager_sync'
    indexerId?: string
    managerId?: string
  },
) {
  logFor('sources').warn(
    {
      event: 'sources.check_failed',
      origin: 'server',
      ...context,
      ...sourceErrorFacts(err),
    },
    'Source check failed',
  )
}
