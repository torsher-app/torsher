import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DiagnosticEvent,
  DiagnosticMediaSnapshot,
} from '@torsher/api-client'
import { createDiagnostics } from './collector.ts'
import { createSupportRuntime, environment } from './support.ts'
import { loadSupportAssets, safeLocations } from './supportAssets.ts'
import { mediaSnapshot } from './media.ts'

const hash = 'a'.repeat(64)
const asset = 'https://tv.example/assets/main-123.js'
const status = {
  enabled: true,
  collecting: true,
  schemaVersion: 1,
  profileId: 'profile-0001',
  deviceId: null,
  supportFacts: 1,
}
const client = { tvBuildId: 'test-build', clientKind: 'browser' as const }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-05T00:00:00Z'))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
function harness(supportFacts: number | undefined = 1, storage?: Storage) {
  const sent: DiagnosticEvent[] = []
  const target = new EventTarget()
  const assets = vi.fn(async () => new Map([[asset, hash]]))
  let collecting = true
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (url === '/api/diagnostics') {
      return new Response(
        JSON.stringify({ ...status, collecting, supportFacts }),
      )
    }
    const events = JSON.parse(String(init?.body)).events as DiagnosticEvent[]
    sent.push(...events)
    return new Response(
      JSON.stringify({
        accepted: events.map(e => e.eventId),
        rejected: [],
        duplicate: [],
      }),
    )
  })
  let collector: ReturnType<typeof createDiagnostics>
  const support = createSupportRuntime({
    session: () => collector.inspect().sessionId,
    now: Date.now,
    target,
    assets,
    emit: (...args) => collector.add(...args),
    environment: () => ({
      ...client,
      ...environment('Chrome/120.0.0.0 Linux SECRET'),
      deviceModel: 'unsupported',
    }),
    schedule: (fn, delay) => setTimeout(fn, delay),
    cancel: timer => clearTimeout(timer),
  })
  collector = createDiagnostics({
    fetch: fetcher as typeof fetch,
    now: Date.now,
    random: Math.random,
    storage,
    onSupportChange: support.setEnabled,
    schedule: (fn, delay) => setTimeout(fn, delay),
    cancel: timer => clearTimeout(timer),
  })
  function media() {
    support.media(() => ({
      media: {
        state: 'available',
        source: 'html_video',
        position: 42,
        paused: false,
      },
      active: true,
      context: { ...collector.action(), session: 'playback-0001' },
    }))
  }
  return {
    sent,
    target,
    assets,
    support,
    collector,
    media,
    disable: () => {
      collecting = false
    },
    async start() {
      collector.start({ event: 'client.started', ...client })
      await collector.negotiate()
      await vi.advanceTimersByTimeAsync(2100)
    },
    dispatch(kind: 'error' | 'unhandledrejection', value: unknown) {
      const event = new Event(kind, { cancelable: true })
      Object.defineProperty(event, kind === 'error' ? 'error' : 'reason', {
        value,
      })
      target.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    },
  }
}

describe('support runtime through collector', () => {
  it('has no listeners/assets/IO before capability and on old servers; detaches on disable', async () => {
    const h = harness(0)
    h.dispatch('error', new Error('SECRET'))
    expect(h.assets).not.toHaveBeenCalled()
    await h.start()
    expect(h.assets).not.toHaveBeenCalled()
    h.dispatch('unhandledrejection', new TypeError('SECRET'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.sent.map(e => e.event)).toEqual(['client.started'])
    h.collector.stop()
    const enabled = harness()
    await enabled.start()
    enabled.disable()
    await enabled.collector.negotiate()
    enabled.dispatch('error', new TypeError('SECRET'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(enabled.sent.filter(e => e.event === 'client.error')).toHaveLength(
      0,
    )
    enabled.collector.stop()
  })
  it('captures exact assets and media before the caller clears it, with no fabricated promise action', async () => {
    const h = harness()
    await h.start()
    h.media()
    const reason = new TypeError('SECRET token=/private/file')
    Object.defineProperty(reason, 'stack', {
      value: `SECRET\n at work (${asset}:12:9)\n at unknown (https://other/SECRET.js:7:8)`,
    })
    h.dispatch('unhandledrejection', reason)
    h.support.media(() => undefined)
    await vi.advanceTimersByTimeAsync(3000)
    const error = h.sent.find(e => e.event === 'client.error')!
    expect(error).toMatchObject({
      code: 'type_error',
      locations: [{ assetId: hash, line: 12, column: 9 }],
      droppedLocations: 1,
      media: { position: 42 },
    })
    expect(error).not.toHaveProperty('actionId')
    expect(error).not.toHaveProperty('session')
    expect(JSON.stringify(h.sent)).not.toMatch(/SECRET|private|https:/)
    h.collector.stop()
  })
  it('uses ErrorEvent coordinates when a runtime stack is an inaccessible accessor', async () => {
    const h = harness()
    await h.start()
    const event = new Event('error', { cancelable: true })
    Object.defineProperties(event, {
      error: { value: new TypeError('SECRET') },
      filename: { value: asset },
      lineno: { value: 30 },
      colno: { value: 2 },
    })
    h.target.dispatchEvent(event)
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.sent.find(e => e.event === 'client.error')).toMatchObject({
      locations: [{ assetId: hash, line: 30, column: 2 }],
    })
    expect(event.defaultPrevented).toBe(false)
    h.collector.stop()
  })

  it('does not emit heartbeat snapshots for inactive playback', async () => {
    const h = harness()
    await h.start()
    h.support.media(() => ({
      media: { state: 'available', source: 'html_video', paused: true },
      active: false,
      context: h.collector.action(),
    }))
    await vi.advanceTimersByTimeAsync(240000)
    expect(h.sent.some(e => e.event === 'playback.snapshot')).toBe(false)
    h.collector.stop()
  })

  it('records startup, playing, buffering and recovery within two minutes', async () => {
    const h = harness()
    await h.start()
    const context = { ...h.collector.action(), session: 'playback-0001' }
    let readyState = 0
    let stalled = false
    h.support.media(() => ({
      media: { state: 'available', source: 'html_video', readyState },
      context,
      active: true,
      stalled,
    }))
    h.support.snapshot('transition')
    await vi.advanceTimersByTimeAsync(5000)
    readyState = 4
    h.support.snapshot('transition')
    await vi.advanceTimersByTimeAsync(5000)
    readyState = 2
    stalled = true
    h.support.snapshot('buffering')
    await vi.advanceTimersByTimeAsync(5000)
    readyState = 4
    stalled = false
    h.support.snapshot('transition')
    await vi.advanceTimersByTimeAsync(3000)
    const snapshots = h.sent.filter(e => e.event === 'playback.snapshot')
    expect(snapshots.map(e => [e.trigger, e.media.readyState])).toEqual([
      ['transition', 0],
      ['transition', 4],
      ['buffering', 2],
      ['transition', 4],
    ])
    h.collector.stop()
  })

  it('coalesces trailing state, ignores counters and cancels pending work on short cancel/next', async () => {
    const h = harness()
    await h.start()
    let current: DiagnosticMediaSnapshot = {
      state: 'available',
      source: 'html_video',
      readyState: 0,
    }
    const context = { ...h.collector.action(), session: 'playback-0001' }
    const release = h.support.media(() => ({
      media: current,
      context,
      active: true,
    }))
    h.support.snapshot('transition')
    await vi.advanceTimersByTimeAsync(100)
    current = { ...current, readyState: 3 }
    h.support.snapshot('transition')
    await vi.advanceTimersByTimeAsync(100)
    current = { ...current, readyState: 4 }
    h.support.snapshot('transition')
    await vi.advanceTimersByTimeAsync(4000)
    for (let i = 0; i < 20; i++) {
      current = {
        ...current,
        position: i,
        totalFrames: i * 60,
        buffered: [{ start: 0, end: i + 10 }],
      }
      h.support.snapshot('transition')
    }
    current = { ...current, readyState: 2 }
    h.support.snapshot('buffering')
    await vi.advanceTimersByTimeAsync(100)
    current = { ...current, readyState: 1 }
    h.support.snapshot('transition')
    release()
    await vi.advanceTimersByTimeAsync(3000)
    const next = { ...h.collector.action(), session: 'playback-0002' }
    h.support.media(() => ({
      media: { state: 'available', source: 'native', readyState: 4 },
      context: next,
      active: true,
    }))
    h.support.snapshot('transition')
    await vi.advanceTimersByTimeAsync(3000)
    const snapshots = h.sent.filter(e => e.event === 'playback.snapshot')
    expect(snapshots.map(e => [e.session, e.media.readyState])).toEqual([
      ['playback-0001', 0],
      ['playback-0001', 4],
      ['playback-0001', 2],
      ['playback-0002', 4],
    ])
    h.collector.stop()
  })

  it('never reads arbitrary reason getters and bounds a 10000 error storm with a summary', async () => {
    const h = harness()
    await h.start()
    const getter = vi.fn(() => {
      throw new Error('SECRET')
    })
    const reason = Object.defineProperties(
      {},
      {
        stack: { get: getter },
        name: { get: getter },
        message: { get: getter },
      },
    )
    for (let i = 0; i < 10000; i++) h.dispatch('unhandledrejection', reason)
    for (const code of [
      'type_error',
      'range_error',
      'reference_error',
      'syntax_error',
      'uri_error',
      'eval_error',
      'abort_error',
    ] as const)
      h.support.error('runtime', undefined, code)
    await vi.advanceTimersByTimeAsync(121000)
    expect(getter).not.toHaveBeenCalled()
    expect(h.sent.filter(e => e.event === 'client.error')).toHaveLength(6)
    expect(
      h.sent.find(e => e.event === 'client.error_summary'),
    ).toMatchObject({ suppressed: 10001 })
    expect(h.collector.inspect().queued).toBeLessThanOrEqual(128)
    h.collector.stop()
  })
  it('does not reuse media from a previous profile/session and resets rate guards', async () => {
    const h = harness()
    await h.start()
    const context = h.collector.action()
    h.support.media(() => ({
      media: { state: 'available', source: 'native', position: 123 },
      context,
      active: true,
    }))
    h.dispatch('error', new TypeError('SECRET'))
    await vi.advanceTimersByTimeAsync(3000)
    h.collector.stop()
    await h.start()
    h.dispatch('error', new TypeError('SECRET'))
    await vi.advanceTimersByTimeAsync(3000)
    const errors = h.sent.filter(e => e.event === 'client.error')
    expect(errors).toHaveLength(2)
    expect(errors[0]).toHaveProperty('media.position', 123)
    expect(errors[1]).not.toHaveProperty('media')
    h.collector.stop()
  })
  it('keeps actual 2h runtime/collector additions below 120 records and 256 KiB', async () => {
    const h = harness()
    await h.start()
    let second = 0
    const context = h.collector.action()
    h.support.media(() => {
      const phase = second % 360
      const stalled
        = Math.floor(second / 360) % 4 === 0 && phase >= 60 && phase < 65
      return {
        media: {
          state: 'available',
          source: 'html_video',
          readyState: phase < 5 ? 0 : stalled ? 2 : 4,
          paused: false,
          position: phase,
          totalFrames: second * 25,
        },
        context: {
          ...context,
          session: `playback-${String(Math.floor(second / 360)).padStart(4, '0')}`,
        },
        active: phase >= 5,
        stalled,
      }
    })
    // Twenty playback starts, five stalls/recoveries, per-second progress/counter noise.
    for (; second < 7200; second++) {
      if (second === 7180)
        h.support.clearMedia()
      h.support.snapshot('transition')
      await vi.advanceTimersByTimeAsync(1000)
    }
    await vi.advanceTimersByTimeAsync(3000)
    const facts = h.sent.filter(e => e.event !== 'client.started')
    const bytes = Buffer.byteLength(JSON.stringify(facts))
    expect(facts.length).toBeLessThanOrEqual(120)
    expect(bytes).toBeLessThanOrEqual(256 * 1024)
    expect(facts.length + 280).toBeLessThanOrEqual(500)
    expect(facts.length).toBeGreaterThanOrEqual(60)
    console.warn(
      `support 2h: ${facts.length} events, ${bytes} client JSON bytes (before server log envelope)`,
    )
    h.collector.stop()
  })
})

describe('support replay compatibility', () => {
  it('drops new persisted facts before replay to old servers while preserving legacy neighbours', async () => {
    const envelope = {
      clientSessionId: 'old-session-0001',
      clientSeq: 1,
      clientTime: new Date().toISOString(),
      elapsedMs: 0,
    }
    const items = [
      {
        event: {
          ...envelope,
          eventId: 'old-session-0001:1',
          event: 'client.environment',
          ...client,
          browserFamily: 'unknown',
          osFamily: 'unknown',
          deviceModel: 'unsupported',
          assetManifest: 'unavailable',
        },
        expiresAt: Date.now() + 3600000,
      },
      {
        event: {
          ...envelope,
          eventId: 'old-session-0001:2',
          clientSeq: 2,
          event: 'client.started',
          ...client,
        },
        expiresAt: Date.now() + 3600000,
      },
    ]
    const map = new Map([
      [
        'torsher.diagnostics.v1.old-session-0001',
        JSON.stringify({ profileId: status.profileId, deviceId: null, items }),
      ],
    ])
    const storage: Storage = {
      get length() {
        return map.size
      },
      key: i => [...map.keys()][i] ?? null,
      getItem: key => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value)
      },
      removeItem: (key) => {
        map.delete(key)
      },
      clear: () => map.clear(),
    }
    const h = harness(0, storage)
    await h.start()
    expect(h.sent.some(e => e.event === 'client.environment')).toBe(false)
    expect(h.sent.some(e => e.eventId === 'old-session-0001:2')).toBe(true)
    expect(h.sent.find(e => e.event === 'diagnostics.loss')).toMatchObject({
      reason: 'invalid_event',
      count: 1,
    })
    expect(h.assets).not.toHaveBeenCalled()
    h.collector.stop()
  })
})

describe('safe projections', () => {
  it('keeps known numeric environment tokens only and never infers webOS version from Chrome', () => {
    expect(environment('Web0S Chrome/68.0.0.0 SECRET')).toEqual({
      browserFamily: 'chromium',
      browserVersion: '68.0.0.0',
      osFamily: 'webos',
    })
    expect(environment('SECRET')).toEqual({
      browserFamily: 'unknown',
      osFamily: 'unknown',
    })
  })
  it('limits frames to four exact asset URLs; query strings and foreign bundles do not match', () => {
    const result = safeLocations(
      Array.from(
        { length: 10 },
        (_, i) => ` at f (${asset}${i === 0 ? '?SECRET' : ''}:${i + 1}:0)`,
      ).join('\n'),
      new Map([[asset, hash]]),
    )
    expect(result.locations).toHaveLength(4)
    expect(result.droppedLocations).toBe(6)
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })
  it('validates manifest build, version, bounded size and paths', async () => {
    const fetcher = (value: unknown) =>
      vi.fn(
        async () => new Response(JSON.stringify(value)),
      ) as unknown as typeof fetch
    const valid = {
      version: 1,
      tvBuildId: 'build',
      assets: { 'assets/main-123.js': hash },
    }
    expect(
      (
        await loadSupportAssets(fetcher(valid), 'https://tv.example/', 'build')
      ).get(asset),
    ).toBe(hash)
    expect(
      (await loadSupportAssets(fetcher(valid), 'https://tv.example/', 'other'))
        .size,
    ).toBe(0)
    expect(
      (
        await loadSupportAssets(
          fetcher({ ...valid, assets: { '../SECRET.js': hash } }),
          'https://tv.example/',
          'build',
        )
      ).size,
    ).toBe(0)
    expect(
      (
        await loadSupportAssets(
          fetcher('x'.repeat(40000)),
          'https://tv.example/',
          'build',
        )
      ).size,
    ).toBe(0)
  })
  it('does not read labels/currentSrc/error.message or unsupported native counters', () => {
    const forbidden = vi.fn(() => {
      throw new Error('SECRET')
    })
    const video = {
      currentTime: 10,
      duration: 100,
      paused: false,
      ended: false,
      readyState: 4,
      error: null,
      buffered: {
        length: 10,
        start: (i: number) => i * 10,
        end: (i: number) => i * 10 + 5,
      },
    }
    Object.defineProperties(video, {
      currentSrc: { get: forbidden },
      videoWidth: { get: forbidden },
      getVideoPlaybackQuality: { get: forbidden },
    })
    const result = mediaSnapshot(video as unknown as HTMLVideoElement, true)
    expect(forbidden).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      source: 'native',
      state: 'available',
      native: 'playing',
    })
    expect(result.buffered).toHaveLength(4)
    expect(result).not.toHaveProperty('width')
    expect(mediaSnapshot(undefined, true)).toMatchObject({
      state: 'unsupported',
    })
  })
})
