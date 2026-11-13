import type {
  DiagnosticMediaSnapshot,
  DiagnosticPlaybackNetwork,
} from '@torsher/api-client'
import type { DiagnosticContext, DiagnosticInput } from './collector.ts'
import type { AssetMap } from './supportAssets.ts'
import { createSafeErrorStackReader } from './errorStack.ts'
import { safeLocations } from './supportAssets.ts'

type ErrorFact = Extract<DiagnosticInput, { event: 'client.error' }>
type Environment = Extract<DiagnosticInput, { event: 'client.environment' }>
export type SupportContext = DiagnosticContext & { session?: string }
export interface MediaObservation {
  media: DiagnosticMediaSnapshot
  network?: DiagnosticPlaybackNetwork
  context: SupportContext
  active: boolean
  stalled?: boolean
}

export function environment(
  ua: string,
): Pick<
  Environment,
  'browserFamily' | 'browserVersion' | 'osFamily' | 'osVersion'
> {
  const result: ReturnType<typeof environment> = {
    browserFamily: 'unknown',
    osFamily: 'unknown',
  }
  const limited = ua.slice(0, 2048)
  for (const [family, regex] of [
    ['chromium', /(?:Chrome|Chromium)\/([\d.]+)/],
    ['firefox', /Firefox\/([\d.]+)/],
    ['safari', /Version\/([\d.]+)\s[^\n]*Safari/],
  ] as const) {
    const match = limited.match(regex)
    if (match) {
      result.browserFamily = family
      if (/^\d{1,4}(?:\.\d{1,4}){0,3}$/.test(match[1]!))
        result.browserVersion = match[1]
      break
    }
  }
  for (const [family, regex] of [
    ['webos', /(?:Web0S|webOS)(?:[ /]([\d.]+))?/i],
    ['android', /Android ([\d.]+)/],
    ['ios', /(?:iPhone OS|CPU OS) ([\d_]+)/],
    ['windows', /Windows NT ([\d.]+)/],
    ['macos', /Mac OS X ([\d_]+)/],
    ['linux', /Linux/],
  ] as const) {
    const match = limited.match(regex)
    if (match) {
      result.osFamily = family
      const version = match[1]?.replace(/_/g, '.')
      if (version && /^\d{1,4}(?:\.\d{1,4}){0,3}$/.test(version))
        result.osVersion = version
      break
    }
  }
  return result
}

/**
 Read only own data properties of arbitrary reasons;
getters are never invoked.
 */
function data(value: unknown, key: string): unknown {
  try {
    return value && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, key)?.value
      : undefined
  }
  catch {
    return undefined
  }
}
function errorCode(value: unknown): ErrorFact['code'] {
  const names: Record<string, ErrorFact['code']> = {
    TypeError: 'type_error',
    RangeError: 'range_error',
    ReferenceError: 'reference_error',
    SyntaxError: 'syntax_error',
    URIError: 'uri_error',
    EvalError: 'eval_error',
    AbortError: 'abort_error',
    NetworkError: 'network_error',
    NotAllowedError: 'not_allowed',
    NotSupportedError: 'not_supported',
  }
  try {
    // Native Error.name usually lives on its prototype. Do not read arbitrary getters.
    const name
      = data(value, 'name')
        ?? (value instanceof Error
          ? data(Object.getPrototypeOf(value), 'name')
          : undefined)
    return typeof name === 'string' ? (names[name] ?? 'unknown') : 'unknown'
  }
  catch {
    return 'unknown'
  }
}
export function supportContext(context?: DiagnosticContext): DiagnosticContext {
  return {
    clientSessionId: context?.clientSessionId,
    actionId: context?.actionId,
    parentActionId: context?.parentActionId,
    clientRequestId: context?.clientRequestId,
  }
}

/** No IO until enabled. Holds bounded fingerprints and a provider, never a second media ring. */
export function createSupportRuntime(deps: {
  session: () => string | undefined
  now: () => number
  emit: (
    input: DiagnosticInput,
    context?: DiagnosticContext,
    critical?: boolean,
  ) => void
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>
  schedule: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>
  cancel: (timer: ReturnType<typeof setTimeout>) => void
  assets: () => Promise<AssetMap>
  environment: () => Omit<Environment, 'event' | 'assetManifest'>
}) {
  const safeErrorStack = createSafeErrorStackReader()
  let enabled = false
  let generation = 0
  let lastEnvironment: string | undefined
  let assets: AssetMap = new Map()
  let provider: (() => MediaObservation | undefined) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSnapshot = -Infinity
  let lastMediaState: string | undefined
  let transitionTimer: ReturnType<typeof setTimeout> | undefined
  let windowStart = 0
  let errors = 0
  let suppressed = 0
  let summaryAt = 0
  const fingerprints = new Map<string, number>()
  function observed() {
    try {
      const current = provider?.()
      return current?.context.clientSessionId === deps.session()
        ? current
        : undefined
    }
    catch {
      return undefined
    }
  }
  function refreshEnvironment() {
    if (!enabled)
      return
    try {
      const input: Environment = {
        ...deps.environment(),
        event: 'client.environment',
        assetManifest: assets.size ? 'available' : 'unavailable',
      }
      const fingerprint = JSON.stringify(input)
      if (fingerprint === lastEnvironment)
        return
      lastEnvironment = fingerprint
      deps.emit(input)
    }
    catch {
      /* Optional settings must never break bootstrap. */
    }
  }
  function summary() {
    if (suppressed && deps.now() - summaryAt >= 60_000) {
      deps.emit({ event: 'client.error_summary', suppressed, reason: 'mixed' })
      suppressed = 0
      summaryAt = deps.now()
    }
  }
  function error(
    source: ErrorFact['source'],
    reason: unknown,
    code?: ErrorFact['code'],
    context?: SupportContext,
    runtimeLocation?: ReturnType<typeof safeLocations>,
  ) {
    if (!enabled)
      return
    try {
      const now = deps.now()
      if (now - windowStart >= 60_000) {
        errors = 0
        windowStart = now
      }
      summary()
      const stackLocation = safeLocations(safeErrorStack(reason), assets)
      const location = stackLocation.locations.length
        ? stackLocation
        : (runtimeLocation ?? stackLocation)
      const classified = code ?? errorCode(reason)
      const fingerprint = JSON.stringify([
        source,
        classified,
        location.locations,
      ])
      for (const [key, time] of fingerprints) {
        if (now - time >= 600_000)
          fingerprints.delete(key)
      }
      const previous = fingerprints.get(fingerprint)
      if (errors >= 6 || (previous !== undefined && now - previous < 60_000)) {
        suppressed = Math.min(1_000_000, suppressed + 1)
        return
      }
      if (fingerprints.size >= 32)
        fingerprints.delete(fingerprints.keys().next().value!)
      fingerprints.set(fingerprint, now)
      errors++
      const current = observed()
      // Global errors observe media, but have no proven causal link to its action/session.
      deps.emit(
        {
          event: 'client.error',
          tvBuildId: deps.environment().tvBuildId,
          source,
          code: classified,
          ...location,
          media: current?.media,
          ...(context?.session ? { session: context.session } : {}),
        },
        supportContext(context),
        true,
      )
    }
    catch {
      /* Never recursively report errors in diagnostics. */
    }
  }
  const onError = ((event: ErrorEvent) => {
    try {
      error(
        'runtime',
        event.error,
        undefined,
        undefined,
        safeLocations(
          ` at (${event.filename}:${event.lineno}:${event.colno})`,
          assets,
        ),
      )
    }
    catch {
      /* An event accessor must not recursively trigger this hook. */
    }
  }) as EventListener
  const onRejection = ((event: PromiseRejectionEvent) => {
    try {
      event.type === 'unhandledrejection' && error('promise', event.reason)
    }
    catch {
      /* Do not interfere with propagation of the original rejection. */
    }
  }) as EventListener
  function snapshot(
    trigger: Extract<
      DiagnosticInput,
      { event: 'playback.snapshot' }
    >['trigger'],
  ) {
    if (!enabled)
      return
    const current = observed()
    if (!current || (trigger === 'heartbeat' && !current.active))
      return
    const { media, context } = current
    // Progress, buffered endpoints and frame counters are observations, not transitions.
    const state = JSON.stringify([
      context.clientSessionId,
      context.session,
      media.source,
      media.state,
      media.readyState,
      media.networkState,
      media.paused,
      media.ended,
      media.seeking,
      current.active,
      current.stalled,
      media.hls,
      media.native,
      media.mode,
      media.audioTrack,
      media.subtitleTrack,
      media.video,
      media.audio,
      media.reasons,
    ])
    if (trigger === 'heartbeat') {
      if (deps.now() - lastSnapshot < 120_000)
        return
    }
    else {
      if (state === lastMediaState)
        return
      const remaining = 2000 - (deps.now() - lastSnapshot)
      if (remaining > 0) {
        if (transitionTimer === undefined) {
          transitionTimer = deps.schedule(() => {
            transitionTimer = undefined
            // Read the current provider, never retain a second snapshot or a stale session.
            snapshot(observed()?.stalled ? 'buffering' : 'transition')
          }, remaining)
        }
        return
      }
    }
    if (transitionTimer !== undefined)
      deps.cancel(transitionTimer)
    transitionTimer = undefined
    lastMediaState = state
    lastSnapshot = deps.now()
    deps.emit(
      {
        event: 'playback.snapshot',
        trigger,
        media: current.media,
        network: current.network,
        session: current.context.session,
      },
      supportContext(current.context),
    )
  }
  function tick() {
    if (!enabled)
      return
    summary()
    snapshot('heartbeat')
    timer = deps.schedule(tick, 120_000)
  }
  function setEnabled(value: boolean) {
    if (value === enabled)
      return
    enabled = value
    lastEnvironment = undefined
    const run = ++generation
    assets = new Map()
    fingerprints.clear()
    errors = 0
    suppressed = 0
    windowStart = deps.now()
    summaryAt = deps.now()
    lastSnapshot = -Infinity
    lastMediaState = undefined
    if (transitionTimer !== undefined)
      deps.cancel(transitionTimer)
    transitionTimer = undefined
    if (timer !== undefined)
      deps.cancel(timer)
    timer = undefined
    if (!value) {
      deps.target.removeEventListener('error', onError)
      deps.target.removeEventListener('unhandledrejection', onRejection)
      return
    }
    deps.target.addEventListener('error', onError)
    deps.target.addEventListener('unhandledrejection', onRejection)
    timer = deps.schedule(tick, 120_000)
    void deps
      .assets()
      .then((result) => {
        if (!enabled || generation !== run)
          return
        assets = result
        refreshEnvironment()
      })
      .catch(() => {
        /* Asset observation is best effort. */
      })
  }
  function clearMedia() {
    provider = undefined
    lastMediaState = undefined
    if (transitionTimer !== undefined)
      deps.cancel(transitionTimer)
    transitionTimer = undefined
  }
  return {
    setEnabled,
    clearMedia,
    refreshEnvironment,
    error,
    snapshot,
    media(read: () => MediaObservation | undefined) {
      provider = read
      return () => {
        if (provider === read)
          clearMedia()
      }
    },
  }
}
