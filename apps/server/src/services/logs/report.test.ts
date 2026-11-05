import { Buffer } from 'node:buffer'
import {
  appendFileSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LogRing } from './ring.ts'
import { createReport, REPORT_LIMITS, ReportBusyError } from './report.ts'

const dirs: string[] = []
const storage = {
  serverInstance: 'current-instance',
  fileSinkState: 'enabled' as const,
  retentionState: 'ok' as const,
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'torsher-report-'))
  dirs.push(dir)
  const ring = new LogRing()
  return {
    dir,
    ring,
    options: {
      dir,
      storage,
      environment: { state: 'unknown' },
      visitRing: (visit: Parameters<LogRing['visitNewest']>[0]) =>
        ring.visitNewest(visit),
    },
  }
}
function event(extra: object = {}) {
  return `${JSON.stringify({ time: Date.now() - 1000, level: 30, source: 'playback', origin: 'server', event: 'playback.ready', session: 'playback-session', mode: 'hls', serverInstance: 'historic-instance', ...extra })}\n`
}
async function read(stream: ReturnType<typeof createReport>) {
  let text = ''
  for await (const chunk of stream) text += chunk.toString()
  return {
    text,
    rows: text
      .trim()
      .split('\n')
      .map(line => JSON.parse(line)),
  }
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('local support report', () => {
  it('pins inodes and sizes before rotation, supplements ring, preserves multiplicity on disk', async () => {
    const { dir, ring, options } = setup()
    const a = event()
    const b = event({ event: 'playback.closed', session: 'other-session' })
    writeFileSync(join(dir, 'torsher.log'), a + a)
    ring.push(a)
    ring.push(b)
    const stream = createReport(options)
    renameSync(join(dir, 'torsher.log'), join(dir, 'old.log'))
    appendFileSync(
      join(dir, 'old.log'),
      event({ session: 'after-cutoff-session' }),
    )
    writeFileSync(
      join(dir, 'torsher.log'),
      event({ session: 'replacement-session' }),
    )
    const { rows, text } = await read(stream)
    expect(rows.filter(row => row.type === 'event')).toHaveLength(3)
    expect(
      rows.filter(row => row.type === 'event' && row.source === 'disk'),
    ).toHaveLength(2)
    expect(text).not.toContain('replacement-session')
    expect(text).not.toContain('after-cutoff-session')
    expect(rows.at(-1).counters.exactCrossSourceDuplicates).toBe(1)
    expect(rows.at(-1).exportComplete).toBe(true)
    expect(rows[0].reportId).toBe(rows.at(-1).reportId)
    expect(
      rows.find(row => row.type === 'summary').sessions[0].serverInstances,
    ).toEqual(['historic-instance'])
  })

  it('excludes raw text/secrets at every historical and ring boundary', async () => {
    const { dir, ring, options } = setup()
    const sentinel
      = 'SECRET https://private.example/?token=SECRET /private/media/file.mkv'
    const lines = [
      event({
        msg: sentinel,
        err: { stack: sentinel },
        details: JSON.stringify({ reasons: ['ProbeFailed'], raw: sentinel }),
        url: sentinel,
        password: sentinel,
      }),
      event({ event: 'unrecognized.event', details: sentinel }),
      event({ event: 'playback.ready', mode: sentinel, titleId: sentinel }),
      event({
        origin: 'client',
        source: 'client',
        event: 'client.started',
        details: JSON.stringify({ event: 'client.started', message: sentinel }),
      }),
    ]
    writeFileSync(join(dir, 'torsher.log'), lines.join(''))
    lines.forEach(line => ring.push(line))
    const { text, rows } = await read(createReport(options))
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('private.example')
    expect(text).not.toContain('file.mkv')
    expect(text).toContain('ProbeFailed')
    expect(rows.at(-1).counters.omittedUnstructuredRecords).toBe(2)
    expect(rows.at(-1).coverage).toBe('partial')
  })

  it('counts malformed, oversized, partial, stale and future input separately with bounded lines', async () => {
    const { dir, options } = setup()
    writeFileSync(
      join(dir, 'torsher.log'),
      `bad json\n${'x'.repeat(2 * REPORT_LIMITS.line)}\n${event({ time: Date.now() - 8 * 86400_000 })}${event({ time: Date.now() + 100000 })}${event()}{unfinished`,
    )
    const { rows } = await read(createReport(options))
    expect(rows.filter(row => row.type === 'event')).toHaveLength(1)
    expect(rows.at(-1).counters).toMatchObject({
      invalidLines: 1,
      oversizedLines: 1,
      partialTrailingLines: 1,
      outsideWindowRecords: 2,
    })
  })

  it('reports ring-only history and unknown historic instance without inventing a current binding', async () => {
    const { ring, options } = setup()
    ring.push(event({ serverInstance: undefined }))
    const { rows } = await read(
      createReport({
        ...options,
        dir: undefined,
        storage: { ...storage, fileSinkState: 'disabled' },
      }),
    )
    expect(rows.at(-1).coverageReasons).toContain('disk_unavailable')
    const summary = rows.find(row => row.type === 'summary')
    expect(summary.sessions[0].serverInstances).toEqual([])
    expect(summary.sessions[0].clientDiagnostics).toBe(
      'not_observed_reason_unknown',
    )
    expect(summary.sessions[0].terminalObserved).toBe(false)
  })

  it('isolates per-source open and short-read errors and still emits a footer', async () => {
    const { dir, options } = setup()
    writeFileSync(join(dir, 'torsher.log'), event())
    const stream = createReport(options)
    writeFileSync(join(dir, 'torsher.log'), '')
    const { rows } = await read(stream)
    expect(rows.at(-1).coverageReasons).toContain('disk_short_read')
    const broken = await read(
      createReport({ ...options, dir: '/dev/null/not-a-directory' }),
    )
    expect(
      broken.rows
        .at(-1)
        .sources.every(
          (source: { state: string }) => source.state === 'open_error',
        ),
    ).toBe(true)
  })

  it('releases concurrency on cancellation before any consumption and after deadline', async () => {
    const { options } = setup()
    const first = createReport(options)
    expect(() => createReport(options)).toThrow(ReportBusyError)
    await new Promise<void>((resolve) => {
      first.once('close', resolve)
      first.destroy()
    })
    await read(createReport(options))
    const timed = createReport({ ...options, deadlineMs: 5 })
    const closed = new Promise<void>(resolve => timed.once('close', resolve))
    timed.on('error', () => {})
    await closed
    await read(createReport(options))
  })

  it('bounds safe ring and summary while retaining the latest records', async () => {
    const { ring, options } = setup()
    for (let i = 0; i < 5000; i++) {
      ring.push(
        event({
          profileId: 'profile-0001',
          actorKind: 'owner',
          session: `playback-${i.toString().padStart(8, '0')}`,
          actionId: i.toString().padStart(80, 'a'),
          parentActionId: 'b'.repeat(80),
          requestId: 'r'.repeat(80),
          details: JSON.stringify({ reasons: ['ProbeFailed'] }),
        }),
      )
    }
    const { rows, text } = await read(createReport(options))
    expect(rows[0].ring.bytes).toBeLessThanOrEqual(REPORT_LIMITS.ring)
    expect(rows.at(-1).counters.ringTruncatedRecords).toBeGreaterThan(0)
    expect(text).toContain('playback-00004999')
    const summary = rows.find(row => row.type === 'summary')
    expect(summary.sessions).toHaveLength(64)
    expect(summary.summaryTruncated).toBe(true)
    expect(summary.sessions[0].context).toBe('context_missing')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(26 * 1024 * 1024)
  })

  it('bounds maximum disk input and output including metadata', async () => {
    const { dir, ring, options } = setup()
    // More input than retention permits; huge lines must never accumulate in RAM.
    const line = event({ msg: 'x'.repeat(60000) })
    for (let i = 0; i < 5; i++) {
      writeFileSync(
        join(dir, i ? `torsher.${i}.log` : 'torsher.log'),
        line.repeat(90),
      )
    }
    ring.push(event({ session: 'ring-last-session' }))
    const { rows, text } = await read(createReport(options))
    expect(rows.at(-1).counters.inputBytes).toBe(REPORT_LIMITS.input)
    expect(rows.at(-1).coverageReasons).toContain('input_limit')
    expect(rows.at(-1).counters.historyBytes).toBeLessThanOrEqual(
      REPORT_LIMITS.history,
    )
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(26 * 1024 * 1024)
    expect(text).toContain('ring-last-session')
  })
  it('reserves ring history even when event envelopes exhaust the output budget', async () => {
    const { dir, ring, options } = setup()
    const line = `${JSON.stringify({ time: Date.now() - 1000, origin: 'server', event: 'playback.ready' })}\n`
    const segment = line.repeat(
      Math.floor((5 * 1024 * 1024) / Buffer.byteLength(line)),
    )
    for (let i = 0; i < 5; i++)
      writeFileSync(join(dir, i ? `torsher.${i}.log` : 'torsher.log'), segment)
    ring.push(event({ session: 'reserved-ring-session' }))
    const stream = createReport(options)
    let bytes = 0
    let last = ''
    let sawRing = false
    for await (const chunk of stream) {
      bytes += chunk.length
      last = chunk.toString()
      sawRing ||= last.includes('reserved-ring-session')
    }
    const footer = JSON.parse(last.trim().split('\n').at(-1)!)
    expect(footer.coverageReasons).toContain('history_limit')
    expect(footer.counters.historyBytes).toBeLessThanOrEqual(
      REPORT_LIMITS.history,
    )
    expect(bytes).toBeLessThanOrEqual(26 * 1024 * 1024)
    expect(sawRing).toBe(true)
  }, 15000)
})
