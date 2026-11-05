import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createReport, ReportBusyError } from './report.ts'

const delayed = vi.hoisted(() => ({
  enabled: false,
  resume: undefined as (() => void) | undefined,
  started: undefined as (() => void) | undefined,
  closed: false,
}))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    createReadStream: (path: string, options: object) =>
      fs.createReadStream(path, {
        ...options,
        fs: {
          read: (fd, buffer, offset, length, position, callback) => {
            if (!delayed.enabled)
              return fs.read(fd, buffer, offset, length, position, callback)
            delayed.resume = () =>
              fs.read(fd, buffer, offset, length, position, callback)
            delayed.started?.()
          },
          close: (fd, callback) => {
            delayed.closed = true
            fs.close(fd, callback)
          },
        },
      }),
  }
})

describe('report cancellation during an outstanding fs.read', () => {
  it.each(['disconnect', 'deadline'] as const)(
    'keeps fd and concurrency owned until read settles: %s',
    async (reason) => {
      const dir = mkdtempSync(join(tmpdir(), 'torsher-report-cancel-'))
      writeFileSync(
        join(dir, 'torsher.log'),
        `${JSON.stringify({ time: Date.now(), event: 'playback.ready', origin: 'server', session: 'test-session' })}\n`,
      )
      const options = {
        dir,
        visitRing: () => {},
        storage: {
          serverInstance: 'instance-1',
          fileSinkState: 'enabled' as const,
          retentionState: 'ok' as const,
        },
        environment: {},
      }
      delayed.enabled = true
      delayed.closed = false
      try {
        const started = new Promise<void>((resolve) => {
          delayed.started = resolve
        })
        const report = createReport({
          ...options,
          deadlineMs: reason === 'deadline' ? 15 : 30000,
        })
        const closed = new Promise<void>(resolve =>
          report.once('close', resolve),
        )
        report.on('error', () => {})
        report.resume()
        await started
        if (reason === 'disconnect')
          report.destroy()
        else await new Promise(resolve => setTimeout(resolve, 25))
        expect(delayed.closed).toBe(false)
        expect(() => createReport(options)).toThrow(ReportBusyError)
        delayed.enabled = false
        delayed.resume!()
        await closed
        expect(delayed.closed).toBe(true)
        const next = createReport(options)
        for await (const _chunk of next) {
          // Consume to verify the next report completes after releasing the fd.
        }
      }
      finally {
        delayed.enabled = false
        rmSync(dir, { force: true, recursive: true })
      }
    },
  )
})
