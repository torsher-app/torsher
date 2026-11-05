import type { ApiRequestObservation } from '@torsher/api-client'
import type { DiagnosticContext, DiagnosticInput } from './collector.ts'

type Summary = Extract<DiagnosticInput, { event: 'poll.summary' }>
type Target = Pick<
  Summary,
  | 'titleId'
  | 'season'
  | 'episode'
  | 'torrentId'
  | 'fileIndex'
  | 'mediaFileId'
  | 'session'
>
interface Scope {
  observe: (value: ApiRequestObservation) => void
  started: number
  invalidate: (reason: 'ttl' | 'capacity') => void
}
const scopes = new Map<string, Scope>()
const MAX_SCOPES = 64
const TTL = 10 * 60_000
export function observeDiagnosticPoll(value: ApiRequestObservation) {
  if (!value.context.pollId)
    return false
  scopes.get(value.context.pollId)?.observe(value)
  // Even a completed/evicted scope must not create a flood of late successes.
  return true
}
export function createDiagnosticPoll(
  kind: Summary['kind'],
  target: Target,
  context: DiagnosticContext,
  pollId: string | undefined,
  deps: {
    now: () => number
    emit: (value: DiagnosticInput, context: DiagnosticContext) => void
    params: (context: DiagnosticContext) => {
      headers?: Record<string, string>
    }
  },
) {
  const started = deps.now()
  let requests = 0
  let attempts = 0
  let errors = 0
  let firstRequestId: string | undefined
  let lastRequestId: string | undefined
  let errorRequestId: string | undefined
  let finished = false
  let incompleteReason: 'ttl' | 'capacity' | 'not_instrumented' | undefined
  const captured = Object.freeze({ ...context, pollId })
  if (pollId) {
    for (const [id, scope] of scopes) {
      if (started - scope.started > TTL) {
        scope.invalidate('ttl')
        scopes.delete(id)
      }
    }
    if (scopes.size >= MAX_SCOPES) {
      const oldest = scopes.keys().next().value!
      scopes.get(oldest)!.invalidate('capacity')
      scopes.delete(oldest)
    }
    scopes.set(pollId, {
      started,
      invalidate(reason) {
        incompleteReason ??= reason
      },
      observe(value) {
        attempts++
        if (value.requestId) {
          firstRequestId ??= value.requestId
          lastRequestId = value.requestId
        }
        if (value.outcome !== 'accepted') {
          errors++
          if (value.requestId)
            errorRequestId = value.requestId
        }
      },
    })
  }
  return {
    params() {
      requests++
      const params = deps.params(captured)
      const headers = new Headers(params.headers)
      if (
        !pollId
        || headers.get('X-Torsher-Poll-Id') !== pollId
        || !headers.get('X-Torsher-Client-Request-Id')
      ) {
        incompleteReason ??= 'not_instrumented'
      }
      return params
    },
    finish(outcome: Summary['outcome']) {
      if (finished)
        return
      finished = true
      if (pollId)
        scopes.delete(pollId)
      if (!pollId || !requests)
        return
      deps.emit(
        {
          event: 'poll.summary',
          ...target,
          pollId,
          kind,
          outcome,
          observationsComplete: !incompleteReason,
          incompleteReason,
          requests,
          attempts,
          errors,
          durationMs: Math.min(1_000_000, Math.max(0, deps.now() - started)),
          firstRequestId,
          lastRequestId,
          errorRequestId,
        },
        context,
      )
    },
  }
}
