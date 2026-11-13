import { text } from 'node:stream/consumers'
import * as playbackSessions from '../services/media/sessions.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { migrateDb } from '../db/index.ts'
import {
  closeLogFiles,
  createLogger,
  exportLog,
  installLogger,
  logFor,
  queryLogs,
  setLogLevel,
} from '../services/logs/index.ts'
import { setSetting } from '../services/settings/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
let cookies: Record<string, string>
let profileId: string
let dir: string
const clientSessionId = 'test-session-1234'
function payload(seq = 1) {
  return {
    schemaVersion: 1,
    deviceId: null,
    profileId,
    events: [
      {
        event: 'player.back',
        eventId: `${clientSessionId}:${seq}`,
        clientSessionId,
        clientSeq: seq,
        clientTime: new Date().toISOString(),
        elapsedMs: 20,
        actionId: 'test-action-1234',
        outcome: 'exit',
      },
    ],
  }
}
function post(body: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/diagnostics/events',
    cookies,
    payload: body as object,
    headers,
  })
}
beforeAll(async () => {
  await migrateDb()
  const user = createOwner({ username: 'Owner', passwordHash: 'x' })
  cookies = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
  profileId = (await app.inject({ url: '/api/diagnostics', cookies })).json().profileId
})
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torsher-diagnostics-'))
  installLogger(
    createLogger({
      level: 'info',
      logsDir: dir,
      stdout: { write: () => true },
    }),
  )
  setSetting('userActionDiagnostics', true)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await closeLogFiles()
  installLogger(pino({ level: 'silent' }))
  rmSync(dir, { recursive: true, force: true })
})
afterAll(() => app.close())

describe('diagnostic receiver', () => {
  it('binds actor, accepts only after ring and deduplicates', async () => {
    const body = payload(1)
    const first = await post(body)
    expect(first.statusCode).toBe(200)
    expect(first.json().accepted).toEqual([body.events[0]!.eventId])
    expect(first.json().fileSinkState).toBe('enabled')
    const entry = queryLogs({ q: body.events[0]!.eventId }).entries[0]!
    expect(entry.source).toBe('client')
    expect(entry.context).toMatchObject({
      profileId,
      origin: 'client',
      actionId: 'test-action-1234',
    })
    expect((await post(body)).json().duplicate).toEqual([
      body.events[0]!.eventId,
    ])
    expect(
      (await post({ ...payload(2), profileId: 'different-profile' }))
        .statusCode,
    ).toBe(409)
  })
  it('disabled and filtered events are not falsely accepted or deduped', async () => {
    const body = payload(10)
    setSetting('userActionDiagnostics', false)
    expect((await post(body)).json().rejected[0].code).toBe('disabled')
    setSetting('userActionDiagnostics', true)
    setLogLevel('warn')
    expect((await post(body)).json().rejected[0].code).toBe('level_filtered')
    setLogLevel('info')
    expect((await post(body)).json().accepted).toEqual([
      body.events[0]!.eventId,
    ])
  })
  it('rejects foreign origin, unknown payload and mismatched event ids without echo', async () => {
    expect(
      (await post(payload(20), { origin: 'https://foreign.invalid' }))
        .statusCode,
    ).toBe(403)
    const body = payload(21)
    const invalid = {
      ...body,
      events: [{ ...body.events[0], message: 'SECRET magnet:?xt=bad' }],
    }
    const response = await post(invalid)
    expect(response.statusCode).toBe(400)
    expect(response.body).not.toContain('SECRET')
    expect(queryLogs({ q: 'SECRET' }).entries).toEqual([])
    expect(
      (
        await post({
          ...body,
          events: [{ ...body.events[0], eventId: `${clientSessionId}:999` }],
        })
      ).json().rejected[0].code,
    ).toBe('invalid_event')
    expect(
      (
        await post({
          ...body,
          events: Array.from({ length: 17 }).fill(body.events[0]),
        })
      ).statusCode,
    ).toBe(400)
    expect((await post({ secret: 'x'.repeat(33 * 1024) })).statusCode).toBe(
      413,
    )
  })
  it('accepts in memory if files cannot open; ACK does not claim durability', async () => {
    await closeLogFiles()
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, '')
    installLogger(
      createLogger({
        level: 'info',
        logsDir: join(blocker, 'logs'),
        stdout: { write: () => true },
      }),
    )
    const response = await post(payload(30))
    expect(response.json()).toMatchObject({
      accepted: [`${clientSessionId}:30`],
      fileSinkState: 'disabled',
    })
  })
  it('generates distinct request UUIDs across app launches with retained logs', async () => {
    const request = await app.inject({
      url: '/api/health',
      headers: { 'request-id': 'forged', 'x-torsher-request-id': 'forged' },
    })
    const first = request.headers['x-torsher-request-id'] as string
    logFor('catalog').info({ requestId: first }, 'First request')
    await closeLogFiles()
    installLogger(
      createLogger({
        level: 'info',
        logsDir: dir,
        stdout: { write: () => true },
      }),
    )
    const secondApp = createApp()
    const second = (await secondApp.inject({ url: '/api/health' })).headers[
      'x-torsher-request-id'
    ] as string
    await secondApp.close()
    expect(first).toMatch(/^[a-f0-9-]{36}$/)
    expect(second).not.toBe(first)
    logFor('catalog').info({ requestId: second }, 'Second request')
    expect(queryLogs({ q: first }).entries.map(item => item.message)).toEqual(
      ['First request'],
    )
    expect(
      queryLogs({ q: second }).entries.map(item => item.message),
    ).toEqual(['Second request'])
    await closeLogFiles()
    const exported = await text(exportLog())
    expect(exported.split('\n').find(line => line.includes(first))).toContain(
      'First request',
    )
    expect(
      exported.split('\n').find(line => line.includes(second)),
    ).toContain('Second request')
  })
})

it('rejects a foreign live session, trusts only owned live sessions, and preserves closed references', async () => {
  const state = vi.spyOn(playbackSessions, 'diagnosticSessionState')
  const body = payload(40)
  const withSession = {
    ...body,
    events: [{ ...body.events[0], session: 'session-12345678' }],
  }
  state.mockReturnValue('foreign')
  expect((await post(withSession)).json().rejected[0].code).toBe(
    'invalid_event',
  )
  state.mockReturnValue('owned')
  expect((await post(withSession)).json().accepted).toEqual([
    body.events[0]!.eventId,
  ])
  expect(
    queryLogs({ q: body.events[0]!.eventId }).entries[0]!.context,
  ).toMatchObject({ session: 'session-12345678', sessionBinding: 'owned' })
  state.mockReturnValue('closed')
  const closed = payload(41)
  await post({
    ...closed,
    events: [{ ...closed.events[0], session: 'session-12345678' }],
  })
  const entry = queryLogs({ q: closed.events[0]!.eventId }).entries[0]!
  expect(entry.context?.session).toBeUndefined()
  expect(entry.context?.reportedSession).toBe('session-12345678')
})

it('keeps bounded rank facts outside server top three explicitly client reported', async () => {
  const base = payload(50)
  const event = {
    ...base.events[0],
    event: 'source.resolve',
    outcome: 'ready',
    branch: 'ranked_candidate',
    rankingDecisionId: 'decision-12345678',
    candidates: [
      {
        candidateId: '0123456789abcdef',
        diagnostics: { rank: 4, score: 120 },
        confidence: 'high',
        seeders: 10,
        quality: '720p',
        resolution: { value: '720p', basis: 'title', sure: true },
        coversEpisode: true,
      },
    ],
  }
  const response = await post({ ...base, events: [event] })
  expect(response.json().accepted).toEqual([event.eventId])
  const entry = queryLogs({ q: event.eventId }).entries[0]!
  expect(entry.context).toMatchObject({
    rankingDecisionId: 'decision-12345678',
    origin: 'client',
  })
  expect(JSON.parse(entry.details!).candidates[0].diagnostics.rank).toBe(4)
})

it('expires idle actor buckets below capacity and aggregates rejection noise once a minute', async () => {
  const { createDiagnosticReceiver }
    = await import('../services/diagnostics/index.ts')
  vi.useFakeTimers()
  const receiver = createDiagnosticReceiver()
  const deleted = vi.spyOn(Map.prototype, 'delete')
  try {
    expect(receiver.limited('idle-actor-for-expiry', 1)).toBe(false)
    expect(receiver.limited('burst-actor', 64)).toBe(false)
    for (let i = 0; i < 20; i++)
      expect(receiver.limited('burst-actor', 1)).toBe(true)
    expect(queryLogs({ q: 'diagnostics.rate_limit' }).entries).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(deleted).toHaveBeenCalledWith('idle-actor-for-expiry')
    const entries = queryLogs({ q: 'diagnostics.rate_limit' }).entries
    expect(entries).toHaveLength(1)
    expect(entries[0]?.context).toMatchObject({
      rejectedEvents: 20,
      rejectedBatches: 20,
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(queryLogs({ q: 'diagnostics.rate_limit' }).entries).toHaveLength(1)
    // The global bucket is shared across distinct actors.
    for (let i = 0; i < 1000; i++)
      expect(receiver.limited(`global-${i}`, 1)).toBe(false)
    expect(receiver.limited('global-extra', 1)).toBe(true)
  }
  finally {
    receiver.clear()
    deleted.mockRestore()
    vi.useRealTimers()
  }
})

it('binds client startup to trusted server version and instance', async () => {
  const { config } = await import('../config.ts')
  const base = payload(900)
  const { outcome: _outcome, ...common } = base.events[0]!
  const response = await post({
    ...base,
    events: [
      {
        ...common,
        event: 'client.started',
        clientKind: 'browser',
        tvBuildId: 'fixture-tv-build',
      },
    ],
  })
  expect(response.statusCode).toBe(200)
  expect(response.json().accepted).toHaveLength(1)
  const entry = queryLogs({ q: common.eventId }).entries[0]!
  expect(entry.context).toMatchObject({
    tvBuildId: 'fixture-tv-build',
    serverVersion: config.version,
    serverInstance: response.json().serverInstance,
  })
})

describe('optional support facts', () => {
  it('advertises an additive capability while still accepting v1 events', async () => {
    expect(
      (await app.inject({ url: '/api/diagnostics', cookies })).json(),
    ).toMatchObject({ schemaVersion: 1, supportFacts: 1, playbackNetwork: 1 })
    expect((await post(payload(501))).json().accepted).toEqual([
      `${clientSessionId}:501`,
    ])
  })
  it('accepts a maximum media/error observation with full correlation IDs and safely exports it', async () => {
    const id = 'x'.repeat(80)
    const common = {
      eventId: `${id}:999999999999`,
      clientSessionId: id,
      clientSeq: 999999999999,
      clientTime: new Date().toISOString(),
      elapsedMs: 31536000000,
      actionId: id,
      parentActionId: id,
      clientRequestId: id,
      requestId: id,
      session: id,
    }
    const media = {
      state: 'available',
      source: 'html_video',
      position: 31536000,
      duration: 31536000,
      paused: false,
      ended: false,
      seeking: true,
      readyState: 4,
      networkState: 3,
      buffered: Array.from({ length: 4 }, () => ({
        start: 31535900,
        end: 31536000,
      })),
      width: 16384,
      height: 16384,
      droppedFrames: 1000000,
      totalFrames: 1000000,
      audioTrack: 1000,
      subtitleTrack: 1000,
      audioCodec: 'unknown',
      audioLanguage: 'unknown',
      mode: 'hls',
      video: 'encode',
      audio: 'aac',
      hls: 'recovering',
      native: 'unsupported',
      reasons: [
        'ContainerNotSupported',
        'VideoCodecNotSupported',
        'VideoBitDepthNotSupported',
        'AudioCodecNotSupported',
        'AudioTrackSwitchNotSupported',
        'SubtitleCodecNotSupported',
        'HlsNotSupported',
        'ToolsMissing',
        'ProbeFailed',
        'DurationUnknown',
      ],
    }
    const event = {
      ...common,
      event: 'client.error',
      tvBuildId: 'b'.repeat(80),
      source: 'hls',
      code: 'hls_network',
      locations: Array.from({ length: 4 }, () => ({
        assetId: 'a'.repeat(64),
        line: 10000000,
        column: 10000000,
      })),
      droppedLocations: 1000000,
      media,
    }
    const network = {
      torrentId: id,
      fileIndex: 1_000_000,
      stats: {
        state: 'stale',
        ageMs: 31_536_000_000,
        offsetBytes: Number.MAX_SAFE_INTEGER,
        downloadBytesPerSecond: 1_000_000_000_000,
        peersConnected: 1_000_000,
        seedersConnected: 1_000_000,
        peersFound: 1_000_000,
        bufferedAheadBytes: Number.MAX_SAFE_INTEGER,
        estimatedBufferedAheadSeconds: 31_536_000,
      },
      clientBuffer: { state: 'available', aheadSeconds: 31_536_000 },
    }
    const snapshot = {
      ...common,
      eventId: `${id}:999999999998`,
      clientSeq: 999999999998,
      event: 'playback.snapshot',
      trigger: 'buffering',
      media,
      network,
    }
    const legacy = {
      ...snapshot,
      eventId: `${id}:999999999997`,
      clientSeq: 999999999997,
      network: undefined,
    }
    const res = await post({
      schemaVersion: 1,
      profileId,
      deviceId: null,
      events: [event, snapshot, legacy],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().rejected).toEqual([])
    expect(res.json().accepted).toEqual([
      event.eventId,
      snapshot.eventId,
      legacy.eventId,
    ])
    const report = await app.inject({
      url: '/api/logs/download?format=report',
      cookies,
    })
    const rows = report.body
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(
      rows.find(row => row.type === 'event' && row.event === 'client.error')
        .diagnostic.media,
    ).toEqual(media)
    const observed = rows.find(
      row =>
        row.type === 'event' && row.diagnostic?.eventId === snapshot.eventId,
    )
    expect(observed.origin).toBe('client')
    expect(observed.diagnostic).toEqual(snapshot)
    expect(observed.facts).not.toHaveProperty('stats')
    expect(observed.facts).not.toHaveProperty('downloadBytesPerSecond')
    const journal = queryLogs({}).entries.find(
      row => row.context?.eventId === snapshot.eventId,
    )
    expect(JSON.parse(journal!.details!)).toEqual(snapshot)
    expect(
      rows.find(row => row.diagnostic?.eventId === legacy.eventId).diagnostic,
    ).not.toHaveProperty('network')
  })
  it('rejects raw error text and asset URLs before journal ingestion', async () => {
    const base = payload(502).events[0]!
    const { outcome: _outcome, ...common } = base
    const body = {
      schemaVersion: 1,
      profileId,
      deviceId: null,
      events: [
        {
          ...common,
          event: 'client.error',
          tvBuildId: 'build-1',
          source: 'runtime',
          code: 'type_error',
          locations: [],
          droppedLocations: 0,
          message: 'PRIVATE_MESSAGE',
        },
      ],
    }
    expect((await post(body)).statusCode).toBe(400)
    expect(JSON.stringify(queryLogs({}))).not.toContain('PRIVATE_MESSAGE')
  })
})

it('joins receiver-owned playback with server observations without treating ingest IDs as business IDs', async () => {
  vi.spyOn(playbackSessions, 'diagnosticSessionState').mockReturnValue('owned')
  const event = {
    event: 'client.error',
    eventId: `${clientSessionId}:601`,
    clientSessionId,
    clientSeq: 601,
    clientTime: new Date().toISOString(),
    elapsedMs: 10,
    session: 'session-12345678',
    tvBuildId: 'build-1',
    source: 'media',
    code: 'media_decode',
    locations: [],
    droppedLocations: 0,
    requestId: 'request-business-1',
  }
  const ack = await post({
    schemaVersion: 1,
    deviceId: null,
    profileId,
    events: [event],
  })
  expect(ack.json().accepted).toEqual([event.eventId])
  logFor('playback').info(
    {
      event: 'playback.closed',
      origin: 'server',
      profileId,
      actorKind: 'owner',
      session: event.session,
      serverInstance: ack.json().serverInstance,
    },
    'playback.closed',
  )
  const report = await app.inject({
    url: '/api/logs/download?format=report',
    cookies,
  })
  const summary = report.body
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
    .find(row => row.type === 'summary')
  expect(summary.sessions).toHaveLength(1)
  expect(summary.sessions[0]).toMatchObject({
    hasClientEvents: true,
    hasServerPlayback: true,
  })
  expect(summary.recentErrors[0]).toMatchObject({
    reportedRequestId: event.requestId,
    ingestRequestId: ack.headers['x-torsher-request-id'],
    origin: 'client',
  })
  expect(summary.recentErrors[0].requestId).toBeUndefined()
})
