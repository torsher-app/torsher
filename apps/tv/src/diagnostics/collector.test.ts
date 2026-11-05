import { describe, expect, it, vi } from 'vitest'
import { createDiagnostics } from './collector.ts'
import { sanitizeEvent } from './sanitize.ts'

function storage() {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => map.clear(),
  } as Storage
}
const status = {
  enabled: true,
  collecting: true,
  schemaVersion: 1,
  profileId: 'profile-0001',
  deviceId: null,
  serverInstance: 'server-001',
  serverVersion: '1',
  serverTime: '2026-11-05T00:00:00.000Z',
  fileSinkState: 'enabled',
  retentionState: 'ok',
}
const event = {
  event: 'continue.selected',
  eventId: 'session-001:1',
  clientSessionId: 'session-001',
  clientSeq: 1,
  clientTime: '2026-11-05T00:00:00.000Z',
  elapsedMs: 0,
  position: 0,
  duration: null,
  next: true,
  followNewEpisode: false,
  snapshotAgeMs: 0,
}
function harness(shared = storage()) {
  let now = Date.parse('2026-11-05T00:00:00.000Z')
  const requests: { url: string, init?: RequestInit }[] = []
  let answer: (init?: RequestInit) => Response | Promise<Response> = init =>
    new Response(
      JSON.stringify({
        accepted: JSON.parse(String(init?.body)).events.map(
          (e: { eventId: string }) => e.eventId,
        ),
        duplicate: [],
        rejected: [],
      }),
    )
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    return String(url) === '/api/diagnostics'
      ? new Response(JSON.stringify(status))
      : answer(init)
  })
  const beacon = vi.fn(() => true)
  const collector = createDiagnostics({
    fetch: fetcher as typeof fetch,
    now: () => now,
    random: Math.random,
    storage: shared,
    schedule: () => 0 as unknown as ReturnType<typeof setTimeout>,
    cancel: () => {},
    beacon,
    keepalive: false,
  })
  return {
    collector,
    requests,
    fetcher,
    shared,
    beacon,
    answer: (next: typeof answer) => {
      answer = next
    },
    advance: (ms: number) => {
      now += ms
    },
    async start() {
      collector.start({
        event: 'client.started',
        tvBuildId: 'test-build',
        clientKind: 'browser',
      })
      await collector.negotiate()
    },
  }
}

describe('diagnostic sanitation', () => {
  it('strips unknown nested/private data before persistence', () => {
    const clean = sanitizeEvent({
      ...event,
      rawUrl: 'https://private.example/token',
      input: 'secret',
    })
    expect(clean).toEqual(event)
    expect(
      sanitizeEvent({ ...event, titleId: 'secret title' }),
    ).toBeUndefined()
  })
  it('rejects missing required fields, wrong event enums and numeric bounds', () => {
    expect(sanitizeEvent({ ...event, position: undefined })).toBeUndefined()
    expect(
      sanitizeEvent({
        ...event,
        event: 'progress.result',
        outcome: 'opened',
        reason: 'exit',
      }),
    ).toBeUndefined()
    expect(sanitizeEvent({ ...event, season: 10000 })).toBeUndefined()
    expect(sanitizeEvent({ ...event, season: 1.5 })).toBeUndefined()
    expect(
      sanitizeEvent({ ...event, eventId: 'session-001:2' }),
    ).toBeUndefined()
  })
  it('accepts an unranked preference sentinel without clamping', () => {
    const clean = sanitizeEvent({
      ...event,
      event: 'source.resolve',
      branch: 'ranked_candidate',
      outcome: 'ready',
      candidates: [
        {
          candidateId: 'a'.repeat(32),
          diagnostics: {
            rank: 4,
            score: 0,
            audioPriority: Number.MAX_SAFE_INTEGER,
            typePriority: Number.MAX_SAFE_INTEGER,
          },
          confidence: 'high',
          seeders: 10,
          quality: null,
          resolution: null,
          coversEpisode: true,
        },
      ],
    })
    expect(clean).toBeDefined()
    expect(JSON.stringify(clean)).toContain(String(Number.MAX_SAFE_INTEGER))
  })
})

describe('bounded diagnostic transport', () => {
  it('does nothing before explicit bootstrap and acknowledges only sent ids', async () => {
    const h = harness()
    h.collector.add({ event: 'player.back', outcome: 'exit' })
    expect(h.requests).toHaveLength(0)
    await h.start()
    h.collector.add({ event: 'player.back', outcome: 'exit' })
    await h.collector.flush()
    expect(h.collector.inspect().queued).toBe(0)
    expect(h.requests[0]!.url).toBe('/api/diagnostics')
  })
  it('retries with the same event ids and does not treat beacon true as ACK', async () => {
    const h = harness()
    await h.start()
    await h.collector.flush(true)
    expect(h.beacon).toHaveBeenCalledOnce()
    expect(h.collector.inspect().queued).toBe(1)
    h.answer(() => {
      throw new Error('offline')
    })
    await h.collector.flush()
    const first = h.requests.at(-1)!.init!.body
    h.advance(3000)
    await h.collector.flush()
    expect(h.requests.at(-1)!.init!.body).toBe(first)
  })
  it.each([401, 403])('stops on %s without refresh loops', async (code) => {
    const h = harness()
    await h.start()
    h.answer(() => new Response(null, { status: code }))
    await h.collector.flush()
    expect(h.collector.inspect().active).toBe(false)
    const count = h.requests.length
    await h.collector.flush()
    expect(h.requests).toHaveLength(count)
  })
  it('disables a 404 capability until restart', async () => {
    const h = harness()
    h.fetcher.mockResolvedValue(new Response(null, { status: 404 }))
    await h.start()
    h.collector.profileChanged()
    await h.collector.negotiate()
    expect(h.requests).toHaveLength(0)
    expect(h.fetcher).toHaveBeenCalledOnce()
  })
  it('restores only after binding negotiation and expires replay after 24 hours', async () => {
    const h = harness()
    await h.start()
    await h.collector.flush(true)
    const next = harness(h.shared)
    expect(next.collector.inspect().queued).toBe(0)
    next.advance(24 * 60 * 60 * 1000 + 1)
    await next.start()
    await next.collector.flush()
    const sent = JSON.parse(String(next.requests.at(-1)!.init?.body))
    expect(
      sent.events.some(
        (e: { clientSessionId: string }) =>
          e.clientSessionId === h.collector.inspect().sessionId,
      ),
    ).toBe(false)
  })
  it('never attributes old queue to the new profile', async () => {
    const h = harness()
    await h.start()
    const old = h.collector.inspect().sessionId
    h.collector.beforeProfileChange()
    h.collector.profileChanged()
    await h.collector.negotiate()
    await h.collector.flush()
    expect(h.collector.inspect().sessionId).not.toBe(old)
    expect(h.collector.inspect().queued).toBe(0)
  })
  it('survives storage failures and bounds memory during offline playback', async () => {
    const h = harness()
    h.shared.setItem = () => {
      throw new Error('quota')
    }
    h.answer(() => {
      throw new Error('offline')
    })
    await h.start()
    for (let i = 0; i < 300; i++)
      h.collector.add({ event: 'player.back', outcome: 'hide_osd' })
    expect(h.collector.inspect().queued).toBeLessThanOrEqual(128)
    await h.collector.flush()
  })
})

it('freezes one beacon batch across hidden and pagehide even when events arrive', async () => {
  const h = harness()
  await h.start()
  await h.collector.flush(true)
  h.collector.add({ event: 'player.back', outcome: 'hide_osd' })
  await h.collector.flush(true)
  expect(h.beacon).toHaveBeenCalledOnce()
  expect(h.collector.inspect().queued).toBe(2)
})
it('isolates a message-only 400 without endlessly retrying or discarding valid neighbours', async () => {
  const h = harness()
  await h.start()
  h.collector.add({ event: 'player.back', outcome: 'exit' })
  h.answer((init) => {
    const events = JSON.parse(String(init?.body)).events as {
      event: string
      eventId: string
    }[]
    return events.some(event => event.event === 'client.started')
      ? new Response(JSON.stringify({ message: 'diagnostics_invalid' }), {
          status: 400,
        })
      : new Response(
          JSON.stringify({
            accepted: events.map(event => event.eventId),
            duplicate: [],
            rejected: [],
          }),
        )
  })
  await h.collector.flush()
  h.advance(2001)
  await h.collector.flush()
  h.advance(2001)
  await h.collector.flush()
  expect(h.collector.inspect().queued).toBe(1)
  const count = h.requests.length
  h.advance(30000)
  await h.collector.flush()
  expect(h.requests).toHaveLength(count)
})
it('respects Retry-After and splits a 413 without changing event ids', async () => {
  const h = harness()
  await h.start()
  h.collector.add({ event: 'player.back', outcome: 'exit' })
  h.answer(
    () => new Response(null, { status: 429, headers: { 'Retry-After': '30' } }),
  )
  await h.collector.flush()
  const count = h.requests.length
  h.advance(29000)
  await h.collector.flush()
  expect(h.requests).toHaveLength(count)
  h.advance(1001)
  h.answer(() => new Response(null, { status: 413 }))
  await h.collector.flush()
  await h.collector.flush()
  const events = JSON.parse(String(h.requests.at(-1)!.init?.body)).events
  expect(events).toHaveLength(1)
  expect(events[0].clientSeq).toBe(1)
})
it('bounds the origin-wide persistent budget across two running tabs', async () => {
  const shared = storage()
  const a = harness(shared)
  const b = harness(shared)
  await a.start()
  await b.start()
  a.answer(() => {
    throw new Error('offline')
  })
  b.answer(() => {
    throw new Error('offline')
  })
  for (let i = 0; i < 80; i++) {
    a.collector.add({ event: 'player.back', outcome: 'hide_osd' })
    b.collector.add({ event: 'player.back', outcome: 'hide_osd' })
  }
  await a.collector.flush(true)
  await b.collector.flush(true)
  let count = 0
  let bytes = 0
  for (let i = 0; i < shared.length; i++) {
    const raw = shared.getItem(shared.key(i)!)!
    bytes += raw.length
    count += JSON.parse(raw).items.length
  }
  expect(count).toBeLessThanOrEqual(64)
  expect(bytes).toBeLessThanOrEqual(65536)
  expect(a.collector.inspect().sessionId).not.toBe(
    b.collector.inspect().sessionId,
  )
})

it('rejects late operation context from a previous actor instead of rebinding it', async () => {
  const h = harness()
  await h.start()
  await h.collector.flush()
  const previous = h.collector.action()
  h.collector.profileChanged()
  await h.collector.negotiate()
  await h.collector.flush()
  h.collector.add(
    {
      event: 'progress.result',
      position: 10,
      duration: 100,
      reason: 'exit',
      outcome: 'accepted',
    },
    previous,
  )
  expect(h.collector.request(previous)).toBeUndefined()
  expect(h.collector.inspect().queued).toBe(0)
  const current = h.collector.action(previous)
  expect(current.parentActionId).toBeUndefined()
  h.collector.add({ event: 'player.back', outcome: 'exit' }, current)
  await h.collector.flush()
  const batch = JSON.parse(String(h.requests.at(-1)!.init?.body))
  expect(batch.events).toHaveLength(1)
  expect(batch.events[0].clientSessionId).toBe(current.clientSessionId)
  expect(batch.events[0].actionId).not.toBe(previous.actionId)
})

it('rotates the client session on auth-binding conflict before renegotiation', async () => {
  const h = harness()
  await h.start()
  const old = h.collector.action()
  h.answer(() => new Response(null, { status: 409 }))
  await h.collector.flush()
  expect(h.collector.inspect().sessionId).not.toBe(old.clientSessionId)
  const queued = h.collector.inspect().queued
  h.collector.add({ event: 'player.back', outcome: 'exit' }, old)
  expect(h.collector.inspect().queued).toBe(queued)
  expect(h.collector.request(old)).toBeUndefined()
})

it('preserves one intention through initial negotiation and off/on without collecting early', async () => {
  const h = harness()
  h.fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ ...status, enabled: false, collecting: false }),
    ),
  )
  const initial = h.collector.action()
  expect(initial.actionId).toBeDefined()
  await h.start()
  h.collector.add({ event: 'player.back', outcome: 'exit' }, initial)
  expect(h.collector.inspect().queued).toBe(0)
  expect(h.collector.request(initial)).toBeUndefined()
  h.collector.beforeProfileChange(status.profileId)
  h.collector.profileChanged(status.profileId)
  await h.collector.negotiate()
  expect(h.collector.request(initial)?.actionId).toBe(initial.actionId)
  h.collector.add({ event: 'player.back', outcome: 'exit' }, initial)
  await h.collector.flush()
  const batch = JSON.parse(String(h.requests.at(-1)!.init?.body))
  expect(
    batch.events.find((e: { event: string }) => e.event === 'player.back')
      .actionId,
  ).toBe(initial.actionId)
})

it('retries journal-unavailable ACKs with stable ids and bounded backoff until expiry', async () => {
  const h = harness()
  await h.start()
  h.answer(
    init =>
      new Response(
        JSON.stringify({
          accepted: [],
          duplicate: [],
          rejected: JSON.parse(String(init?.body)).events.map(
            (e: { eventId: string }) => ({
              eventId: e.eventId,
              code: 'journal_unavailable',
            }),
          ),
        }),
      ),
  )
  await h.collector.flush()
  const first = h.requests.at(-1)!.init!.body
  const calls = h.requests.length
  await h.collector.flush()
  expect(h.requests).toHaveLength(calls)
  h.advance(2600)
  await h.collector.flush()
  expect(h.requests.at(-1)!.init!.body).toBe(first)
  expect(h.collector.inspect().queued).toBe(1)
  h.advance(24 * 60 * 60 * 1000)
  await h.collector.flush()
  const batch = JSON.parse(String(h.requests.at(-1)!.init?.body))
  expect(batch.events).toEqual([
    expect.objectContaining({
      event: 'diagnostics.loss',
      reason: 'expiry',
      count: 1,
    }),
  ])
})

it('accounts for permanent rejected events while retaining only transient neighbours', async () => {
  const h = harness()
  await h.start()
  h.collector.add({ event: 'player.back', outcome: 'hide_osd' })
  h.collector.add({ event: 'player.back', outcome: 'exit' })
  let transient = ''
  h.answer((init) => {
    const events = JSON.parse(String(init?.body)).events
    transient = events[2].eventId
    return new Response(
      JSON.stringify({
        accepted: [events[0].eventId],
        duplicate: [],
        rejected: [
          { eventId: events[1].eventId, code: 'invalid_event' },
          { eventId: transient, code: 'journal_unavailable' },
        ],
      }),
    )
  })
  await h.collector.flush()
  expect(h.collector.inspect().queued).toBe(1)
  h.advance(2600)
  h.answer((init) => {
    const events = JSON.parse(String(init?.body)).events
    expect(events).toEqual([
      expect.objectContaining({ eventId: transient }),
      expect.objectContaining({
        event: 'diagnostics.loss',
        reason: 'invalid_event',
        count: 1,
      }),
    ])
    return new Response(
      JSON.stringify({
        accepted: [transient],
        duplicate: [],
        rejected: events
          .filter((e: { event: string }) => e.event === 'diagnostics.loss')
          .map((e: { eventId: string }) => ({
            eventId: e.eventId,
            code: 'invalid_event',
          })),
      }),
    )
  })
  await h.collector.flush()
  expect(h.collector.inspect().queued).toBe(0)
  const calls = h.requests.length
  h.advance(61000)
  await h.collector.flush()
  expect(h.requests).toHaveLength(calls)
})
