import type { LogEntry } from './ring.ts'
import type { ReportEvent } from './reportProjection.ts'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, createReadStream, fstatSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { logFileName } from './files.ts'
import { LOG_RETENTION_MS } from './ring.ts'
import {
  canonical,
  projectRecord,
  projectRingEntry,
} from './reportProjection.ts'
import { ReportSummary } from './reportSummary.ts'

export const REPORT_LIMITS = {
  input: 25 * 1024 * 1024,
  history: 25 * 1024 * 1024,
  ring: 1024 * 1024,
  metadata: 1024 * 1024,
  line: 64 * 1024,
  deadlineMs: 30_000,
} as const
let active = false
export class ReportBusyError extends Error {
  constructor() {
    super('A support report is already being exported')
  }
}
interface Options {
  dir?: string
  visitRing: (visit: (entry: LogEntry) => void) => void
  storage: {
    serverInstance: string
    fileSinkState: 'enabled' | 'disabled'
    retentionState: 'ok' | 'degraded'
  }
  environment: object
  ringWindow?: {
    oldest: string | null
    newest: string | null
    capacity: number
    retained: number
    evicted: boolean
  }
  // Tests can shorten the deadline, never enlarge resource limits.
  deadlineMs?: number
}
interface Source {
  segment: number
  fd?: number
  size: number
  readBytes: number
  state:
    'pinned' | 'missing' | 'open_error' | 'read_error' | 'read' | 'limited'
}

/** Synchronously pins sources, sizes and the safe ring before returning a stream. */
export function createReport(options: Options) {
  if (active)
    throw new ReportBusyError()
  active = true
  const cutoffAt = Date.now()
  const reportId = randomUUID()
  const sources: Source[] = []
  const counters = {
    invalidLines: 0,
    oversizedLines: 0,
    partialTrailingLines: 0,
    omittedUnstructuredRecords: 0,
    outsideWindowRecords: 0,
    ringInvalidRecords: 0,
    ringOmittedUnstructuredRecords: 0,
    ringTruncatedRecords: 0,
    exactCrossSourceDuplicates: 0,
    inputBytes: 0,
    historyBytes: 0,
    includedDiskRecords: 0,
    includedRingRecords: 0,
  }
  const reasons = new Set<string>()
  let input: ReturnType<typeof createReadStream> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let released = false
  const release = () => {
    if (released)
      return
    released = true
    clearTimeout(timer)
    const reading = input
    for (const source of sources) {
      if (source.fd !== undefined) {
        try {
          closeSync(source.fd)
        }
        catch {}
        source.fd = undefined
      }
    }
    if (reading && !reading.closed) {
      // ReadStream waits for pending fs.read before closing its owned fd.
      // Keep the process guard until that close, preventing fd reuse races.
      reading.once('close', () => {
        active = false
      })
      reading.destroy()
    }
    else {
      active = false
    }
  }
  const envelope = (type: string, data: object) =>
    `${JSON.stringify({ type, reportId, reportSchemaVersion: 1, ...data })}\n`
  const ring: {
    event: ReportEvent
    key: string
    line: string
    matched: boolean
  }[] = []
  let ringBytes = 0
  let ringFull = false
  try {
    for (let segment = 0; segment < 5; segment++) {
      const source: Source = {
        segment,
        size: 0,
        readBytes: 0,
        state: 'missing',
      }
      sources.push(source)
      if (!options.dir)
        continue
      try {
        source.fd = openSync(join(options.dir, logFileName(segment)), 'r')
        const stat = fstatSync(source.fd)
        if (!stat.isFile())
          throw new Error('Not a regular log segment')
        source.size = stat.size
        source.state = 'pinned'
      }
      catch (err) {
        if (source.fd !== undefined) {
          closeSync(source.fd)
          source.fd = undefined
        }
        source.state
          = (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'missing'
            : 'open_error'
        if (source.state === 'open_error')
          reasons.add('disk_open_error')
      }
    }
    // The visitor walks newest first. Retain only the newest safe records.
    options.visitRing((entry) => {
      if (ringFull) {
        counters.ringTruncatedRecords++
        return
      }
      const projected = projectRingEntry(entry, cutoffAt, LOG_RETENTION_MS)
      if (projected.kind !== 'event') {
        if (projected.kind === 'invalid')
          counters.ringInvalidRecords++
        if (projected.kind === 'unstructured')
          counters.ringOmittedUnstructuredRecords++
        return
      }
      const line = envelope('event', { source: 'ring', ...projected.value })
      const bytes = Buffer.byteLength(line)
      if (ring.length >= 5000 || ringBytes + bytes > REPORT_LIMITS.ring) {
        counters.ringTruncatedRecords++
        ringFull = true
        return
      }
      ring.push({
        event: projected.value,
        line,
        key: createHash('sha256')
          .update(canonical(projected.value))
          .digest('hex'),
        matched: false,
      })
      ringBytes += bytes
    })
  }
  catch (error) {
    release()
    throw error
  }
  if (counters.ringTruncatedRecords)
    reasons.add('ring_projection_limit')
  if (!sources.some(source => source.state === 'pinned'))
    reasons.add('disk_unavailable')
  if (options.storage.fileSinkState === 'disabled')
    reasons.add('file_sink_disabled_at_export')
  if (options.storage.retentionState === 'degraded')
    reasons.add('retention_degraded_at_export')
  const matches = new Map<string, number[]>()
  ring.forEach((entry, index) => {
    const indexes = matches.get(entry.key) ?? []
    indexes.push(index)
    matches.set(entry.key, indexes)
  })
  const summary = new ReportSummary()
  let metadataBytes = 0
  const metadata = (type: string, data: object) => {
    const line = envelope(type, data)
    metadataBytes += Buffer.byteLength(line)
    if (metadataBytes > REPORT_LIMITS.metadata)
      throw new Error('Support report metadata limit')
    return line
  }
  async function* lines() {
    try {
      yield metadata('manifest', {
        cutoffAt: new Date(cutoffAt).toISOString(),
        requestedWindow: {
          from: new Date(cutoffAt - LOG_RETENTION_MS).toISOString(),
          to: new Date(cutoffAt).toISOString(),
        },
        order: 'newer_segments_first_not_strict_chronology',
        countersScope: 'this_export_only',
        countersStartedAt: new Date(cutoffAt).toISOString(),
        limits: REPORT_LIMITS,
        storage: {
          ...options.storage,
          observedAt: new Date(cutoffAt).toISOString(),
          source: 'current_server',
          state: 'available',
        },
        environment: options.environment,
        sources: sources.map(({ segment, size, state }) => ({
          segment,
          pinnedBytes: size,
          state,
        })),
        ring: {
          records: ring.length,
          bytes: ringBytes,
          window: options.ringWindow,
        },
        limitations: [
          'client_coverage_unknown',
          'before_negotiation_not_observed',
          'current_state_is_not_historical_state',
          'cross_tab_persistent_quota_not_atomic',
          'no_source_line_mapping',
          'no_previous_run_crash_inference',
        ],
      })
      const diskBudget = REPORT_LIMITS.history - ringBytes
      for (const source of sources) {
        if (source.fd === undefined || !source.size)
          continue
        const remaining = REPORT_LIMITS.input - counters.inputBytes
        if (remaining <= 0) {
          source.state = 'limited'
          reasons.add('input_limit')
          continue
        }
        const size = Math.min(source.size, remaining)
        if (size < source.size) {
          source.state = 'limited'
          reasons.add('input_limit')
        }
        input = createReadStream('', {
          fd: source.fd,
          autoClose: true,
          start: 0,
          end: size - 1,
          highWaterMark: 32 * 1024,
        })
        source.fd = undefined // Ownership transfers to ReadStream, including cancellation.
        const closed = new Promise<void>(resolve =>
          input!.once('close', resolve),
        )
        let pending = Buffer.alloc(0)
        let oversized = false
        const consume = (line: Buffer) => {
          let raw: unknown
          try {
            raw = JSON.parse(line.toString('utf8'))
          }
          catch {
            counters.invalidLines++
            return
          }
          const projected = projectRecord(raw, cutoffAt, LOG_RETENTION_MS)
          if (projected.kind !== 'event') {
            if (projected.kind === 'invalid')
              counters.invalidLines++
            if (projected.kind === 'unstructured')
              counters.omittedUnstructuredRecords++
            if (projected.kind === 'outside_window')
              counters.outsideWindowRecords++
            return
          }
          const result = envelope('event', {
            source: 'disk',
            ...projected.value,
          })
          const bytes = Buffer.byteLength(result)
          if (counters.historyBytes + bytes > diskBudget) {
            reasons.add('history_limit')
            return
          }
          counters.historyBytes += bytes
          counters.includedDiskRecords++
          summary.add(projected.value, 'disk')
          if (matches.size) {
            const safe = canonical(projected.value)
            const key = createHash('sha256').update(safe).digest('hex')
            const candidates = matches.get(key)
            const match
              = candidates?.findIndex(
                index => canonical(ring[index]!.event) === safe,
              ) ?? -1
            if (candidates && match !== -1) {
              const index = candidates.splice(match, 1)[0]!
              ring[index]!.matched = true
              counters.exactCrossSourceDuplicates++
              if (!candidates.length)
                matches.delete(key)
            }
          }
          return result
        }
        try {
          for await (const chunk of input as AsyncIterable<Buffer>) {
            counters.inputBytes += chunk.length
            source.readBytes += chunk.length
            let start = 0
            while (start < chunk.length) {
              const newline = chunk.indexOf(10, start)
              const end = newline === -1 ? chunk.length : newline
              const piece = chunk.subarray(start, end)
              if (!oversized) {
                if (pending.length + piece.length > REPORT_LIMITS.line) {
                  counters.oversizedLines++
                  oversized = true
                  pending = Buffer.alloc(0)
                }
                else {
                  pending = pending.length
                    ? Buffer.concat([pending, piece])
                    : Buffer.from(piece)
                }
              }
              if (newline !== -1) {
                if (!oversized && pending.length) {
                  const line = consume(pending)
                  if (line)
                    yield line
                }
                pending = Buffer.alloc(0)
                oversized = false
              }
              start = end + 1
            }
          }
          if (pending.length || oversized)
            counters.partialTrailingLines++
          if (source.readBytes < size) {
            source.state = 'read_error'
            reasons.add('disk_short_read')
          }
          else if (source.state === 'pinned') {
            source.state = 'read'
          }
        }
        catch {
          source.state = 'read_error'
          reasons.add('disk_read_error')
        }
        finally {
          input.destroy()
          await closed
          input = undefined
        }
      }
      for (const entry of ring) {
        if (entry.matched)
          continue
        counters.includedRingRecords++
        counters.historyBytes += Buffer.byteLength(entry.line)
        summary.add(entry.event, 'ring')
        yield entry.line
      }
      if (
        counters.invalidLines
        || counters.oversizedLines
        || counters.partialTrailingLines
        || counters.ringInvalidRecords
      ) {
        reasons.add('malformed_records')
      }
      if (
        counters.omittedUnstructuredRecords
        || counters.ringOmittedUnstructuredRecords
      ) {
        reasons.add('unstructured_records_omitted')
      }
      const result = summary.result()
      yield metadata('summary', result)
      yield metadata('footer', {
        exportComplete: true,
        coverage: reasons.size ? 'partial' : 'unknown',
        coverageReasons: [...reasons].sort(),
        counters,
        availableWindow: result.availableWindow,
        summaryTruncated: result.summaryTruncated,
        sources: sources.map(({ segment, size, readBytes, state }) => ({
          segment,
          pinnedBytes: size,
          readBytes,
          state,
        })),
        completedAt: new Date().toISOString(),
      })
    }
    finally {
      release()
    }
  }
  const stream = Readable.from(lines(), {
    objectMode: false,
    highWaterMark: 32 * 1024,
  })
  const destroy = stream._destroy.bind(stream)
  stream._destroy = (error, callback) => {
    // Cancel the active read before Readable.from waits for iterator.return().
    release()
    destroy(error, callback)
  }
  stream.once('close', release)
  stream.once('error', release)
  timer = setTimeout(
    () => {
      // Backpressure or stuck I/O may make a footer impossible. Consumers must
      // reject a missing footer; destroy also releases an unconsumed stream.
      input?.destroy()
      stream.destroy(new Error('Support report deadline exceeded'))
      release()
    },
    Math.min(
      options.deadlineMs ?? REPORT_LIMITS.deadlineMs,
      REPORT_LIMITS.deadlineMs,
    ),
  )
  timer.unref()
  return stream
}
