import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  closeLogFiles,
  createLogger,
  installLogger,
  queryLogs,
} from '../logs/index.ts'
import { projectRecord, projectRingEntry } from '../logs/reportProjection.ts'
import { LOG_RETENTION_MS } from '../logs/ring.ts'
import {
  cancel,
  internetStatus,
  shutdownSpeedtests,
  speedtestDeps,
  startInternet,
} from './index.ts'
import { providerResponseFacts, transportErrorCode } from './logDiagnostics.ts'

const marker = 'PRIVATE_SPEEDTEST_MARKER'
const ray = '9a0123456789abcd-AMS'
let dir: string
let stdout: string[]
function events() {
  return queryLogs({ sources: ['network'], q: 'speedtest.failed' }).entries
}
async function finished(id: string) {
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setImmediate(resolve))
    const state = internetStatus(id, marker)
    if (state.state !== 'running')
      return state
  }
  throw new Error('test did not finish')
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torsher-speedtest-logs-'))
  stdout = []
  installLogger(
    createLogger({
      level: 'info',
      logsDir: dir,
      stdout: { write: line => stdout.push(line) },
    }),
  )
  vi.spyOn(speedtestDeps, 'route').mockReturnValue({
    id: marker,
    match: '*',
    via: 'http',
    dns: 'system',
    dohUrl: null,
    proxyAddress: `http://${marker}:1234`,
    proxyUsername: marker,
    proxyPassword: marker,
    updatedAt: new Date(),
    position: 0,
  })
  vi.spyOn(speedtestDeps, 'envProxy').mockReturnValue(false)
})
afterEach(async () => {
  await shutdownSpeedtests()
  await closeLogFiles()
  installLogger(pino({ level: 'silent' }))
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})
it.each([403, 429])(
  'records a single HTTP %i failure in stdout, journal, disk and safe report without raw provider data',
  async (status) => {
    const retryAfter = new Date(Date.now() + 120_000).toUTCString()
    const headers = {
      'Server': 'cloudflare',
      'Content-Type': 'text/html; charset=utf-8',
      'CF-Ray': ray,
      'CF-Mitigated': 'challenge',
      'CF-Error-Type': '1015',
      'Retry-After': retryAfter,
      'Via': `1.1 ${marker}`,
      'Set-Cookie': `session=${marker}`,
      'Authorization': `Bearer ${marker}`,
      'X-Request-ID': marker,
      'Location': `https://example.test/?token=${marker}`,
    }
    const response = new Response(marker, { status, headers })
    const readBody = vi.spyOn(response, 'text')
    const fetcher = vi
      .spyOn(speedtestDeps, 'fetch')
      .mockResolvedValue(response)
    const test = startInternet(marker)
    const result = await finished(test.id)
    expect(result.providerHttpStatus).toBe(status)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(readBody).not.toHaveBeenCalled()
    expect(response.bodyUsed).toBe(true) // cancelled rather than parsed or logged
    const records = events()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      level: 'warn',
      source: 'network',
      context: {
        event: 'speedtest.failed',
        origin: 'server',
        testId: test.id,
        provider: 'Cloudflare',
        phase: 'latency',
        reason: 'provider_http_error',
        route: 'http_proxy',
        dns: 'proxy',
        statusCode: status,
        operation: 'GET /__down',
        requestBytes: 0,
        responseServer: 'cloudflare',
        responseType: 'text/html',
        cfRay: ray,
        cfMitigated: 'challenge',
        cfErrorType: '1015',
        providerRetryAt: new Date(retryAfter).toISOString(),
        viaPresent: true,
      },
    })
    expect(JSON.stringify(records)).not.toContain(marker)
    expect(stdout.join('')).not.toContain(marker)
    const projection = projectRingEntry(
      records[0]!,
      Date.now(),
      LOG_RETENTION_MS,
    )
    expect(projection).toMatchObject({
      kind: 'event',
      value: {
        event: 'speedtest.failed',
        facts: { testId: test.id, statusCode: status, cfRay: ray },
      },
    })
    await closeLogFiles()
    const disk = readFileSync(join(dir, 'torsher.log'), 'utf8')
    expect(disk).not.toContain(marker)
    const raw = JSON.parse(disk.trim())
    expect(projectRecord(raw, Date.now(), LOG_RETENTION_MS)).toEqual(
      projection,
    )
    expect(
      JSON.stringify(
        projectRecord(
          {
            ...raw,
            headers,
            details: marker,
            err: marker,
            subject: marker,
          },
          Date.now(),
          LOG_RETENTION_MS,
        ),
      ),
    ).not.toContain(marker)
    expect(
      projectRecord({ ...raw, source: 'client' }, Date.now(), LOG_RETENTION_MS)
        .kind,
    ).toBe('unstructured')
  },
)
it('records the download phase and does not reuse a preceding HTTP response for a transport failure', async () => {
  let requests = 0
  vi.spyOn(speedtestDeps, 'fetch').mockImplementation(async () => {
    // Six latency requests complete, then the download warmup cannot connect.
    if (++requests === 7) {
      throw new Error(marker, {
        cause: Object.assign(new Error(marker), { code: 'ECONNRESET' }),
      })
    }
    return new Response('', {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Server': 'cloudflare',
        'CF-Ray': ray,
      },
    })
  })
  const test = startInternet(marker)
  await finished(test.id)
  expect(events()).toHaveLength(1)
  const context = events()[0]!.context!
  expect(context).toMatchObject({
    phase: 'download',
    reason: 'provider_unavailable',
    operation: 'GET /__down',
    requestBytes: 16384,
    transportCode: 'ECONNRESET',
  })
  expect(context.statusCode).toBeUndefined()
  expect(context.cfRay).toBeUndefined()
  expect(stdout.join('')).not.toContain(marker)
})
it('records an unexpected successful HTML response as a protocol error with its response metadata', async () => {
  vi.spyOn(speedtestDeps, 'fetch').mockResolvedValue(
    new Response(marker, {
      headers: {
        'Content-Type': 'text/html',
        'CF-Mitigated': 'challenge',
      },
    }),
  )
  const test = startInternet(marker)
  await finished(test.id)
  expect(events()[0]?.context).toMatchObject({
    reason: 'provider_protocol_error',
    statusCode: 200,
    responseType: 'text/html',
    cfMitigated: 'challenge',
  })
})
it('does not warn on a manual stop and does not log every response', async () => {
  let requests = 0
  vi.spyOn(speedtestDeps, 'fetch').mockImplementation(async (_url, init) => {
    if (++requests < 7) {
      return new Response('', {
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    }
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error(marker)))
    })
  })
  const test = startInternet(marker)
  for (let attempt = 0; attempt < 100; attempt++) {
    if (requests >= 7)
      break
    await new Promise(resolve => setImmediate(resolve))
  }
  expect(requests).toBe(7)
  expect(events()).toEqual([])
  await cancel(test.id, marker, 'internet')
  expect(events()).toEqual([])
})
it('drops malformed or private header values and bounds recursive error inspection', () => {
  expect(
    providerResponseFacts(
      new Response('', {
        status: 403,
        headers: {
          'Server': `nginx/${marker}`,
          'Content-Type': marker,
          'CF-Ray': marker,
          'CF-Mitigated': marker,
          'CF-Error-Type': marker,
          'Retry-After': marker,
          'Via': marker,
        },
      }),
    ),
  ).toMatchObject({
    statusCode: 403,
    responseServer: 'other',
    responseType: 'other',
    cfRay: undefined,
    cfMitigated: undefined,
    cfErrorType: undefined,
    providerRetryAt: undefined,
    viaPresent: true,
  })
  const error = { code: marker, cause: undefined as unknown }
  error.cause = error
  expect(transportErrorCode(error)).toBeUndefined()
  expect(transportErrorCode({ code: 'ETIMEDOUT', message: marker })).toBe(
    'ETIMEDOUT',
  )
})

it('does not warn on a completed successful test', async () => {
  let now = 0
  vi.spyOn(speedtestDeps, 'now').mockImplementation(() => now)
  vi.spyOn(speedtestDeps, 'fetch').mockImplementation(async (input, init) => {
    const bytes = Number(new URL(input).searchParams.get('bytes'))
    now += bytes ? 2000 : 10
    if (init?.method === 'POST') {
      for await (const _chunk of init.body as unknown as AsyncIterable<Uint8Array>) {
        // Consume the synthetic upload, just as a provider would.
      }
      return new Response('', {
        headers: {
          'Content-Type': 'text/plain',
          'cf-meta-upload-bytes': String(bytes),
        },
      })
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    })
  })
  const test = startInternet(marker)
  const result = await finished(test.id)
  expect(result.state).toBe('complete')
  expect(result.download.bytesPerSecond).toBeGreaterThan(0)
  expect(result.upload.bytesPerSecond).toBeGreaterThan(0)
  expect(events()).toEqual([])
  expect(stdout).toEqual([])
})
