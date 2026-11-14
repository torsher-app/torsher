import type { LocalSpeedtest } from './generated'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalSpeedtest, readLocalSpeedtest } from './speedtest'

const session: LocalSpeedtest = {
  id: '00000000-0000-4000-8000-000000000001',
  startedAt: '2026-01-01T00:00:00Z',
  maxBytes: 68719476736,
  maxRequestBytes: 67108864,
  maxRequests: 4096,
  durationMs: 10000,
  deadlineMs: 15000,
}
function channel(rate: number, latency = 0) {
  let now = 0
  const sizes: number[] = []
  let reads = 0
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), 'http://local')
    if (url.pathname.endsWith('/latency')) {
      now += latency
      return new Response('{}', {
        headers: { 'X-Torsher-Speedtest-Id': session.id },
      })
    }
    const bytes = Number(url.searchParams.get('bytes'))
    sizes.push(bytes)
    now += latency
    let emitted = 0
    const buffer = new Uint8Array(65536)
    const reader = {
      async read() {
        reads++
        if (emitted === bytes)
          return { done: true, value: undefined }
        const count = Math.min(65536, bytes - emitted)
        emitted += count
        now += (count / rate) * 1000
        return { done: false, value: buffer.subarray(0, count) }
      },
      async cancel() {},
      releaseLock() {},
    }
    return {
      ok: true,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'X-Torsher-Speedtest-Id': session.id,
        'X-Torsher-Speedtest-Seq': url.searchParams.get('seq')!,
        'X-Torsher-Speedtest-Bytes': String(bytes),
      }),
      body: { getReader: () => reader, async cancel() {} },
    } as unknown as Response
  })
  return {
    fetch: fetcher,
    now: () => now,
    sizes,
    get reads() {
      return reads
    },
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
describe('bounded raw adaptive measurement', () => {
  it.each([1_250_000, 1_250_000_000, 64_000])(
    'measures a controlled %i bytes/s channel without whole-body buffering',
    async (rate) => {
      const capped = channel(rate)
      const result = await readLocalSpeedtest(
        session,
        new AbortController().signal,
        () => {},
        capped,
      )
      expect(result.bytesPerSecond).toBeCloseTo(rate, 0)
      expect(result.samples.length).toBeGreaterThanOrEqual(1)
      expect(result.payloadBytes).toBeLessThanOrEqual(session.maxBytes)
      expect(capped.sizes.length).toBeLessThanOrEqual(4096)
      expect(capped.reads).toBeGreaterThan(capped.sizes.length)
      if (rate > 1_000_000_000) {
        expect(result.durationMs).toBeGreaterThanOrEqual(10000)
        expect(result.bytesPerSecond).not.toBeNull()
      }
    },
  )
  it('uses HTTP duration including a high RTT while the planner grows to a suitable size', async () => {
    const capped = channel(1_250_000_000, 200)
    const result = await readLocalSpeedtest(
      session,
      new AbortController().signal,
      () => {},
      capped,
    )
    expect(capped.sizes).toContain(67108864)
    expect(result.latencyMs).toBe(200)
    expect(result.bytesPerSecond).toBeLessThan(1_250_000_000)
    expect(result.samples.length).toBeGreaterThanOrEqual(1)
  })
  it('treats an emergency byte ceiling before ten seconds as incomplete instead of successful', async () => {
    const capped = channel(1_250_000_000)
    await expect(
      readLocalSpeedtest(
        { ...session, maxBytes: 1_000_000 },
        new AbortController().signal,
        () => {},
        capped,
      ),
    ).rejects.toMatchObject({ kind: 'limit_reached' })
  })
  it('treats a request safety ceiling before ten seconds as incomplete', async () => {
    const capped = channel(1_250_000_000)
    await expect(
      readLocalSpeedtest(
        { ...session, maxRequests: 3 },
        new AbortController().signal,
        () => {},
        capped,
      ),
    ).rejects.toMatchObject({ kind: 'limit_reached' })
    expect(capped.sizes).toHaveLength(3)
  })
  it('rejects compression or mismatched echoes without retry', async () => {
    const capped = channel(1000000)
    const raw = vi.fn<typeof fetch>(async (input, init) => {
      const response = await capped.fetch(input, init)
      if (String(input).includes('/download'))
        response.headers.set('X-Torsher-Speedtest-Seq', '99')
      return response
    })
    await expect(
      readLocalSpeedtest(session, new AbortController().signal, () => {}, {
        ...capped,
        fetch: raw,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' })
    expect(raw).toHaveBeenCalledTimes(7)
  })
  it('does not report zero or a singleton after warmup/sample followed by a stall', async () => {
    vi.useFakeTimers()
    const capped = channel(1000000)
    let transfers = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        if (!String(input).includes('/download') || ++transfers <= 2)
          return capped.fetch(input, init)
        return new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))),
        )
      }),
    )
    const update = vi.fn()
    const runner = createLocalSpeedtest({
      start: async () => ({ ...session, durationMs: 50 }),
      cancel: vi.fn(async () => {}),
      update,
      errorStatus: () => undefined,
    })
    const pending = runner.start()
    await vi.advanceTimersByTimeAsync(60)
    await pending
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'insufficient',
      result: { bytesPerSecond: null, samples: [] },
    })
  })
  it('defers generated cleanup/refresh after raw401 until the next manual start', async () => {
    const events: string[] = []
    const start = vi.fn(async () => {
      events.push('start')
      return session
    })
    const cancel = vi.fn(async () => {
      events.push('cleanup-refresh')
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('', { status: 401 })),
    )
    const update = vi.fn()
    const runner = createLocalSpeedtest({
      start,
      cancel,
      update,
      errorStatus: () => undefined,
    })
    await runner.start()
    expect(update.mock.calls.at(-1)?.[0].error).toBe('unauthorized')
    expect(cancel).not.toHaveBeenCalled()
    await runner.start()
    expect(events).toEqual(['start', 'cleanup-refresh', 'start'])
  })
  it('returns unsupported before constructing missing APIs', async () => {
    vi.stubGlobal('AbortController', undefined)
    const update = vi.fn()
    const start = vi.fn()
    await createLocalSpeedtest({
      start,
      cancel: vi.fn(),
      update,
      errorStatus: () => undefined,
    }).start()
    expect(start).not.toHaveBeenCalled()
    expect(update.mock.calls.at(-1)?.[0].error).toBe('unsupported')
  })
  it('releases late start IDs without updating a cancelled generation', async () => {
    let resolve!: (value: LocalSpeedtest) => void
    const cancel = vi.fn(async () => {})
    const update = vi.fn()
    const runner = createLocalSpeedtest({
      start: () =>
        new Promise((done) => {
          resolve = done
        }),
      cancel,
      update,
      errorStatus: () => undefined,
    })
    const pending = runner.start()
    runner.stop()
    resolve(session)
    await pending
    expect(cancel).toHaveBeenCalledWith(session.id)
    expect(update.mock.calls.at(-1)?.[0].status).toBe('cancelled')
  })
})
it('runs local requests for ten seconds while the graph uses the same confirmed estimate as the number', async () => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'performance',
    ],
  })
  const raw = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), 'http://local')
    if (url.pathname.endsWith('/latency')) {
      return new Response('{}', {
        headers: { 'X-Torsher-Speedtest-Id': session.id },
      })
    }
    const bytes = Number(url.searchParams.get('bytes'))
    let emitted = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending:
      ((value: { done: boolean, value?: Uint8Array }) => void) | undefined
    const chunk = new Uint8Array(16384)
    const reader = {
      async read() {
        if (emitted === bytes)
          return { done: true, value: undefined }
        return new Promise<{ done: boolean, value?: Uint8Array }>((resolve) => {
          pending = resolve
          timer = setTimeout(() => {
            const count = Math.min(chunk.length, bytes - emitted)
            emitted += count
            pending = undefined
            resolve({ done: false, value: chunk.subarray(0, count) })
          }, 10)
        })
      },
      async cancel() {
        clearTimeout(timer)
        pending?.({ done: true })
        pending = undefined
      },
      releaseLock() {},
    }
    return {
      ok: true,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'X-Torsher-Speedtest-Id': session.id,
        'X-Torsher-Speedtest-Seq': url.searchParams.get('seq')!,
        'X-Torsher-Speedtest-Bytes': String(bytes),
      }),
      body: { getReader: () => reader, async cancel() {} },
    } as unknown as Response
  })
  const pending = readLocalSpeedtest(
    session,
    new AbortController().signal,
    () => {},
    { fetch: raw },
  )
  await vi.advanceTimersByTimeAsync(10_100)
  const result = await pending
  expect(result.durationMs).toBe(10_000)
  expect(result.payloadBytes).toBeGreaterThan(1_500_000 * 9)
  expect(result.samples.length).toBeGreaterThan(0)
  expect(result.samples.length).toBeLessThanOrEqual(50)
  expect(result.samples.at(-1)?.seconds).toBe(10)
  expect(result.samples.at(-1)?.bytesPerSecond).toBe(result.bytesPerSecond)
  expect(
    result.samples
      .filter(point => point.seconds > 1)
      .every(point => point.bytesPerSecond > 1_000_000),
  ).toBe(true)
  expect(result.bytesPerSecond).toBeGreaterThan(1_000_000)
  expect(vi.getTimerCount()).toBe(0)
})

it('freezes the last local snapshot on Stop until the next Start clears it', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), 'http://local')
      const headers = new Headers({ 'X-Torsher-Speedtest-Id': session.id })
      if (url.pathname.endsWith('/latency'))
        return new Response('{}', { headers })
      let remaining = Number(url.searchParams.get('bytes'))
      headers.set('Content-Type', 'application/octet-stream')
      headers.set('X-Torsher-Speedtest-Seq', url.searchParams.get('seq')!)
      headers.set('X-Torsher-Speedtest-Bytes', String(remaining))
      let timer: ReturnType<typeof setTimeout> | undefined
      let release: (() => void) | undefined
      let cancelled = false
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            await new Promise<void>((resolve) => {
              release = resolve
              timer = setTimeout(resolve, 20)
            })
            if (cancelled)
              return
            const bytes = Math.min(16384, remaining)
            controller.enqueue(new Uint8Array(bytes))
            remaining -= bytes
            if (!remaining)
              controller.close()
          },
          cancel() {
            cancelled = true
            clearTimeout(timer)
            release?.()
          },
        }),
        { headers },
      )
    }),
  )
  const update = vi.fn()
  const cancel = vi.fn(async () => {})
  const runner = createLocalSpeedtest({
    start: async () => session,
    cancel,
    update,
    errorStatus: () => undefined,
  })
  const pending = runner.start()
  await vi.advanceTimersByTimeAsync(2000)
  const before = structuredClone(update.mock.calls.at(-1)![0].result)
  expect(before.bytesPerSecond).toBeGreaterThan(0)
  expect(before.payloadBytes).toBeGreaterThan(0)
  expect(before.samples.length).toBeGreaterThan(0)
  runner.stop()
  await pending
  await vi.advanceTimersByTimeAsync(1000)
  expect(update.mock.calls.at(-1)![0]).toEqual({
    status: 'cancelled',
    error: null,
    result: before,
  })
  expect(cancel).toHaveBeenCalledWith(session.id)
  expect(vi.getTimerCount()).toBe(0)
  const next = runner.start()
  expect(update.mock.calls.at(-1)![0]).toEqual({
    status: 'preparing',
    error: null,
    result: null,
  })
  runner.stop()
  await next
  expect(update.mock.calls.at(-1)![0].result).toBeNull()
})
