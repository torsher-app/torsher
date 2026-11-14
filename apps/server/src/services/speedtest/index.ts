import type { z } from 'zod'
import type { Readable } from 'node:stream'
import type {
  internetSpeedtest,
  localSpeedtest,
  speedtestPhase,
} from '../../dto/speedtest.ts'
import type { StopReason } from './lifecycle.ts'
import { randomBytes, randomUUID } from 'node:crypto'
import { Readable as NodeReadable } from 'node:stream'
import { setImmediate as turn } from 'node:timers/promises'
import { netFetch, routeForHost, usesEnvProxy } from '../net/index.ts'
import { cloudflareUsesEnvProxy } from './route.ts'
import { createSeries } from './series.ts'
import { setActiveSpeedtestStop } from './lifecycle.ts'
import { parseRetryAfter } from './retryAfter.ts'
import {
  logSpeedtestFailure,
  providerResponseFacts,
  transportErrorCode,
} from './logDiagnostics.ts'

const MiB = 1024 * 1024
export const limits = {
  localBytes: 64 * 1024 * MiB,
  directionBytes: 64 * 1024 * MiB,
  localRequestBytes: 64 * MiB,
  internetDownloadBytes: 250_000_000,
  internetUploadBytes: 50_000_000,
  requests: 4096,
  localDeadline: 15_000,
  internetDeadline: 30_000,
  transferMs: 10_000,
  leaseMs: 5_000,
}
type Phase = z.infer<typeof speedtestPhase>
type Internet = z.infer<typeof internetSpeedtest>
interface Job {
  id: string
  subject: string
  kind: 'local' | 'internet'
  controller: AbortController
  created: number
  deadline: number
  lease: number
  reason?: StopReason
  timer: ReturnType<typeof setInterval>
  stream?: Readable
  transferDone?: Promise<void>
  abortResponse?: () => void
  requests: number
  reservedBytes: number
  phaseDeadline?: number
  buffer?: Uint8Array
  latencyRequests: number
  done?: Promise<void>
  result?: Internet
  exchange?: Partial<ReturnType<typeof providerResponseFacts>> & {
    operation: 'GET /__down' | 'POST /__up'
    requestBytes: number
  }
}
let active: Job | undefined
let lastFinished:
  { subject: string, result: Internet, expires: number } | undefined
export const speedtestDeps = {
  fetch: netFetch,
  now: () => performance.now(),
  route: routeForHost,
  envProxy: (url: string) => cloudflareUsesEnvProxy(url),
}
function retained() {
  if (lastFinished && speedtestDeps.now() >= lastFinished.expires)
    lastFinished = undefined
  return lastFinished
}
export class SpeedtestError extends Error {
  readonly status: 404 | 409
  constructor(status: 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}
function phase(): Phase {
  return {
    bytesPerSecond: null,
    durationMs: 0,
    payloadBytes: 0,
    confirmedBytes: 0,
    reservedBytes: 0,
    shortened: false,
  }
}
function stop(job: Job, reason: StopReason) {
  if (job.controller.signal.aborted)
    return
  job.reason = reason
  job.controller.abort()
  job.abortResponse?.()
  job.stream?.destroy()
  if (job.kind === 'local' && !job.stream)
    release(job)
}
function release(job: Job) {
  clearInterval(job.timer)
  if (active === job) {
    active = undefined
    setActiveSpeedtestStop(undefined)
  }
}
function create(subject: string, kind: Job['kind']) {
  if (active)
    throw new SpeedtestError(409, 'busy')
  const created = speedtestDeps.now()
  const job: Job = {
    id: randomUUID(),
    subject,
    kind,
    controller: new AbortController(),
    created,
    deadline:
      created
      + (kind === 'local' ? limits.localDeadline : limits.internetDeadline),
    lease: created + limits.leaseMs,
    requests: 0,
    reservedBytes: 0,
    latencyRequests: 0,
    timer: undefined as unknown as Job['timer'],
  }
  active = job // Reserve before any await or network activity.
  setActiveSpeedtestStop((reason, target) => {
    if (
      (!target || target === job.subject)
      && (reason !== 'route_changed' || job.kind === 'internet')
    ) {
      stop(job, reason)
    }
  })
  job.timer = setInterval(() => {
    const now = speedtestDeps.now()
    if (
      now >= job.deadline
      || (job.phaseDeadline !== undefined && now >= job.phaseDeadline)
    ) {
      stop(job, 'deadline')
    }
    else if (kind === 'internet' && now >= job.lease) {
      stop(job, 'lease_expired')
    }
  }, 100)
  job.timer.unref()
  return job
}
function own(id: string, subject: string, kind: Job['kind']) {
  if (
    !active
    || active.id !== id
    || active.subject !== subject
    || active.kind !== kind
  ) {
    throw new SpeedtestError(404, 'not_found')
  }
  if (speedtestDeps.now() >= active.deadline) {
    stop(active, 'deadline')
    throw new SpeedtestError(404, 'expired')
  }
  return active
}
export function startLocal(subject: string): z.infer<typeof localSpeedtest> {
  const job = create(subject, 'local')
  return {
    id: job.id,
    startedAt: new Date().toISOString(),
    deadlineMs: limits.localDeadline,
    durationMs: limits.transferMs,
    maxBytes: limits.localBytes,
    maxRequestBytes: limits.localRequestBytes,
    maxRequests: limits.requests,
  }
}
export function latency(id: string, subject: string) {
  const job = own(id, subject, 'local')
  if (++job.latencyRequests > 6 || job.controller.signal.aborted)
    throw new SpeedtestError(409, 'latency_used')
  return { message: 'ok' }
}
export function download(
  id: string,
  subject: string,
  query: { bytes: number, seq: number },
  abortResponse?: () => void,
) {
  const job = own(id, subject, 'local')
  if (job.controller.signal.aborted || job.stream) {
    throw new SpeedtestError(409, 'download_active')
  }
  if (
    !Number.isInteger(query.bytes)
    || query.bytes <= 0
    || query.bytes > limits.localRequestBytes
    || query.seq !== job.requests
    || job.requests >= limits.requests
    || job.reservedBytes + query.bytes > limits.localBytes
  ) {
    throw new SpeedtestError(409, 'download_limit')
  }
  const now = speedtestDeps.now()
  if (job.phaseDeadline !== undefined && now >= job.phaseDeadline) {
    stop(job, 'deadline')
    throw new SpeedtestError(409, 'phase_expired')
  }
  if (query.seq > 0)
    job.phaseDeadline ??= now + limits.transferMs
  job.reservedBytes += query.bytes
  job.requests++
  job.buffer ??= randomBytes(64 * 1024)
  const buffer = job.buffer
  async function* data() {
    let emitted = 0
    while (!job.controller.signal.aborted && emitted < query.bytes) {
      const count = Math.min(buffer.length, query.bytes - emitted)
      emitted += count
      yield buffer.subarray(0, count)
      if (emitted < query.bytes)
        await turn()
    }
  }
  const stream = NodeReadable.from(data(), {
    highWaterMark: buffer.length,
    objectMode: false,
  })
  let sourceClosed = false
  let responseClosed = abortResponse === undefined
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  job.stream = stream
  job.transferDone = done
  job.abortResponse = abortResponse
  function settle() {
    if (!sourceClosed || !responseClosed)
      return
    if (job.stream === stream) {
      job.stream = undefined
      job.transferDone = undefined
      job.abortResponse = undefined
      if (job.controller.signal.aborted)
        release(job)
    }
    resolveDone()
  }
  stream.once('close', () => {
    sourceClosed = true
    settle()
  })
  return {
    stream,
    complete: () => {
      responseClosed = true
      settle()
    },
    disconnect: () => {
      responseClosed = true
      stop(job, 'cancelled')
      settle()
    },
  }
}
export async function cancel(id: string, subject: string, kind: Job['kind']) {
  if (active?.id === id && active.subject === subject && active.kind === kind) {
    const job = active
    const transferDone = job.transferDone
    stop(job, 'cancelled')
    await transferDone
    await job.done
  }
  // Idempotent, including a late cancel after start returned to a closed screen.
  return { message: 'cancelled' }
}
export function heartbeat(id: string, subject: string) {
  const finished = retained()
  if (finished?.result.id === id && finished.subject === subject)
    return { message: 'finished' }
  const job = own(id, subject, 'internet')
  if (job.controller.signal.aborted || speedtestDeps.now() >= job.lease) {
    stop(job, 'lease_expired')
    throw new SpeedtestError(404, 'expired')
  }
  job.lease = speedtestDeps.now() + limits.leaseMs
  return { message: 'ok' }
}
export function internetStatus(id: string, subject: string) {
  if (active?.id === id && active.subject === subject && active.result)
    return structuredClone(active.result)
  const entry = retained()
  if (!entry || entry.result.id !== id || entry.subject !== subject)
    throw new SpeedtestError(404, 'not_found')
  return structuredClone(entry.result)
}
function fail(kind: StopReason): never {
  throw new Error(kind)
}
const origin = 'https://speed.cloudflare.com'
class ProviderHttpError extends Error {
  readonly status: number
  readonly retryAt: string | undefined
  constructor(status: number, retryAfter: string | null) {
    super('provider_http_error')
    this.status = status
    this.retryAt = status === 429 ? parseRetryAfter(retryAfter) : undefined
  }
}
function validate(response: Response, mime: string) {
  if (!response.ok) {
    throw new ProviderHttpError(
      response.status,
      response.headers.get('retry-after'),
    )
  }
  if (
    response.headers.get('content-encoding')
    || response.headers.get('content-type')?.split(';')[0]?.trim() !== mime
  ) {
    fail('provider_protocol_error')
  }
}
async function request(
  job: Job,
  target: Phase,
  count: number,
  upload: boolean,
  signal: AbortSignal,
  confirmed: boolean,
) {
  if (signal.aborted || job.controller.signal.aborted)
    throw new Error('aborted')
  if (target.reservedBytes + count > limits.directionBytes)
    return false
  target.reservedBytes += count
  const chunk = new Uint8Array(64 * 1024).fill(48)
  let sent = 0
  async function* body() {
    while (sent < count && !signal.aborted) {
      const length = Math.min(chunk.length, count - sent)
      sent += length
      target.payloadBytes += length
      yield chunk.subarray(0, length)
    }
  }
  const init: RequestInit & { duplex?: string } = {
    method: upload ? 'POST' : 'GET',
    signal,
    redirect: 'error',
    headers: {
      'Accept-Encoding': 'identity',
      ...(upload
        ? { 'Content-Type': 'text/plain', 'Content-Length': String(count) }
        : {}),
    },
  }
  if (upload) {
    init.body = body() as unknown as RequestInit['body']
    init.duplex = 'half'
  }
  // Clear the preceding response before fetching: a connection failure must
  // never be attributed the HTTP status of an earlier successful request.
  job.exchange = {
    operation: upload ? 'POST /__up' : 'GET /__down',
    requestBytes: count,
  }
  const response = await speedtestDeps.fetch(
    `${origin}/${upload ? '__up' : '__down'}?bytes=${count}`,
    init,
  )
  try {
    job.exchange = { ...job.exchange, ...providerResponseFacts(response) }
    validate(response, upload ? 'text/plain' : 'application/octet-stream')
    if (!response.body)
      fail('provider_protocol_error')
    const reader = response.body!.getReader()
    let received = 0
    try {
      while (true) {
        const item = await reader.read()
        if (item.done)
          break
        received += item.value.byteLength
        if (!upload)
          target.payloadBytes += item.value.byteLength
        if (received > (upload ? 0 : count))
          fail('provider_protocol_error')
      }
    }
    finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    if (signal.aborted)
      throw new Error('aborted')
    if (
      upload
        ? sent !== count
        || response.headers.get('cf-meta-upload-bytes') !== String(count)
        : received !== count
    ) {
      fail('provider_protocol_error')
    }
    if (confirmed)
      target.confirmedBytes += count
    return true
  }
  finally {
    await response.body?.cancel().catch(() => {})
  }
}
async function run(job: Job) {
  const result = job.result!
  try {
    const times: number[] = []
    for (let i = 0; i < 6; i++) {
      const start = speedtestDeps.now()
      await request(
        job,
        result.download,
        0,
        false,
        job.controller.signal,
        false,
      )
      if (i)
        times.push(speedtestDeps.now() - start)
    }
    result.latencyMs = times.sort((a, b) => a - b)[2]!
    for (const name of ['download', 'upload'] as const) {
      result.phase = name
      const target = result[name]
      // Warmup is bounded by the job deadline; the measured ten seconds start after its EOF/ACK.
      await request(
        job,
        target,
        16 * 1024,
        name === 'upload',
        job.controller.signal,
        false,
      )
      const phaseStarted = speedtestDeps.now()
      const controller = new AbortController()
      const abort = () => controller.abort()
      job.controller.signal.addEventListener('abort', abort, { once: true })
      const series = createSeries(
        name === 'upload'
          ? limits.internetUploadBytes
          : limits.internetDownloadBytes,
        result.latencyMs ?? 0,
        1000,
      )
      let lastTrace = phaseStarted
      const snapshot = (time: number) => {
        if (time <= lastTrace)
          return
        const estimate = series.value
        if (estimate !== null) {
          result.samples.push({
            seconds: (time - phaseStarted) / 1000,
            bytesPerSecond: estimate,
            phase: name,
          })
        }
        target.durationMs = time - phaseStarted
        target.bytesPerSecond = estimate
        lastTrace = time
      }
      const ticker = setInterval(
        () =>
          snapshot(
            Math.min(speedtestDeps.now(), phaseStarted + limits.transferMs),
          ),
        200,
      )
      const timer = setTimeout(() => {
        snapshot(phaseStarted + limits.transferMs)
        abort()
      }, limits.transferMs)
      let sequence = 1
      try {
        while (
          !controller.signal.aborted
          && speedtestDeps.now() - phaseStarted < limits.transferMs
        ) {
          if (sequence >= limits.requests)
            fail('request_limit')
          if (target.reservedBytes >= limits.directionBytes)
            fail('traffic_limit')
          const size = Math.min(
            series.size,
            limits.directionBytes - target.reservedBytes,
          )
          sequence++
          const before = speedtestDeps.now()
          await request(
            job,
            target,
            size,
            name === 'upload',
            controller.signal,
            true,
          )
          const now = speedtestDeps.now()
          if (now - phaseStarted <= limits.transferMs)
            series.observe(size, now - before)
        }
      }
      catch (error) {
        if (!controller.signal.aborted || job.controller.signal.aborted)
          throw error
      }
      finally {
        clearInterval(ticker)
        clearTimeout(timer)
        job.controller.signal.removeEventListener('abort', abort)
        const now = speedtestDeps.now()
        snapshot(Math.min(now, phaseStarted + limits.transferMs))
        target.durationMs = Math.max(0, now - phaseStarted)
      }
      if (job.controller.signal.aborted)
        throw new Error('aborted')
      target.bytesPerSecond = series.value
    }
    result.state = 'complete'
    result.reason = 'complete'
  }
  catch (error) {
    const reason
      = job.reason
        ?? (error instanceof Error
          && [
            'provider_http_error',
            'provider_protocol_error',
            'traffic_limit',
            'request_limit',
          ].includes(error.message)
          ? (error.message as StopReason)
          : 'provider_unavailable')
    result.state = [
      'cancelled',
      'route_changed',
      'revoked',
      'shutdown',
      'lease_expired',
    ].includes(reason)
      ? 'cancelled'
      : 'error'
    result.reason = reason
    if (
      reason === 'provider_http_error'
      && error instanceof ProviderHttpError
    ) {
      result.providerHttpStatus = error.status
      if (error.retryAt !== undefined)
        result.providerRetryAt = error.retryAt
    }
    if (result.state === 'error') {
      logSpeedtestFailure({
        testId: job.id,
        provider: result.provider,
        phase: result.phase,
        reason,
        route: result.route,
        dns: result.dns,
        elapsedMs: Math.max(0, speedtestDeps.now() - job.created),
        downloadBytes: result.download.payloadBytes,
        uploadBytes: result.upload.payloadBytes,
        ...job.exchange,
        transportCode: transportErrorCode(error),
      })
    }
    // Only earlier completed phases retain a numerical result.
    if (result.phase === 'download' || result.phase === 'upload')
      result[result.phase].bytesPerSecond = null
  }
  finally {
    result.phase = 'finished'
    result.finishedAt = new Date().toISOString()
    lastFinished = {
      subject: job.subject,
      result,
      expires: speedtestDeps.now() + 5 * 60_000,
    }
    release(job)
  }
}
export function startInternet(subject: string) {
  const job = create(subject, 'internet')
  try {
    const route = speedtestDeps.route('speed.cloudflare.com')
    const env = usesEnvProxy(route) && !!speedtestDeps.envProxy(origin)
    job.result = {
      id: job.id,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      state: 'running',
      phase: 'latency',
      reason: null,
      provider: 'Cloudflare',
      route: env
        ? 'env_proxy'
        : route.via === 'http'
          ? 'http_proxy'
          : route.via === 'socks5h'
            ? 'socks5_proxy'
            : 'direct',
      dns:
        env || route.via !== 'direct'
          ? 'proxy'
          : route.dns === 'system'
            ? 'system'
            : 'doh',
      latencyMs: null,
      download: phase(),
      upload: phase(),
      samples: [],
    }
    const snapshot = structuredClone(job.result)
    job.done = run(job)
    return snapshot
  }
  catch (error) {
    release(job)
    throw error
  }
}
export async function shutdownSpeedtests() {
  const job = active
  if (!job)
    return
  const transferDone = job.transferDone
  stop(job, 'shutdown')
  await transferDone
  await job.done
}
