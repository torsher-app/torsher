import { describe, expect, it } from 'vitest'
import { diagnosticEvent } from '../../dto/diagnostics.ts'
import { projectRecord } from './reportProjection.ts'
import { ReportSummary } from './reportSummary.ts'

const now = Date.now()
const actor = {
  profileId: 'profile-0001',
  actorKind: 'device',
  deviceId: 'device-0001',
}
function client(
  seq: number,
  extra: object = {},
  facts: object = {},
  time = now,
) {
  const diagnostic = diagnosticEvent.parse({
    event: 'client.error',
    clientSessionId: 'client-0001',
    eventId: `client-0001:${seq}`,
    clientSeq: seq,
    clientTime: new Date(time).toISOString(),
    elapsedMs: seq,
    tvBuildId: 'new-build',
    source: 'media',
    code: 'media_decode',
    locations: [],
    droppedLocations: 0,
    session: 'playback-0001',
    requestId: 'request-business',
    ...extra,
  })
  const projected = projectRecord(
    {
      time,
      source: 'client',
      origin: 'client',
      event: diagnostic.event,
      ...actor,
      serverInstance: 'instance-current',
      serverVersion: '1.2.1',
      sessionBinding: 'owned',
      session: 'playback-0001',
      requestId: 'request-ingest',
      ...facts,
      details: JSON.stringify(diagnostic),
    },
    now + 1000,
    7 * 86400_000,
  )
  if (projected.kind !== 'event')
    throw new Error('Invalid fixture')
  return projected.value
}
function server(facts: object = {}, time = now) {
  const projected = projectRecord(
    {
      time,
      origin: 'server',
      event: 'playback.closed',
      ...actor,
      serverInstance: 'instance-current',
      session: 'playback-0001',
      requestId: 'request-server',
      ...facts,
    },
    now + 1000,
    7 * 86400_000,
  )
  if (projected.kind !== 'event')
    throw new Error('Invalid fixture')
  return projected.value
}

describe('report summary trust and historical order', () => {
  it.each([true, false])(
    'joins actor-owned playback regardless of scan order: client first %s',
    (clientFirst) => {
      const summary = new ReportSummary()
      const events = [client(2), server()]
      for (const event of clientFirst ? events : events.reverse())
        summary.add(event, 'disk')
      const result = summary.result()
      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0]).toMatchObject({
        hasClientEvents: true,
        hasServerPlayback: true,
        clientDiagnostics: 'observed',
      })
      expect(result.recentErrors[0]).toMatchObject({
        origin: 'client',
        ingestRequestId: 'request-ingest',
        reportedRequestId: 'request-business',
      })
      expect(result.recentErrors[0]?.requestId).toBeUndefined()
      expect(
        result.sessions[0]?.lastObservations.find(
          item => item.origin === 'server',
        ),
      ).toMatchObject({ requestId: 'request-server' })
    },
  )

  it('merges two existing groups only when an owned playback observation bridges them', () => {
    const summary = new ReportSummary()
    summary.add(
      client(
        1,
        { session: undefined },
        { session: undefined, sessionBinding: undefined },
      ),
      'disk',
    )
    summary.add(server(), 'disk')
    summary.add(client(2), 'ring')
    expect(summary.result().sessions).toHaveLength(1)
    expect(summary.result().sessions[0]?.sources).toEqual(['disk', 'ring'])
  })

  it('links an explicitly correlated server action without using a profile as the join key', () => {
    const summary = new ReportSummary()
    summary.add(
      client(
        1,
        { session: undefined, actionId: 'action-00001' },
        { session: undefined, sessionBinding: undefined },
      ),
      'disk',
    )
    summary.add(
      server({
        event: 'request.completed',
        session: undefined,
        actionId: 'action-00001',
      }),
      'disk',
    )
    summary.add(
      server({
        event: 'request.completed',
        session: undefined,
        actionId: 'action-00002',
      }),
      'disk',
    )
    expect(summary.result().sessions).toHaveLength(2)
    expect(
      summary.result().sessions.find(item => item.hasClientEvents)?.lastObservations,
    ).toHaveLength(2)
  })

  it('does not join a server-observed unknown session reference to an owned playback within the same actor', () => {
    const summary = new ReportSummary()
    summary.add(
      server({
        event: 'server.failure',
        code: 'playback_not_found',
        session: undefined,
        reportedSession: 'playback-0001',
        clientSessionId: 'unknown-client-0001',
      }),
      'disk',
    )
    summary.add(server(), 'disk')
    const result = summary.result()
    expect(result.sessions).toHaveLength(2)
    expect(
      result.sessions.find(session =>
        session.id.includes('unknown-client-0001'),
      )?.hasServerPlayback,
    ).toBe(false)
    expect(result.recentErrors[0]).toMatchObject({
      origin: 'server',
      reportedSession: 'playback-0001',
    })
    expect(result.recentErrors[0]?.session).toBeUndefined()
  })

  it.each(['closed', 'foreign'])(
    'does not promote a %s reported session into an owned join',
    (binding) => {
      const summary = new ReportSummary()
      // Even a malformed historical scalar session cannot override the binding.
      summary.add(client(2, {}, { sessionBinding: binding }), 'disk')
      summary.add(server(), 'disk')
      expect(summary.result().sessions).toHaveLength(2)
      expect(summary.result().recentErrors[0]?.session).toBeUndefined()
      expect(summary.result().recentErrors[0]?.reportedSession).toBe(
        'playback-0001',
      )
    },
  )

  it('isolates spoofed client and playback IDs across trusted devices and profiles', () => {
    const summary = new ReportSummary()
    summary.add(client(2), 'disk')
    summary.add(client(3, {}, { deviceId: 'device-0002' }), 'disk')
    summary.add(server({ deviceId: 'device-0002' }), 'disk')
    summary.add(client(4, {}, { profileId: 'profile-0002' }), 'disk')
    const sessions = summary.result().sessions
    expect(sessions).toHaveLength(3)
    expect(
      sessions.filter(session => session.hasServerPlayback),
    ).toHaveLength(1)
    expect(new Set(sessions.map(session => session.id)).size).toBe(3)
  })

  it('keeps the newest observed version and reports instance truncation without inventing a binding', () => {
    const summary = new ReportSummary()
    summary.add(client(2), 'disk')
    const old = client(
      1,
      {},
      { serverVersion: '1.2.0', serverInstance: undefined },
      now - 1000,
    )
    summary.add(old, 'disk')
    for (let i = 0; i < 10; i++) {
      summary.add(
        client(
          i + 3,
          {},
          { serverVersion: '1.1.0', serverInstance: `instance-${i}` },
          now - 2000,
        ),
        'disk',
      )
    }
    const result = summary.result()
    expect(result.sessions[0]?.versions.serverVersion).toBe('1.2.1')
    expect(result.sessions[0]?.versionFacts.serverVersion).toMatchObject({
      observedAt: new Date(now).toISOString(),
      origin: 'server',
      serverInstance: 'instance-current',
    })
    expect(result.sessions[0]?.serverInstances).toHaveLength(8)
    expect(result.sessions[0]?.serverInstancesTruncated).toBe(true)
    expect(result.summaryTruncated).toBe(true)
    const historical = new ReportSummary()
    historical.add(old, 'disk')
    expect(historical.result().sessions[0]?.serverInstances).toEqual([])
    expect(
      historical.result().sessions[0]?.versionFacts.serverVersion?.serverInstance,
    ).toBeUndefined()
  })
})
