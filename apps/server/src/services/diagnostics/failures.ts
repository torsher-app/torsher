export type FailureSource = 'server' | 'playback' | 'engine'
export type DiagnosticFailureCode
  = | 'request_failed'
    | 'probe_failed'
    | 'segment_timeout'
    | 'engine_unavailable'
    | 'transcode_failed'
    | 'playback_not_found'
    | 'engine_exited'
    | 'engine_process_error'
type Facts = Record<string, string | number | boolean | undefined>
interface Bucket {
  source: FailureSource
  facts: Facts
  start: number
  expires: number
  suppressed: number
  saturated: boolean
}
const WINDOW_MS = 60_000
const MAX_KEYS = 128
const MAX_COUNT = 1_000_000

/** Session/actor-scoped first failures; bounded overflow aggregation, no request-ID map. */
export function createFailureRecorder(
  emit: (source: FailureSource, fields: Facts) => void,
) {
  const buckets = new Map<string, Bucket>()
  const overflow = new Map<string, Bucket>() // At most source * stable failure-code count.
  let instance: string | undefined
  const summaryFields = (
    bucket: Bucket,
    now: number,
    reason: 'repeated' | 'capacity',
  ): Facts => ({
    ...bucket.facts,
    event: 'server.failure_summary',
    origin: 'server',
    serverInstance: instance,
    suppressionReason: reason,
    suppressed: bucket.suppressed,
    suppressedSaturated: bucket.saturated,
    windowStartedAt: new Date(bucket.start).toISOString(),
    windowEndedAt: new Date(now).toISOString(),
  })
  const summary = (
    bucket: Bucket,
    now: number,
    reason: 'repeated' | 'capacity',
  ) => {
    if (!bucket.suppressed)
      return
    emit(bucket.source, summaryFields(bucket, now, reason))
    bucket.suppressed = 0
    bucket.saturated = false
    bucket.start = now
  }
  const sync = (serverInstance: string) => {
    if (instance === serverInstance)
      return
    buckets.clear()
    overflow.clear()
    instance = serverInstance
  }
  const increment = (bucket: Bucket) => {
    if (bucket.suppressed < MAX_COUNT)
      bucket.suppressed++
    else bucket.saturated = true
  }
  return {
    record(
      source: FailureSource,
      code: DiagnosticFailureCode,
      facts: Facts,
      serverInstance: string,
      now: number,
    ) {
      sync(serverInstance)
      for (const [key, bucket] of buckets) {
        if (now >= bucket.expires) {
          summary(bucket, now, 'repeated')
          buckets.delete(key)
        }
      }
      for (const [key, bucket] of overflow) {
        if (now >= bucket.expires) {
          summary(bucket, now, 'capacity')
          overflow.delete(key)
        }
      }
      const key = JSON.stringify([
        source,
        code,
        facts.actorKind,
        facts.deviceId,
        facts.profileId,
        facts.session
          ? 'session'
          : facts.reportedSession
            ? 'reportedSession'
            : 'clientSession',
        facts.session ?? facts.reportedSession ?? facts.clientSessionId ?? null,
      ])
      const previous = buckets.get(key)
      if (previous) {
        increment(previous)
        return
      }
      if (buckets.size >= MAX_KEYS) {
        const key = `${source}:${code}`
        const bucket = overflow.get(key) ?? {
          source,
          facts: { code },
          start: now,
          expires: now + WINDOW_MS,
          suppressed: 0,
          saturated: false,
        }
        increment(bucket)
        overflow.set(key, bucket)
        return
      }
      const scope: Facts = { code }
      for (const key of [
        'actorKind',
        'deviceId',
        'profileId',
        'session',
        'reportedSession',
        'clientSessionId',
      ])
        scope[key] = facts[key]
      buckets.set(key, {
        source,
        facts: scope,
        start: now,
        expires: now + WINDOW_MS,
        suppressed: 0,
        saturated: false,
      })
      emit(source, {
        ...facts,
        code,
        event: 'server.failure',
        origin: 'server',
        serverInstance,
      })
    },
    snapshot(serverInstance: string, now: number) {
      sync(serverInstance)
      return [
        ...[...buckets.values()]
          .filter(bucket => bucket.suppressed)
          .map(bucket => ({
            source: bucket.source,
            ...summaryFields(bucket, now, 'repeated'),
          })),
        ...[...overflow.values()]
          .filter(bucket => bucket.suppressed)
          .map(bucket => ({
            source: bucket.source,
            ...summaryFields(bucket, now, 'capacity'),
          })),
      ]
    },
    /** Flush before pinning an export, including a still-open observation window. */
    flush(serverInstance: string, now: number) {
      sync(serverInstance)
      for (const bucket of buckets.values()) summary(bucket, now, 'repeated')
      for (const bucket of overflow.values()) summary(bucket, now, 'capacity')
    },
  }
}
