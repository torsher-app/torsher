import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticEvent } from '@torsher/api-client'

const runtime = vi.hoisted(() => ({ api: undefined as any }))
vi.mock('../api.ts', () => ({
  api: new Proxy({}, { get: (_, key) => runtime.api[key] }),
}))
vi.mock('../i18n.ts', () => ({
  i18n: { global: { locale: { value: 'en_US' } } },
}))
vi.mock('../platform/android.ts', () => ({ nativeDeviceProfile: () => ({}) }))
vi.mock('../platform/webos.ts', () => ({ isWebos: () => false }))
vi.mock('../session.ts', () => ({
  session: { profile: { id: 'profile-0001' } },
}))

let diagnostics: typeof import('./index.ts')
let usePlayback: (typeof import('../composables/usePlayback.ts'))['usePlayback']
let resolveEpisode: (typeof import('../composables/resolveEpisode.ts'))['resolveEpisode']
let sent: DiagnosticEvent[]
let requests: { url: string, init: RequestInit }[]
let route: (url: string, init: RequestInit) => Response | Promise<Response>
let capability: () => Promise<Response>
let counter: number
const status = {
  enabled: true,
  collecting: true,
  schemaVersion: 1,
  profileId: 'profile-0001',
  deviceId: null,
}
function json(value: unknown, code = 200) {
  return new Response(JSON.stringify(value), {
    status: code,
    headers: {
      'Content-Type': 'application/json',
      'X-Torsher-Request-Id': `request-${String(++counter).padStart(8, '0')}`,
    },
  })
}
async function settle() {
  await vi.advanceTimersByTimeAsync(0)
}
async function deliver() {
  await vi.advanceTimersByTimeAsync(2100)
}
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  counter = 0
  sent = []
  requests = []
  route = () => json({})
  capability = async () => json(status)
  vi.stubGlobal('window', {
    history: { state: null },
    addEventListener: vi.fn(),
  })
  vi.stubGlobal('document', { addEventListener: vi.fn(), hidden: false })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/diagnostics')
        return capability()
      if (url === '/api/diagnostics/events') {
        const events = JSON.parse(String(init.body))
          .events as DiagnosticEvent[]
        sent.push(...events)
        return json({
          accepted: events.map(event => event.eventId),
          duplicate: [],
          rejected: [],
        })
      }
      requests.push({ url, init })
      return route(url, init)
    }),
  )
  diagnostics = await import('./index.ts')
  const { createApiClient } = await import('@torsher/api-client')
  runtime.api = createApiClient({
    getErrorMode: () => 'silent',
    onSessionExpired: () => {},
    onError: () => {},
    onFatal: () => {},
    onRequestResult: diagnostics.observeDiagnosticRequest,
  })
  usePlayback = (await import('../composables/usePlayback.ts')).usePlayback
  resolveEpisode = (await import('../composables/resolveEpisode.ts'))
    .resolveEpisode
})
afterEach(() => {
  diagnostics.stopDiagnostics()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('live diagnostic operation correlation', () => {
  it('delivers with a browser timer that rejects a foreign receiver', async () => {
    const cancelTimer = globalThis.clearTimeout
    vi.stubGlobal(
      'clearTimeout',
      function (this: unknown, timer: ReturnType<typeof setTimeout>) {
        if (this !== undefined && this !== globalThis && this !== window)
          throw new TypeError('Illegal invocation')
        cancelTimer(timer)
      },
    )
    diagnostics.startDiagnostics('browser')
    await settle()
    const context = diagnostics.diagnosticAction()
    expect(diagnostics.diagnosticParams(context).headers).toBeDefined()
    diagnostics.diagnostic({ event: 'player.back', outcome: 'exit' }, context)
    await deliver()
    expect(sent.some(event => event.event === 'client.started')).toBe(true)
    expect(
      sent.some(
        event =>
          event.event === 'player.back' && event.actionId === context.actionId,
      ),
    ).toBe(true)
  })

  it('keeps direct Player/Resolve intention across delayed capability and initial profile entry', async () => {
    let release!: (response: Response) => void
    capability = () =>
      new Promise((resolve) => {
        release = resolve
      })
    diagnostics.startDiagnostics('browser')
    const context = diagnostics.currentDiagnosticContext()
    const scope = effectScope()
    const player = scope.run(() =>
      usePlayback({ mediaFileId: 'media-0001' }, undefined, undefined, context),
    )!
    expect(context.actionId).toBeTruthy()
    expect(sent).toHaveLength(0)
    diagnostics.diagnosticProfileChanged('profile-0001')
    release(json(status))
    await settle()
    route = url =>
      url.includes('/playback')
        ? json({ sessionId: 'session-0001', status: 'ready', mode: 'direct' })
        : json({})
    await player.start()
    await player.saveWatchState(10, 100)
    await deliver()
    const business = requests.filter(
      item =>
        item.url.includes('/playback') || item.url.includes('/watch-state'),
    )
    expect(business.length).toBeGreaterThanOrEqual(2)
    expect(
      business.every(
        item =>
          new Headers(item.init.headers).get('x-torsher-action-id')
            === context.actionId,
      ),
    ).toBe(true)
    expect(
      sent.some(
        event =>
          event.event === 'playback.ready'
          && event.actionId === context.actionId,
      ),
    ).toBe(true)
    scope.stop()
  })
  it('correlates each intermediate PUT and classifies a swallowed timeout and HTTP error truthfully', async () => {
    diagnostics.startDiagnostics('browser')
    await settle()
    const scope = effectScope()
    const context = diagnostics.diagnosticAction()
    const player = scope.run(() =>
      usePlayback({ mediaFileId: 'media-0001' }, undefined, undefined, context),
    )!
    await player.saveWatchState(10, 100)
    route = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal!.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))),
      )
    const timeout = player.saveWatchState(20, 100)
    await vi.advanceTimersByTimeAsync(10_001)
    await expect(timeout).resolves.toBeUndefined()
    route = () => json({ message: 'failed' }, 503)
    await player.saveWatchState(30, 100)
    await deliver()
    const saves = requests.filter(item => item.url.includes('/watch-state'))
    expect(saves).toHaveLength(3)
    const ids = saves.map(item =>
      new Headers(item.init.headers).get('x-torsher-client-request-id'),
    )
    expect(new Set(ids).size).toBe(3)
    expect(ids.every(Boolean)).toBe(true)
    const results = sent.filter(
      (
        event,
      ): event is Extract<
        DiagnosticEvent,
        { event: 'progress.requested' | 'progress.result' }
      > => event.event === 'progress.result',
    )
    expect(results.map(event => event.outcome)).toEqual([
      'accepted',
      'timeout',
      'http_error',
    ])
    expect(results[1]!.clientRequestId).toBe(ids[1])
    const http = results[2]!
    expect(http.clientRequestId).toBe(ids[2])
    expect(http.requestId).toMatch(/^request-/)
    expect(
      sent.some(
        event =>
          event.event === 'request.result'
          && event.requestId === http.requestId
          && event.clientRequestId === ids[2],
      ),
    ).toBe(true)
    expect(
      sent.filter(
        event =>
          event.event === 'request.result' && event.outcome === 'accepted',
      ),
    ).toHaveLength(0)
    scope.stop()
  })
  it('summarizes a real 90 second files loop including GET retry, without logging every success', async () => {
    diagnostics.startDiagnostics('browser')
    await settle()
    let files = 0
    const begun = Date.now()
    route = (url) => {
      if (url.includes('/open'))
        return json({ torrentId: 'torrent-0001' })
      files++
      if (files === 2)
        return json({ message: 'retry' }, 503)
      return json({
        status: Date.now() - begun >= 88_000 ? 'ready' : 'resolving',
        files: [{ fileIndex: 0, season: 1, episode: 2, size: 100 }],
      })
    }
    const result = resolveEpisode(
      { titleId: 'tmdb:tv:100', season: 1, episode: 2 },
      {
        candidateId: 'a'.repeat(32),
        cancelled: () => false,
        diagnosticContext: diagnostics.diagnosticAction(),
      },
    )
    await vi.advanceTimersByTimeAsync(90_500)
    expect((await result).kind).toBe('found')
    await deliver()
    const summaries = sent.filter(event => event.event === 'poll.summary')
    expect(summaries).toHaveLength(1)
    const summary = summaries[0]!
    expect(summary.kind).toBe('files')
    expect(summary.requests).toBeGreaterThan(40)
    expect(summary.attempts).toBe(summary.requests + 1)
    expect(summary.errors).toBe(1)
    expect(summary.firstRequestId).toMatch(/^request-/)
    expect(summary.lastRequestId).toMatch(/^request-/)
    expect(summary.errorRequestId).toMatch(/^request-/)
    expect(sent).toContainEqual(
      expect.objectContaining({
        event: 'request.result',
        pollId: summary.pollId,
        requestId: summary.errorRequestId,
        outcome: 'http_error',
      }),
    )
    expect(
      sent.filter(
        event =>
          event.event === 'request.result' && event.outcome === 'accepted',
      ),
    ).toHaveLength(1) // /open only
    expect(sent.length).toBeLessThan(12)
  })
  it('summarizes actual probe polling and cancellation with known IDs', async () => {
    diagnostics.startDiagnostics('browser')
    await settle()
    let probes = 0
    route = (_url, init) => {
      if (init.method === 'DELETE')
        return json({})
      if (init.method === 'POST')
        return json({ sessionId: 'session-0001', status: 'probing' })
      probes++
      return json({
        sessionId: 'session-0001',
        status: probes >= 3 ? 'ready' : 'probing',
        mode: 'direct',
      })
    }
    const scope = effectScope()
    const player = scope.run(() =>
      usePlayback(
        { mediaFileId: 'media-0001' },
        undefined,
        undefined,
        diagnostics.diagnosticAction(),
      ),
    )!
    const start = player.start()
    await vi.advanceTimersByTimeAsync(3100)
    expect(await start).toBe('ready')
    await deliver()
    const summary = sent.find(event => event.event === 'poll.summary')!
    expect(summary).toMatchObject({
      kind: 'probe',
      requests: 3,
      attempts: 3,
      errors: 0,
      outcome: 'accepted',
    })
    expect(summary.firstRequestId).toBeTruthy()
    scope.stop()
    const another = effectScope()
    probes = 0
    const pending = another
      .run(() =>
        usePlayback(
          { mediaFileId: 'media-0002' },
          undefined,
          undefined,
          diagnostics.diagnosticAction(),
        ),
      )!
      .start()
    await vi.advanceTimersByTimeAsync(1100)
    another.stop()
    await vi.advanceTimersByTimeAsync(1100)
    expect(await pending).toBe('stale')
    await deliver()
    expect(
      sent.some(
        event =>
          event.event === 'poll.summary'
          && event.outcome === 'cancelled'
          && event.requests === 1,
      ),
    ).toBe(true)
  })
})

it('correlates 720 actual checkpoints without increasing successful diagnostic noise', async () => {
  diagnostics.startDiagnostics('browser')
  await settle()
  const scope = effectScope()
  const player = scope.run(() =>
    usePlayback(
      { mediaFileId: 'media-0001' },
      undefined,
      undefined,
      diagnostics.diagnosticAction(),
    ),
  )!
  for (let i = 0; i < 720; i++) {
    await player.saveWatchState(i * 10, 7200)
    await vi.advanceTimersByTimeAsync(10_000)
  }
  await deliver()
  const saves = requests.filter(item => item.url.includes('/watch-state'))
  expect(saves).toHaveLength(720)
  const ids = saves.map(item =>
    new Headers(item.init.headers).get('x-torsher-client-request-id'),
  )
  expect(ids.every(Boolean)).toBe(true)
  expect(new Set(ids).size).toBe(720)
  expect(
    sent.filter(event => event.event === 'progress.result'),
  ).toHaveLength(40)
  expect(sent.filter(event => event.event === 'request.result')).toHaveLength(
    0,
  )
  expect(sent).toHaveLength(41)
  scope.stop()
})

it.each(['ttl', 'capacity'] as const)(
  'marks evicted %s observations incomplete and retains late errors',
  async (reason) => {
    diagnostics.startDiagnostics('browser')
    await settle()
    const context = diagnostics.diagnosticAction()
    const first = diagnostics.diagnosticPoll(
      'files',
      { torrentId: 'torrent001' },
      context,
    )
    await runtime.api.titles.getTitleFiles(
      'tmdb:tv:100',
      'torrent001',
      first.params(),
    )
    const firstId = counter
    if (reason === 'ttl')
      await vi.advanceTimersByTimeAsync(600_001)
    const neighbours = Array.from(
      { length: reason === 'capacity' ? 64 : 1 },
      () =>
        diagnostics.diagnosticPoll(
          'files',
          { torrentId: 'torrent002' },
          context,
        ),
    )
    const second = neighbours.at(-1)!
    await runtime.api.titles.getTitleFiles(
      'tmdb:tv:100',
      'torrent002',
      second.params(),
    )
    const secondId = counter
    await runtime.api.titles.getTitleFiles(
      'tmdb:tv:100',
      'torrent001',
      first.params(),
    )
    route = () => {
      throw new TypeError('offline')
    }
    const failed = runtime.api.titles
      .getTitleFiles('tmdb:tv:100', 'torrent001', first.params())
      .catch(() => undefined)
    await vi.advanceTimersByTimeAsync(301)
    await failed
    first.finish('failed')
    first.finish('accepted')
    second.finish('accepted')
    neighbours.forEach(poll => poll.finish('cancelled'))
    await deliver()
    const summaries = sent.filter(event => event.event === 'poll.summary')
    expect(summaries).toHaveLength(2)
    expect(summaries[0]).toMatchObject({
      torrentId: 'torrent001',
      outcome: 'failed',
      observationsComplete: false,
      incompleteReason: reason,
      requests: 3,
      attempts: 1,
      errors: 0,
      firstRequestId: `request-${String(firstId).padStart(8, '0')}`,
      lastRequestId: `request-${String(firstId).padStart(8, '0')}`,
    })
    expect(summaries[1]).toMatchObject({
      torrentId: 'torrent002',
      outcome: 'accepted',
      observationsComplete: true,
      requests: 1,
      attempts: 1,
      lastRequestId: `request-${String(secondId).padStart(8, '0')}`,
    })
    expect(
      sent.filter(
        event =>
          event.event === 'request.result' && event.outcome === 'network_error',
      ),
    ).toHaveLength(2)
    expect(
      sent.filter(
        event =>
          event.event === 'request.result' && event.outcome === 'accepted',
      ),
    ).toHaveLength(0)
    expect(sent.filter(event => event.event === 'request.result')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pollId: summaries[0]!.pollId }),
      ]),
    )
  },
)

it('drops an evicted old-profile summary while a new actor scope still reports', async () => {
  diagnostics.startDiagnostics('browser')
  await settle()
  const old = diagnostics.diagnosticAction()
  const first = diagnostics.diagnosticPoll('files', {}, old)
  await runtime.api.titles.getTitleFiles(
    'tmdb:tv:100',
    'torrent001',
    first.params(),
  )
  await vi.advanceTimersByTimeAsync(600_001)
  capability = async () => json({ ...status, profileId: 'profile-0002' })
  diagnostics.beforeDiagnosticProfileChange('profile-0002')
  diagnostics.diagnosticProfileChanged('profile-0002')
  await settle()
  const current = diagnostics.diagnosticAction()
  const second = diagnostics.diagnosticPoll('probe', {}, current)
  await runtime.api.playback.getPlayback('session-0001', second.params())
  first.finish('accepted')
  second.finish('accepted')
  await deliver()
  const summaries = sent.filter(event => event.event === 'poll.summary')
  expect(summaries).toHaveLength(1)
  expect(summaries[0]).toMatchObject({
    clientSessionId: current.clientSessionId,
    actionId: current.actionId,
    observationsComplete: true,
  })
  expect(current.clientSessionId).not.toBe(old.clientSessionId)
})

it.each(['delayed', 'disabled', 'enabled_later'] as const)(
  'keeps early files polling immediate and truthful while capability is %s',
  async (mode) => {
    let release!: (response: Response) => void
    capability
      = mode === 'delayed'
        ? () =>
            new Promise((resolve) => {
              release = resolve
            })
        : async () => json({ ...status, enabled: false, collecting: false })
    diagnostics.startDiagnostics('browser')
    const context = diagnostics.currentDiagnosticContext()
    let files = 0
    route = (url) => {
      if (url.includes('/open'))
        return json({ torrentId: 'torrent001' })
      files++
      return json({
        status: files === 1 ? 'resolving' : 'ready',
        files: [{ fileIndex: 0, season: 1, episode: 2, size: 100 }],
      })
    }
    const result = resolveEpisode(
      { titleId: 'tmdb:tv:100', season: 1, episode: 2 },
      {
        candidateId: 'a'.repeat(32),
        cancelled: () => false,
        diagnosticContext: context,
      },
    )
    await settle()
    expect(files).toBe(1) // No wait for diagnostics before the business request.
    expect(sent).toHaveLength(0)
    if (mode === 'delayed') {
      release(json(status))
      await settle()
    }
    if (mode === 'enabled_later') {
      capability = async () => json(status)
      diagnostics.diagnosticProfileChanged('profile-0001')
      await settle()
    }
    await vi.advanceTimersByTimeAsync(2100)
    expect((await result).kind).toBe('found')
    await deliver()
    if (mode === 'enabled_later')
      await vi.advanceTimersByTimeAsync(30_000)
    const fileRequests = requests.filter(item => item.url.includes('/files'))
    expect(fileRequests).toHaveLength(2)
    expect(
      new Headers(fileRequests[0]!.init.headers).has('X-Torsher-Poll-Id'),
    ).toBe(false)
    if (mode === 'disabled') {
      expect(sent).toHaveLength(0)
      return
    }
    expect(
      new Headers(fileRequests[1]!.init.headers).get('X-Torsher-Action-Id'),
    ).toBe(context.actionId)
    const summaries = sent.filter(event => event.event === 'poll.summary')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      observationsComplete: false,
      incompleteReason: 'not_instrumented',
      requests: 2,
      attempts: 1,
      errors: 0,
    })
    expect(summaries[0]!.firstRequestId).toBe(summaries[0]!.lastRequestId)
    expect(summaries[0]!.firstRequestId).toMatch(/^request-/)
  },
)
