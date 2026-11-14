import { once } from 'node:events'
import { Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routesChanged } from '../net/index.ts'
import {
  cancel,
  download,
  heartbeat,
  internetStatus,
  limits,
  shutdownSpeedtests,
  speedtestDeps,
  startInternet,
  startLocal,
} from './index.ts'
import { cloudflareUsesEnvProxy } from './route.ts'
import { stopSpeedtest } from './lifecycle.ts'

const route = {
  id: 'route',
  match: '*',
  via: 'direct' as const,
  dns: 'system' as const,
  dohUrl: null,
  proxyAddress: null,
  proxyUsername: null,
  proxyPassword: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  position: 0,
}
beforeEach(() => {
  vi.spyOn(speedtestDeps, 'route').mockReturnValue(route)
  vi.spyOn(speedtestDeps, 'envProxy').mockReturnValue(false)
})
afterEach(async () => {
  await shutdownSpeedtests()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
function transport(failUpload = false) {
  let now = 0
  let uploads = 0
  vi.spyOn(speedtestDeps, 'now').mockImplementation(() => now)
  return vi
    .spyOn(speedtestDeps, 'fetch')
    .mockImplementation(async (input, init) => {
      expect(new URL(input).origin).toBe('https://speed.cloudflare.com')
      expect(init?.redirect).toBe('error')
      expect(init?.headers).not.toHaveProperty('Cookie')
      const count = Number(new URL(input).searchParams.get('bytes'))
      now += count ? 400 : 10
      if (init?.method === 'POST') {
        uploads++
        let bytes = 0
        for await (const chunk of init.body as unknown as AsyncIterable<Uint8Array>)
          bytes += chunk.length
        expect(bytes).toBe(count)
        return new Response('', {
          headers: {
            'Content-Type': 'text/plain',
            'cf-meta-upload-bytes': String(
              failUpload && uploads > 1 ? bytes - 1 : bytes,
            ),
          },
        })
      }
      return responseFor(count, false)
    })
}
async function finished(id: string) {
  for (let i = 0; i < 500; i++) {
    await new Promise(resolve => setImmediate(resolve))
    const result = internetStatus(id, 'owner')
    if (result.state !== 'running')
      return result
  }
  throw new Error('test did not finish')
}
describe('one active bounded speedtest', () => {
  it('claims synchronously, scopes identity, forbids stream replay and ignores outgoing route changes for local', async () => {
    const local = startLocal('device:a')
    expect(() => startInternet('owner')).toThrow('busy')
    expect(() =>
      download(local.id, 'device:b', { bytes: 16384, seq: 0 }),
    ).toThrow('not_found')
    routesChanged()
    const transfer = download(local.id, 'device:a', { bytes: 16384, seq: 0 })
    expect(() =>
      download(local.id, 'device:a', { bytes: 16384, seq: 0 }),
    ).toThrow('download_active')
    stopSpeedtest('revoked', 'device:b')
    expect(transfer.stream.destroyed).toBe(false)
    stopSpeedtest('revoked', 'device:a')
    await new Promise(resolve => transfer.stream.once('close', resolve))
    const next = startLocal('owner')
    await cancel(next.id, 'owner', 'local')
  })
  it('awaits local stream shutdown before accepting the next start', async () => {
    const local = startLocal('owner')
    const transfer = download(local.id, 'owner', { bytes: 16384, seq: 0 })
    const { stream } = transfer
    const cancelling = cancel(local.id, 'owner', 'local')
    transfer.complete() // A response finish racing cancellation must still await stream close.
    await cancelling
    expect(stream.closed).toBe(true)
    const next = startLocal('owner')
    await cancel(next.id, 'owner', 'local')
  })
  it('keeps the HTTP transfer slot after source EOF until a delayed response finishes', async () => {
    const local = startLocal('owner')
    let flush!: () => void
    const response = new Writable({
      highWaterMark: 65536,
      write(_chunk, _encoding, callback) {
        flush = callback
      },
    })
    const transfer = download(
      local.id,
      'owner',
      { bytes: 16384, seq: 0 },
      () => {
        response.destroy()
      },
    )
    response.once('finish', transfer.complete)
    response.once('close', () => {
      if (!response.writableFinished)
        transfer.disconnect()
    })
    transfer.stream.pipe(response)
    await once(transfer.stream, 'close')
    expect(response.writableFinished).toBe(false)
    expect(() => download(local.id, 'owner', { bytes: 16384, seq: 1 })).toThrow(
      'download_active',
    )
    expect(() => startLocal('other')).toThrow('busy')
    const finished = once(response, 'finish')
    flush()
    await finished
    const next = download(local.id, 'owner', { bytes: 16384, seq: 1 })
    for await (const _chunk of next.stream) {
      /* consume the second finite request */
    }
    await cancel(local.id, 'owner', 'local')
  })
  it('awaits HTTP close as well as Readable close before DELETE releases the global slot', async () => {
    const local = startLocal('owner')
    let closeResponse!: () => void
    const response = new Writable({
      highWaterMark: 65536,
      write() {},
      destroy(_error, callback) {
        closeResponse = callback
      },
    })
    const transfer = download(
      local.id,
      'owner',
      { bytes: 16384, seq: 0 },
      () => {
        response.destroy()
      },
    )
    response.once('close', transfer.disconnect)
    transfer.stream.pipe(response)
    await once(transfer.stream, 'close')
    let cancelled = false
    const cancelling = cancel(local.id, 'owner', 'local').then(() => {
      cancelled = true
    })
    await new Promise(resolve => setImmediate(resolve))
    expect(cancelled).toBe(false)
    expect(() => startLocal('other')).toThrow('busy')
    closeResponse()
    await cancelling
    const next = startLocal('other')
    await cancel(next.id, 'other', 'local')
  })
  it('honors both budgets, warmup and exact upload acknowledgements', async () => {
    const fetcher = transport()
    const initial = startInternet('owner')
    expect(initial.state).toBe('running')
    const result = await finished(initial.id)
    expect(result.state).toBe('complete')
    for (const phase of [result.download, result.upload]) {
      expect(phase.reservedBytes).toBeLessThanOrEqual(limits.directionBytes)
      expect(phase.payloadBytes).toBe(phase.reservedBytes)
      expect(phase.confirmedBytes).toBe(phase.payloadBytes - 16384)
      expect(phase.durationMs).toBeGreaterThan(0)
      expect(phase.bytesPerSecond).toBe(
        ((phase === result.download
          ? limits.internetDownloadBytes
          : limits.internetUploadBytes)
        * 1000)
      / 400,
      )
    }
    expect(fetcher.mock.calls.length).toBeLessThan(100)
    expect(result.latencyMs).toBe(10)
    // The page normally heartbeats before polling; completion must not turn into 404.
    expect(heartbeat(initial.id, 'owner')).toEqual({ message: 'finished' })
    expect(internetStatus(initial.id, 'owner').state).toBe('complete')
    vi.spyOn(speedtestDeps, 'now').mockReturnValue(1_000_000)
    expect(() => internetStatus(initial.id, 'owner')).toThrow('not_found')
    expect(() => heartbeat(initial.id, 'owner')).toThrow('not_found')
  })
  it.each([
    [400, 'text/plain', null, 'provider_http_error'],
    [403, 'text/html', null, 'provider_http_error'],
    [413, 'text/plain', null, 'provider_http_error'],
    [429, 'text/plain', null, 'provider_http_error'],
    [200, 'text/html', null, 'provider_protocol_error'],
    [200, 'application/octet-stream', 'gzip', 'provider_protocol_error'],
  ] as const)(
    'rejects provider status %i and type %s without fallback',
    async (status, mime, encoding, reason) => {
      const headers: Record<string, string> = { 'Content-Type': mime }
      if (encoding)
        headers['Content-Encoding'] = encoding
      const fetcher = vi
        .spyOn(speedtestDeps, 'fetch')
        .mockResolvedValue(new Response('', { status, headers }))
      const initial = startInternet('owner')
      const result = await finished(initial.id)
      expect(result.reason).toBe(reason)
      expect(result.providerHttpStatus).toBe(
        reason === 'provider_http_error' ? status : undefined,
      )
      expect(result.download.bytesPerSecond).toBeNull()
      expect(result.upload.bytesPerSecond).toBeNull()
      expect(fetcher).toHaveBeenCalledTimes(1)
    },
  )
  it('retains the completed download when upload protocol changes', async () => {
    transport(true)
    const initial = startInternet('owner')
    const result = await finished(initial.id)
    expect(result.reason).toBe('provider_protocol_error')
    expect(result.download.bytesPerSecond).toBeGreaterThan(0)
    expect(result.upload.bytesPerSecond).toBeNull()
  })
  it.each([
    ['120', '2026-11-14T10:02:00.000Z'],
    ['Sat, 14 Nov 2026 10:02:00 GMT', '2026-11-14T10:02:00.000Z'],
    [null, undefined],
    ['-1', undefined],
    ['999999999999999999999', undefined],
  ])(
    'projects safe 429 Retry-After %s without retrying',
    async (retryAfter, expected) => {
      vi.spyOn(Date, 'now').mockReturnValue(
        Date.parse('2026-11-14T10:00:00.000Z'),
      )
      const headers = new Headers({ 'Content-Type': 'text/plain' })
      if (retryAfter !== null)
        headers.set('Retry-After', retryAfter)
      const fetcher = vi
        .spyOn(speedtestDeps, 'fetch')
        .mockResolvedValue(new Response('', { status: 429, headers }))
      const initial = startInternet('owner')
      const result = await finished(initial.id)
      expect(result.reason).toBe('provider_http_error')
      expect(result.providerHttpStatus).toBe(429)
      expect(result.providerRetryAt).toBe(expected)
      expect(fetcher).toHaveBeenCalledTimes(1)
    },
  )
  it('does not expose Retry-After as a provider limit on a successful response', async () => {
    vi.spyOn(speedtestDeps, 'fetch').mockResolvedValue(
      new Response('', {
        headers: { 'Content-Type': 'text/html', 'Retry-After': '120' },
      }),
    )
    const initial = startInternet('owner')
    const result = await finished(initial.id)
    expect(result.reason).toBe('provider_protocol_error')
    expect(result.providerHttpStatus).toBeUndefined()
    expect(result.providerRetryAt).toBeUndefined()
  })
  it('aborts a pending fetch on cancellation and releases only after shutdown', async () => {
    vi.spyOn(speedtestDeps, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            setImmediate(() => reject(new Error('aborted')))),
        ),
    )
    const initial = startInternet('owner')
    const pending = cancel(initial.id, 'owner', 'internet')
    expect(() => startLocal('other')).toThrow('busy')
    await pending
    expect(internetStatus(initial.id, 'owner').state).toBe('cancelled')
    const next = startLocal('other')
    await cancel(next.id, 'other', 'local')
  })
  it('does not revive a lease with a late heartbeat', async () => {
    vi.spyOn(speedtestDeps, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))),
        ),
    )
    let now = 0
    vi.spyOn(speedtestDeps, 'now').mockImplementation(() => now)
    const initial = startInternet('owner')
    now = limits.leaseMs + 1
    expect(() => heartbeat(initial.id, 'owner')).toThrow('expired')
    await finished(initial.id)
    expect(internetStatus(initial.id, 'owner').reason).toBe('lease_expired')
  })
  it('enforces deadline while fetch is pending without heartbeat or UI activity', async () => {
    const original = limits.internetDeadline
    limits.internetDeadline = 20
    try {
      vi.spyOn(speedtestDeps, 'fetch').mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted'))),
          ),
      )
      const initial = startInternet('owner')
      await new Promise(resolve => setTimeout(resolve, 130))
      expect(internetStatus(initial.id, 'owner').reason).toBe('deadline')
      const local = startLocal('next')
      await cancel(local.id, 'next', 'local')
    }
    finally {
      limits.internetDeadline = original
    }
  })
  it('labels the HTTPS environment route with NO_PROXY exceptions', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example:3128')
    vi.stubEnv('https_proxy', undefined)
    vi.stubEnv('NO_PROXY', '*.cloudflare.com:443')
    vi.stubEnv('no_proxy', undefined)
    expect(cloudflareUsesEnvProxy('https://speed.cloudflare.com')).toBe(false)
    vi.stubEnv('NO_PROXY', '*.cloudflare.com:80')
    expect(cloudflareUsesEnvProxy('https://speed.cloudflare.com')).toBe(true)
    vi.stubEnv('HTTPS_PROXY', '')
    vi.stubEnv('HTTP_PROXY', 'http://proxy.example:3128')
    expect(cloudflareUsesEnvProxy('https://speed.cloudflare.com')).toBe(true)
    vi.stubEnv('NO_PROXY', '*')
    expect(cloudflareUsesEnvProxy('https://speed.cloudflare.com')).toBe(false)
  })
})

function phaseClock() {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'performance',
    ],
  })
  const previous = limits.leaseMs
  limits.leaseMs = 60_000
  return () => {
    limits.leaseMs = previous
  }
}
function responseFor(count: number, upload: boolean) {
  let remaining = count
  const chunk = new Uint8Array(65536)
  return upload
    ? new Response('', {
        headers: {
          'Content-Type': 'text/plain',
          'cf-meta-upload-bytes': String(count),
        },
      })
    : new Response(
        new ReadableStream({
          pull(controller) {
            if (!remaining) {
              controller.close()
              return
            }
            const size = Math.min(chunk.length, remaining)
            remaining -= size
            controller.enqueue(chunk.subarray(0, size))
          },
        }),
        { headers: { 'Content-Type': 'application/octet-stream' } },
      )
}
async function waitForTransfer(
  ms: number,
  signal: AbortSignal | null | undefined,
) {
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const abort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
describe('adaptive phases and finite local transfers', () => {
  it.each([
    [64_000, 0],
    [1_250_000_000, 200],
    [125_000_000, 93],
  ])(
    'adapts a %i bytes/s provider channel with %i ms RTT',
    async (rate, latency) => {
      const restoreLease = phaseClock()
      const sizes: number[] = []
      vi.spyOn(speedtestDeps, 'fetch').mockImplementation(
        async (input, init) => {
          const count = Number(new URL(input).searchParams.get('bytes'))
          const upload = init?.method === 'POST'
          if (upload) {
            for await (const _chunk of init.body as unknown as AsyncIterable<Uint8Array>) {
              /* bounded upload */
            }
          }
          if (count)
            sizes.push(count)
          await waitForTransfer(latency + (count / rate) * 1000, init?.signal)
          return responseFor(count, upload)
        },
      )
      try {
        const initial = startInternet('owner')
        await vi.advanceTimersByTimeAsync(25_000)
        const result = internetStatus(initial.id, 'owner')
        expect(result.state).toBe('complete')
        for (const target of [result.download, result.upload]) {
          expect(target.bytesPerSecond).toBeGreaterThan(0)
          expect(target.bytesPerSecond).toBeLessThanOrEqual(rate * 1.01)
          expect(target.reservedBytes).toBeLessThanOrEqual(
            limits.directionBytes,
          )
          expect(target.durationMs).toBe(10000)
        }
        expect(
          result.samples
            .filter(p => p.phase === 'upload')
            .every(p => p.seconds <= 10),
        ).toBe(true)
        if (rate === 125_000_000 && latency === 93) {
          expect(
            (result.download.bytesPerSecond! * 8) / 1_000_000,
          ).toBeGreaterThan(900)
          expect(
            (result.download.bytesPerSecond! * 8) / 1_000_000,
          ).toBeLessThan(930)
          expect(
            (result.upload.bytesPerSecond! * 8) / 1_000_000,
          ).toBeGreaterThan(800)
          expect((result.upload.bytesPerSecond! * 8) / 1_000_000).toBeLessThan(
            825,
          )
        }
        expect(sizes[0]).toBe(16384)
        if (latency)
          expect(Math.max(...sizes)).toBeGreaterThan(8 * 1024 * 1024)
        else expect(result.download.bytesPerSecond! / rate).toBeCloseTo(1, 2)
      }
      finally {
        restoreLease()
      }
    },
  )
  it('keeps a continuous provider payload moving through both complete ten-second timelines', async () => {
    const restoreLease = phaseClock()
    const rate = 1024 * 1024
    vi.spyOn(speedtestDeps, 'fetch').mockImplementation(async (input, init) => {
      const count = Number(new URL(input).searchParams.get('bytes'))
      const upload = init?.method === 'POST'
      if (upload) {
        for await (const chunk of init.body as unknown as AsyncIterable<Uint8Array>)
          await waitForTransfer((chunk.byteLength / rate) * 1000, init?.signal)
        return responseFor(count, true)
      }
      let remaining = count
      const chunk = new Uint8Array(65536)
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (!remaining) {
              controller.close()
              return
            }
            const size = Math.min(chunk.length, remaining)
            await waitForTransfer((size / rate) * 1000, init?.signal)
            remaining -= size
            controller.enqueue(chunk.subarray(0, size))
          },
        }),
        { headers: { 'Content-Type': 'application/octet-stream' } },
      )
    })
    try {
      const initial = startInternet('owner')
      await vi.advanceTimersByTimeAsync(21_000)
      const result = internetStatus(initial.id, 'owner')
      expect(result.state).toBe('complete')
      for (const direction of ['download', 'upload'] as const) {
        const trace = result.samples.filter(
          point => point.phase === direction,
        )
        expect(trace.length).toBeGreaterThan(0)
        expect(trace.length).toBeLessThanOrEqual(50)
        expect(trace.at(-1)?.seconds).toBe(10)
        expect(trace.at(-1)?.bytesPerSecond).toBe(
          result[direction].bytesPerSecond,
        )
        expect(
          trace
            .filter(point => point.seconds >= 1)
            .every(point => point.bytesPerSecond > rate * 0.8),
        ).toBe(true)
        expect(result[direction].durationMs).toBe(10000)
        expect(result[direction].payloadBytes).toBeGreaterThan(rate * 9)
        expect(result[direction].bytesPerSecond).toBeGreaterThan(rate * 0.8)
      }
    }
    finally {
      restoreLease()
    }
  })
  it('keeps the confirmed upload estimate during ACK waits and recomputes it on the next ACK', async () => {
    const restoreLease = phaseClock()
    let uploads = 0
    vi.spyOn(speedtestDeps, 'fetch').mockImplementation(async (input, init) => {
      const count = Number(new URL(input).searchParams.get('bytes'))
      const upload = init?.method === 'POST'
      if (upload) {
        for await (const _chunk of init.body as unknown as AsyncIterable<Uint8Array>) {
          /* yield bounded payload */
        }
        uploads++
        await waitForTransfer(
          uploads <= 4 ? 100 : uploads === 5 ? 2000 : 60_000,
          init?.signal,
        )
      }
      else if (count) {
        await waitForTransfer(400, init?.signal)
      }
      return responseFor(count, upload)
    })
    try {
      const initial = startInternet('owner')
      await vi.advanceTimersByTimeAsync(11_500)
      const waiting = internetStatus(initial.id, 'owner')
      expect(waiting.phase).toBe('upload')
      expect(waiting.upload.bytesPerSecond).toBeGreaterThan(0)
      const previous = waiting.upload.bytesPerSecond
      await vi.advanceTimersByTimeAsync(2000)
      const acknowledged = internetStatus(initial.id, 'owner')
      expect(acknowledged.upload.bytesPerSecond).not.toBe(previous)
      expect(acknowledged.upload.bytesPerSecond).toBeGreaterThan(0)
      await vi.advanceTimersByTimeAsync(8000)
      const final = internetStatus(initial.id, 'owner')
      expect(final.state).toBe('complete')
      expect(final.upload.durationMs).toBe(10000)
      const points = final.samples.filter(point => point.phase === 'upload')
      expect(points.every(point => point.bytesPerSecond > 0)).toBe(true)
      expect(points.at(-1)).toEqual({
        phase: 'upload',
        seconds: 10,
        bytesPerSecond: final.upload.bytesPerSecond,
      })
    }
    finally {
      restoreLease()
    }
  })
  it('publishes provisional p90 after three valid samples while the phase is still running', async () => {
    const restoreLease = phaseClock()
    let transfers = 0
    vi.spyOn(speedtestDeps, 'fetch').mockImplementation(async (input, init) => {
      const count = Number(new URL(input).searchParams.get('bytes'))
      if (count)
        await waitForTransfer(++transfers <= 4 ? 100 : 60_000, init?.signal)
      return responseFor(count, false)
    })
    try {
      const initial = startInternet('owner')
      await vi.advanceTimersByTimeAsync(550)
      const progress = internetStatus(initial.id, 'owner')
      expect(progress.state).toBe('running')
      expect(progress.phase).toBe('download')
      expect(progress.samples.length).toBeGreaterThanOrEqual(1)
      expect(progress.download.bytesPerSecond).toBeGreaterThan(0)
      await cancel(initial.id, 'owner', 'internet')
      expect(
        internetStatus(initial.id, 'owner').download.bytesPerSecond,
      ).toBeNull()
    }
    finally {
      restoreLease()
    }
  })
  it('leaves one confirmed sample followed by a stall insufficient', async () => {
    const restoreLease = phaseClock()
    const requests = { download: 0, upload: 0 }
    vi.spyOn(speedtestDeps, 'fetch').mockImplementation(async (input, init) => {
      const count = Number(new URL(input).searchParams.get('bytes'))
      const upload = init?.method === 'POST'
      const direction = upload ? 'upload' : 'download'
      if (upload) {
        for await (const _chunk of init.body as unknown as AsyncIterable<Uint8Array>) {
          /* bounded upload */
        }
      }
      if (count) {
        await waitForTransfer(
          ++requests[direction] <= 2 ? 100 : 60_000,
          init?.signal,
        )
      }
      return responseFor(count, upload)
    })
    try {
      const initial = startInternet('owner')
      await vi.advanceTimersByTimeAsync(21_000)
      const result = internetStatus(initial.id, 'owner')
      expect(result.state).toBe('complete')
      for (const direction of ['download', 'upload'] as const) {
        const trace = result.samples.filter(
          point => point.phase === direction,
        )
        expect(trace).toEqual([])
      }
      for (const target of [result.download, result.upload]) {
        expect(target.confirmedBytes).toBe(16384)
        expect(target.durationMs).toBe(10000)
        expect(target.bytesPerSecond).toBeNull()
      }
    }
    finally {
      restoreLease()
    }
  })
  it('bounds a stalled warmup by the global job deadline without inventing a measured phase', async () => {
    const restoreLease = phaseClock()
    const fetcher = vi
      .spyOn(speedtestDeps, 'fetch')
      .mockImplementation(async (input, init) => {
        const count = Number(new URL(input).searchParams.get('bytes'))
        if (count)
          await waitForTransfer(60_000, init?.signal)
        return responseFor(count, init?.method === 'POST')
      })
    try {
      const initial = startInternet('owner')
      await vi.advanceTimersByTimeAsync(30_050)
      const result = internetStatus(initial.id, 'owner')
      expect(result.state).toBe('error')
      expect(result.reason).toBe('deadline')
      expect(fetcher).toHaveBeenCalledTimes(7)
      expect(result.samples).toHaveLength(0)
      expect(result.download.bytesPerSecond).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    }
    finally {
      restoreLease()
    }
  })
  it.each(['traffic_limit', 'request_limit'] as const)(
    'reports emergency %s before ten seconds as error even with sufficient completed samples',
    async (reason) => {
      const bytes = limits.directionBytes
      const requests = limits.requests
      if (reason === 'traffic_limit')
        limits.directionBytes = 65536
      else limits.requests = 4
      try {
        transport()
        const initial = startInternet('owner')
        const result = await finished(initial.id)
        expect(result.state).toBe('error')
        expect(result.reason).toBe(reason)
        expect(result.providerHttpStatus).toBeUndefined()
        expect(result.download.durationMs).toBeLessThan(10000)
        expect(result.download.bytesPerSecond).toBeNull()
        expect(result.download.confirmedBytes).toBeGreaterThan(0)
      }
      finally {
        limits.directionBytes = bytes
        limits.requests = requests
      }
    },
  )
  it('reserves local budgets synchronously and rejects overlap, replay and request exhaustion', async () => {
    const previous = limits.requests
    limits.requests = 2
    try {
      const local = startLocal('owner')
      const first = download(local.id, 'owner', { bytes: 16384, seq: 0 })
      expect(() =>
        download(local.id, 'owner', { bytes: 16384, seq: 1 }),
      ).toThrow('download_active')
      for await (const _chunk of first.stream) {
        /* consume finite response */
      }
      expect(() =>
        download(local.id, 'owner', { bytes: 16384, seq: 0 }),
      ).toThrow('download_limit')
      const second = download(local.id, 'owner', { bytes: 16384, seq: 1 })
      for await (const _chunk of second.stream) {
        /* consume finite response */
      }
      expect(() => startLocal('other')).toThrow('busy')
      expect(() =>
        download(local.id, 'owner', { bytes: 16384, seq: 2 }),
      ).toThrow('download_limit')
      await cancel(local.id, 'owner', 'local')
      const next = startLocal('other')
      await cancel(next.id, 'other', 'local')
    }
    finally {
      limits.requests = previous
    }
  })
  it('cannot reset the local phase deadline between finite responses', async () => {
    let now = 0
    vi.spyOn(speedtestDeps, 'now').mockImplementation(() => now)
    const local = startLocal('owner')
    const first = download(local.id, 'owner', { bytes: 16384, seq: 0 })
    for await (const _chunk of first.stream) {
      /* consume finite response */
    }
    now = 500
    const measured = download(local.id, 'owner', { bytes: 16384, seq: 1 })
    for await (const _chunk of measured.stream) {
      /* consume measured response */
    }
    now = 10501
    expect(() => download(local.id, 'owner', { bytes: 16384, seq: 2 })).toThrow(
      'phase_expired',
    )
  })
})
