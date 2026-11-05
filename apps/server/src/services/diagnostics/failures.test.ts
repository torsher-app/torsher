import { describe, expect, it } from 'vitest'
import { projectRecord } from '../logs/reportProjection.ts'
import { createFailureRecorder } from './failures.ts'

const start = Date.now()
function setup() {
  const records: Record<string, unknown>[] = []
  const recorder = createFailureRecorder((source, fields) =>
    records.push({ source, ...fields }),
  )
  const failure = (session: string, time = start, profileId = 'profile-0001') =>
    recorder.record(
      'playback',
      'transcode_failed',
      { profileId, actorKind: 'device', deviceId: 'device-0001', session },
      'instance-1',
      time,
    )
  return { records, recorder, failure }
}
describe('bounded server failure observations', () => {
  it('preserves first failures from separate sessions and explicitly summarizes repetitions', () => {
    const { records, recorder, failure } = setup()
    failure('playback-0001')
    failure('playback-0002')
    for (let i = 0; i < 20; i++) failure('playback-0001', start + i)
    expect(recorder.snapshot('instance-1', start + 500)[0]).toMatchObject({
      source: 'playback',
      suppressed: 20,
    })
    recorder.flush('instance-1', start + 1000)
    expect(recorder.snapshot('instance-1', start + 1001)).toEqual([])
    expect(
      records.filter(row => row.event === 'server.failure'),
    ).toHaveLength(2)
    expect(records.at(-1)).toMatchObject({
      event: 'server.failure_summary',
      suppressed: 20,
      session: 'playback-0001',
      suppressionReason: 'repeated',
      windowStartedAt: new Date(start).toISOString(),
      windowEndedAt: new Date(start + 1000).toISOString(),
    })
    const safe = projectRecord(
      { ...records.at(-1), time: start + 1000 },
      start + 2000,
      86400_000,
    )
    expect(safe.kind === 'event' && safe.value.facts.suppressed).toBe(20)
    recorder.flush('instance-1', start + 2000)
    expect(records).toHaveLength(3)
    failure('playback-0001', start + 60001)
    expect(records.at(-1)?.event).toBe('server.failure')
  })
  it('bounds key floods, reports overflow, and recovers capacity after the window', () => {
    const { records, recorder, failure } = setup()
    for (let i = 0; i < 10000; i++) failure(`session-${i}`)
    expect(records).toHaveLength(128)
    recorder.flush('instance-1', start + 1000)
    expect(records.at(-1)).toMatchObject({
      event: 'server.failure_summary',
      suppressionReason: 'capacity',
      suppressed: 9872,
    })
    failure('new-session', start + 60001)
    expect(records.at(-1)).toMatchObject({
      event: 'server.failure',
      session: 'new-session',
    })
  })
  it('does not merge actors or leak pending counters into a new instance', () => {
    const { records, recorder, failure } = setup()
    failure('playback-0001')
    failure('playback-0001', start, 'profile-0002')
    failure('playback-0001')
    recorder.flush('instance-2', start + 1000)
    expect(records).toHaveLength(2)
  })
})
