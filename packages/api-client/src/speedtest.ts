import type {
  InternetSpeedtest,
  LocalSpeedtest,
  SpeedtestSample,
} from './generated'
import { createSeries } from './speedtestSeries'

export interface LocalMeasurement {
  bytesPerSecond: number | null
  latencyMs: number | null
  durationMs: number
  payloadBytes: number
  shortened: boolean
  startedAt: string
  samples: SpeedtestSample[]
}
export type LocalStatus
  = | 'idle'
    | 'preparing'
    | 'latency'
    | 'download'
    | 'complete'
    | 'insufficient'
    | 'cancelled'
    | 'error'
export interface LocalSpeedtestState {
  status: LocalStatus
  error:
    | 'busy'
    | 'rate_limited'
    | 'unsupported'
    | 'unavailable'
    | 'unauthorized'
    | 'invalid_response'
    | 'network'
    | 'limit_reached'
    | null
  result: LocalMeasurement | null
}
export class SpeedtestReadError extends Error {
  readonly kind: NonNullable<LocalSpeedtestState['error']>
  constructor(kind: NonNullable<LocalSpeedtestState['error']>) {
    super(kind)
    this.kind = kind
  }
}
export function speedtestSupported() {
  return (
    typeof fetch === 'function'
    && typeof AbortController === 'function'
    && typeof ReadableStream === 'function'
    && typeof performance !== 'undefined'
  )
}
function check(response: Response, id: string, binary = false) {
  if (!response.ok) {
    throw new SpeedtestReadError(
      response.status === 401
        ? 'unauthorized'
        : response.status === 404
          ? 'unavailable'
          : response.status === 409
            ? 'busy'
            : response.status === 429
              ? 'rate_limited'
              : 'network',
    )
  }
  if (
    response.headers.get('X-Torsher-Speedtest-Id') !== id
    || response.headers.get('Content-Encoding')
    || (binary
      && response.headers.get('Content-Type')?.split(';')[0]
      !== 'application/octet-stream')
  ) {
    throw new SpeedtestReadError('invalid_response')
  }
}
/** Raw same-origin measurement transport: no API retries, refresh, or payload buffering. */
export async function readLocalSpeedtest(
  session: LocalSpeedtest,
  signal: AbortSignal,
  update: (status: 'latency' | 'download', result: LocalMeasurement) => void,
  options: { fetch?: typeof fetch, now?: () => number, demo?: boolean } = {},
): Promise<LocalMeasurement> {
  const rawFetch = options.fetch ?? ((input, init) => fetch(input, init))
  const now = options.now ?? (() => performance.now())
  const result: LocalMeasurement = {
    bytesPerSecond: null,
    latencyMs: null,
    durationMs: 0,
    payloadBytes: 0,
    shortened: false,
    startedAt: session.startedAt,
    samples: [],
  }
  const request = (path: string) =>
    rawFetch(`/api/speedtest/local/${encodeURIComponent(session.id)}/${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
    })
  const delays: number[] = []
  update('latency', { ...result })
  for (let i = 0; i < 6; i++) {
    const start = now()
    const response = await request('latency')
    try {
      check(response, session.id)
    }
    catch (error) {
      await response.body?.cancel().catch(() => {})
      throw error
    }
    await response.text()
    if (i)
      delays.push(now() - start)
  }
  result.latencyMs = delays.sort((a, b) => a - b)[2] ?? null
  if (signal.aborted)
    throw new Error('aborted')
  let phaseStarted: number | undefined
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const stop = () => {
    controller.abort()
    void reader?.cancel().catch(() => {})
  }
  signal.addEventListener('abort', stop, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  let ticker: ReturnType<typeof setInterval> | undefined
  const series = createSeries(session.maxRequestBytes, result.latencyMs ?? 0)
  let reserved = 0
  let snapshot: ((time: number) => void) | undefined
  async function transfer(bytes: number, seq: number) {
    const before = now()
    const response = await rawFetch(
      `/api/speedtest/local/${encodeURIComponent(session.id)}/download?bytes=${bytes}&seq=${seq}`,
      {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      },
    )
    if (
      options.demo
      && response.headers.get('X-Torsher-Speedtest-Demo') === '1'
    ) {
      return { demo: (await response.json()) as LocalMeasurement, duration: 0 }
    }
    try {
      check(response, session.id, true)
      if (
        response.headers.get('X-Torsher-Speedtest-Seq') !== String(seq)
        || response.headers.get('X-Torsher-Speedtest-Bytes') !== String(bytes)
      ) {
        throw new SpeedtestReadError('invalid_response')
      }
    }
    catch (error) {
      await response.body?.cancel().catch(() => {})
      throw error
    }
    if (!response.body || typeof response.body.getReader !== 'function')
      throw new SpeedtestReadError('unsupported')
    reader = response.body.getReader()
    let received = 0
    try {
      while (!controller.signal.aborted) {
        const item = await reader.read()
        if (item.done)
          break
        received += item.value.byteLength
        result.payloadBytes += item.value.byteLength
        if (received > bytes || result.payloadBytes > session.maxBytes)
          throw new SpeedtestReadError('invalid_response')
      }
      if (controller.signal.aborted)
        throw new Error('phase_aborted')
      if (received !== bytes)
        throw new SpeedtestReadError('invalid_response')
      return { duration: now() - before }
    }
    finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
      reader = undefined
    }
  }
  try {
    update('download', { ...result })
    reserved += 16 * 1024
    const warmup = await transfer(16 * 1024, 0)
    if (warmup.demo)
      return warmup.demo
    phaseStarted = now()
    const origin = phaseStarted
    let lastTrace = origin
    snapshot = (time: number) => {
      if (time <= lastTrace)
        return
      const estimate = series.value
      if (estimate !== null) {
        result.samples.push({
          seconds: (time - origin) / 1000,
          bytesPerSecond: estimate,
          phase: 'download',
        })
      }
      result.durationMs = time - origin
      result.bytesPerSecond = series.value
      update('download', { ...result, samples: result.samples.slice() })
      lastTrace = time
    }
    ticker = setInterval(
      () => snapshot!(Math.min(now(), origin + session.durationMs)),
      200,
    )
    timer = setTimeout(() => {
      snapshot!(origin + session.durationMs)
      stop()
    }, session.durationMs)
    let seq = 1
    while (!controller.signal.aborted && now() - origin < session.durationMs) {
      if (seq >= session.maxRequests || reserved >= session.maxBytes)
        throw new SpeedtestReadError('limit_reached')
      const bytes = Math.min(series.size, session.maxBytes - reserved)
      reserved += bytes
      const sample = await transfer(bytes, seq++)
      const time = now()
      if (time - origin <= session.durationMs)
        series.observe(bytes, sample.duration)
    }
  }
  catch (error) {
    if (
      signal.aborted
      || error instanceof SpeedtestReadError
      || !controller.signal.aborted
    ) {
      throw error
    }
  }
  finally {
    clearInterval(ticker)
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    if (phaseStarted !== undefined) {
      snapshot?.(Math.min(now(), phaseStarted + session.durationMs))
      result.durationMs = Math.max(0, now() - phaseStarted)
    }
  }
  if (signal.aborted)
    throw new Error('aborted')
  result.shortened = false
  result.bytesPerSecond = series.value
  return result
}

/** Owns generations and release, including a start response arriving after cancellation. */
export function createLocalSpeedtest(options: {
  start: () => Promise<LocalSpeedtest>
  cancel: (id: string) => Promise<unknown>
  update: (state: LocalSpeedtestState) => void
  errorStatus: (error: unknown) => number | undefined
  demo?: boolean
}) {
  let state: LocalSpeedtestState = {
    status: 'idle',
    error: null,
    result: null,
  }
  const publish = (next: LocalSpeedtestState) => {
    state = next
    options.update(next)
  }
  let generation = 0
  let controller: AbortController | undefined
  let id: string | undefined
  // A measured 401 must not trigger the generated client's automatic refresh.
  // Retry this release only when the user explicitly starts another check.
  let deferredCleanup: string | undefined
  const release = (value: string) => options.cancel(value).catch(() => {})
  function stop() {
    generation++
    controller?.abort()
    controller = undefined
    if (id) {
      void release(id)
      id = undefined
    }
    publish({ ...state, status: 'cancelled', error: null })
  }
  async function start() {
    const current = ++generation
    if (!speedtestSupported()) {
      publish({ status: 'error', error: 'unsupported', result: null })
      return
    }
    const abort = new AbortController()
    controller = abort
    publish({ status: 'preparing', error: null, result: null })
    let timer: ReturnType<typeof setTimeout> | undefined
    let session: LocalSpeedtest | undefined
    let unauthorizedMeasurement = false
    try {
      if (deferredCleanup) {
        const previous = deferredCleanup
        await release(previous)
        if (deferredCleanup === previous)
          deferredCleanup = undefined
        if (current !== generation)
          return
      }
      session = await options.start()
      if (current !== generation)
        return
      id = session.id
      timer = setTimeout(() => abort.abort(), session.deadlineMs)
      const result = await readLocalSpeedtest(
        session,
        abort.signal,
        (status, result) => {
          if (current === generation)
            publish({ status, error: null, result })
        },
        { demo: options.demo },
      )
      if (current === generation) {
        publish({
          status: result.bytesPerSecond === null ? 'insufficient' : 'complete',
          error: null,
          result,
        })
      }
    }
    catch (error) {
      unauthorizedMeasurement
        = error instanceof SpeedtestReadError && error.kind === 'unauthorized'
      if (unauthorizedMeasurement && session)
        deferredCleanup = session.id
      if (current !== generation)
        return
      const status = options.errorStatus(error)
      const kind
        = error instanceof SpeedtestReadError
          ? error.kind
          : status === 409
            ? 'busy'
            : status === 429
              ? 'rate_limited'
              : status === 404
                ? 'unavailable'
                : status === 401
                  ? 'unauthorized'
                  : 'network'
      publish({ status: 'error', error: kind, result: null })
    }
    finally {
      clearTimeout(timer)
      if (session && !unauthorizedMeasurement)
        await release(session.id)
      if (current === generation) {
        id = undefined
        controller = undefined
      }
    }
  }
  return { start, stop }
}

export interface InternetSpeedtestState {
  status: 'idle' | 'preparing' | InternetSpeedtest['state']
  error: LocalSpeedtestState['error']
  result: InternetSpeedtest | null
}
/** Shared control-only runner. Measurement data never travels through this client. */
export function createInternetSpeedtest(options: {
  start: () => Promise<InternetSpeedtest>
  status: (id: string) => Promise<InternetSpeedtest>
  heartbeat: (id: string) => Promise<unknown>
  cancel: (id: string) => Promise<unknown>
  update: (state: InternetSpeedtestState) => void
  errorStatus: (error: unknown) => number | undefined
}) {
  let state: InternetSpeedtestState = {
    status: 'idle',
    error: null,
    result: null,
  }
  let generation = 0
  let id: string | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined
  const publish = (next: InternetSpeedtestState) => {
    state = next
    options.update(next)
  }
  const clear = () => {
    clearTimeout(pollTimer)
    clearTimeout(heartbeatTimer)
  }
  const release = (value: string) => options.cancel(value).catch(() => {})
  function terminal(status: 'cancelled' | 'error') {
    const previous = state.result
    if (!previous)
      return null
    const result: InternetSpeedtest = {
      ...previous,
      state: status,
      phase: 'finished',
      reason: status === 'cancelled' ? 'cancelled' : null,
      finishedAt: new Date().toISOString(),
    }
    if (
      status === 'error'
      && (previous.phase === 'download' || previous.phase === 'upload')
    ) {
      result[previous.phase] = {
        ...previous[previous.phase],
        bytesPerSecond: null,
      }
    }
    return result
  }
  function stop() {
    generation++
    clear()
    if (id) {
      void release(id)
      id = undefined
    }
    publish({
      status: 'cancelled',
      error: null,
      result: terminal('cancelled'),
    })
  }
  function fail(error: unknown) {
    generation++
    clear()
    const status = options.errorStatus(error)
    const kind
      = status === 409
        ? 'busy'
        : status === 429
          ? 'rate_limited'
          : status === 404
            ? 'unavailable'
            : status === 401
              ? 'unauthorized'
              : 'network'
    if (id) {
      void release(id)
      id = undefined
    }
    publish({ status: 'error', error: kind, result: terminal('error') })
  }
  async function start() {
    const current = ++generation
    clear()
    publish({ status: 'preparing', error: null, result: null })
    try {
      const result = await options.start()
      if (current !== generation) {
        await release(result.id)
        return
      }
      id = result.state === 'running' ? result.id : undefined
      publish({ status: result.state, error: null, result })
      const poll = async () => {
        if (current !== generation || id !== result.id)
          return
        try {
          const next = await options.status(result.id)
          if (current !== generation || id !== result.id)
            return
          publish({ status: next.state, error: null, result: next })
          if (next.state === 'running') {
            pollTimer = setTimeout(poll, 250)
          }
          else {
            id = undefined
            clear()
          }
        }
        catch (error) {
          if (current === generation && id === result.id)
            fail(error)
        }
      }
      const heartbeat = async () => {
        if (current !== generation || id !== result.id)
          return
        try {
          await options.heartbeat(result.id)
        }
        catch (error) {
          if (current === generation && id === result.id)
            fail(error)
          return
        }
        if (current === generation && id === result.id)
          heartbeatTimer = setTimeout(heartbeat, 1000)
      }
      if (id) {
        pollTimer = setTimeout(poll, 250)
        heartbeatTimer = setTimeout(heartbeat, 1000)
      }
    }
    catch (error) {
      if (current === generation)
        fail(error)
    }
  }
  return { start, stop }
}
