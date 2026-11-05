import { createSupportRuntime, environment } from './support.ts'
import { loadSupportAssets } from './supportAssets.ts'
import { correlationHeaders } from '@torsher/api-client'
import type {
  ApiRequestContext,
  ApiRequestObservation,
} from '@torsher/api-client'
import type { DiagnosticContext, DiagnosticInput } from './collector.ts'
import { createDiagnosticPoll, observeDiagnosticPoll } from './poll.ts'
import { createDiagnostics } from './collector.ts'

let collector: ReturnType<typeof createDiagnostics> | undefined
let support: ReturnType<typeof createSupportRuntime> | undefined
let inputTrigger: 'remote' | 'pointer' = 'remote'
export function activationTrigger() {
  return inputTrigger
}
export type { DiagnosticContext, DiagnosticInput }

export function startDiagnostics(
  clientKind: 'browser' | 'webos' | 'android',
  shellVersion?: string,
  settings: () => {
    autoNext?: boolean
    playerMode?: 'browser' | 'native'
  } = () => ({}),
) {
  if (__DEMO__ || collector)
    return
  let storage: Storage | undefined
  try {
    storage = window.localStorage
  }
  catch {
    /* private mode */
  }
  document.addEventListener(
    'click',
    (event) => {
      inputTrigger = event.detail > 0 ? 'pointer' : 'remote'
      void Promise.resolve().then(() => {
        inputTrigger = 'remote'
      })
    },
    true,
  )
  support = createSupportRuntime({
    session: () => collector?.inspect().sessionId,
    now: Date.now,
    emit: diagnostic,
    target: window,
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: timer => clearTimeout(timer),
    assets: () =>
      loadSupportAssets(
        (...args) => fetch(...args),
        document.baseURI,
        __TV_BUILD_ID__,
      ),
    environment: () => ({
      tvBuildId: __TV_BUILD_ID__,
      clientKind,
      shellVersion,
      ...environment(navigator.userAgent),
      deviceModel: 'unsupported',
      autoNext: settings().autoNext,
      playerMode: settings().playerMode,
    }),
  })
  collector = createDiagnostics({
    onSupportChange: enabled => support?.setEnabled(enabled),
    fetch: (...args) => fetch(...args),
    now: Date.now,
    random: Math.random,
    storage,
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: timer => clearTimeout(timer),
    keepalive:
      typeof Request !== 'undefined' && 'keepalive' in Request.prototype,
    beacon: (url, body) => navigator.sendBeacon?.(url, body) ?? false,
  })
  collector.start({
    event: 'client.started',
    tvBuildId: __TV_BUILD_ID__,
    clientKind,
    shellVersion,
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden)
      void collector?.flush(true)
    else collector?.foreground()
  })
  window.addEventListener('pagehide', () => {
    void collector?.flush(true)
  })
  window.addEventListener('online', () => {
    void collector?.flush()
  })
}
export function diagnostic(
  input: DiagnosticInput,
  context?: DiagnosticContext,
  critical = false,
) {
  collector?.add(input, context, critical)
}
export function diagnosticAction(
  parent?: DiagnosticContext,
): DiagnosticContext {
  return collector?.action(parent) ?? Object.freeze({})
}
export function diagnosticRequest(
  context?: DiagnosticContext,
): ApiRequestContext | undefined {
  return context?.actionId ? collector?.request(context) : undefined
}
export function observeDiagnosticRequest(observation: ApiRequestObservation) {
  const poll = observeDiagnosticPoll(observation)
  if (poll && observation.outcome === 'accepted')
    return
  if (
    !observation.context?.actionId
    || (observation.context.saveReason === 'checkpoint'
      && observation.outcome === 'accepted')
  ) {
    return
  }
  diagnostic(
    {
      event: 'request.result',
      outcome: observation.outcome,
      attempt: observation.attempt,
      requestId: observation.requestId,
      statusCode: observation.statusCode,
      durationMs: Math.min(1_000_000, Math.round(observation.durationMs)),
    },
    observation.context,
  )
}
export function beforeDiagnosticProfileChange(profileId?: string) {
  support?.clearMedia()
  collector?.beforeProfileChange(profileId)
}
export function diagnosticProfileChanged(profileId?: string) {
  collector?.profileChanged(profileId)
  support?.refreshEnvironment()
}
export function stopDiagnostics() {
  support?.clearMedia()
  collector?.stop()
}
/** History state carries only correlation, never raw route query or media labels. */
export function diagnosticRoute<T extends { path: string }>(
  route: T,
  context: DiagnosticContext,
) {
  return context.actionId
    ? { ...route, state: { diagnostic: { ...context } } }
    : route
}
export function currentDiagnosticContext(): DiagnosticContext {
  const value
    = typeof window !== 'undefined'
      ? window.history.state?.diagnostic
      : undefined
  if (
    !value
    || typeof value !== 'object'
    || value.clientSessionId !== collector?.inspect().sessionId
  ) {
    return diagnosticAction()
  }
  const context: ApiRequestContext = {}
  for (const key of [
    'actionId',
    'parentActionId',
    'clientSessionId',
    'decisionId',
    'rankingDecisionId',
  ] as const) {
    if (typeof value[key] === 'string' && /^[\w-]{8,80}$/.test(value[key]))
      context[key] = value[key]
  }
  return context.actionId ? Object.freeze(context) : diagnosticAction()
}
export function diagnosticParams(context?: DiagnosticContext) {
  const captured = diagnosticRequest(context)
  return captured ? { headers: correlationHeaders(captured) } : {}
}

export function diagnosticPoll(
  kind: 'files' | 'probe',
  target: Parameters<typeof createDiagnosticPoll>[1],
  context: DiagnosticContext,
) {
  return createDiagnosticPoll(
    kind,
    target,
    context,
    diagnosticAction().actionId,
    { now: Date.now, emit: diagnostic, params: diagnosticParams },
  )
}

export function diagnosticMedia(
  read: Parameters<NonNullable<typeof support>['media']>[0],
) {
  return support?.media(read) ?? (() => {})
}
export function diagnosticSnapshot(
  trigger: Parameters<NonNullable<typeof support>['snapshot']>[0],
) {
  support?.snapshot(trigger)
}
export function diagnosticError(
  ...args: Parameters<NonNullable<typeof support>['error']>
) {
  support?.error(...args)
}
