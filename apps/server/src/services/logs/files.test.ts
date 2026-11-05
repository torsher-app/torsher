import { Buffer } from 'node:buffer'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportLog, formatEntry, readTail, RotatingFile } from './files.ts'

let dir: string

function line(msg: string, fields: Record<string, unknown> = {}) {
  return `${JSON.stringify({ level: 30, time: Date.UTC(2026, 9, 22, 11, 24, 3, 120), msg, ...fields })}\n`
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 9, 22, 12))
  dir = mkdtempSync(join(tmpdir(), 'torsher-logs-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('файлы журнала', () => {
  it('ротация на границе размера: не больше пяти файлов', async () => {
    const file = new RotatingFile(dir, { maxBytes: 100 })
    const record = line('x'.repeat(30))

    expect(record.length).toBeGreaterThan(50)

    for (let i = 0; i < 12; i++) file.write(record)
    await file.close()

    expect(existsSync(join(dir, 'torsher.log'))).toBe(true)
    expect(existsSync(join(dir, 'torsher.4.log'))).toBe(true)
    expect(existsSync(join(dir, 'torsher.5.log'))).toBe(false)

    for (const name of ['torsher.log', 'torsher.1.log', 'torsher.4.log']) {
      expect(readFileSync(join(dir, name), 'utf8').length).toBeLessThanOrEqual(
        100,
      )
    }
  })

  it('продолжает текущий файл после перезапуска с учётом его размера', async () => {
    const previous = line('a'.repeat(20))
    writeFileSync(join(dir, 'torsher.log'), previous)

    const file = new RotatingFile(dir, { maxBytes: 100 })

    file.write(line('next'))
    await file.close()

    expect(readFileSync(join(dir, 'torsher.1.log'), 'utf8')).toBe(previous)
    expect(readFileSync(join(dir, 'torsher.log'), 'utf8')).toContain('"next"')
  })

  it('каталог недоступен — одно предупреждение и запись выключена', () => {
    const blocker = join(dir, 'file')

    writeFileSync(blocker, '')

    const warn = vi.fn()
    const file = new RotatingFile(join(blocker, 'logs'), { warn })

    file.write(line('x'))
    expect(file.enabled).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('хвост после перезапуска — из текущего файла и архивов, от старых к новым', () => {
    writeFileSync(join(dir, 'torsher.2.log'), line('a') + line('b'))
    writeFileSync(join(dir, 'torsher.1.log'), line('c'))
    writeFileSync(join(dir, 'torsher.log'), line('d') + line('e'))

    const messages = (max: number) =>
      readTail(dir, max).map(row => JSON.parse(row).msg)

    expect(messages(3)).toEqual(['c', 'd', 'e'])
    expect(messages(100)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('экспорт: шапка и записи текстом от старых к новым', async () => {
    writeFileSync(
      join(dir, 'torsher.1.log'),
      line('old', {
        source: 'engine',
        level: 50,
        details: 'panic: x\ngoroutine 1',
        code: 2,
      }),
    )
    writeFileSync(
      join(dir, 'torsher.log'),
      `${line('new', { note: 'a b' })}{broken\n`,
    )

    const output = await text(
      exportLog(dir, { engine: 'ready', level: 'info' }),
    )

    expect(output).toMatch(
      /^Torsher \d+\.\d+\.\d+\nPlatform: \S+ \S+\nNode: v\d+/,
    )
    expect(output).toContain('Engine: ready\nLog level: info\n')
    expect(output).toContain(
      [
        '2026-10-22T11:24:03.120Z ERROR engine  old code=2',
        '    panic: x',
        '    goroutine 1',
        '2026-10-22T11:24:03.120Z INFO  server  new note="a b"',
        '',
      ].join('\n'),
    )
    expect(output).not.toContain('broken')
  })

  it('формат записи', () => {
    expect(
      formatEntry({
        time: 't',
        level: 'warn',
        source: 'playback',
        message: 'm',
      }),
    ).toBe('t WARN  playback m\n')
  })
})

describe('retention', () => {
  it('migrates mixed active files conservatively and rejects unknown time', async () => {
    writeFileSync(
      join(dir, 'torsher.log'),
      line('expired', { time: Date.now() - 8 * 86400000 })
      + line('fresh', { time: Date.now() }),
    )
    writeFileSync(
      join(dir, 'torsher.1.log'),
      line('invalid', { time: 'not-a-date' }),
    )
    const file = new RotatingFile(dir)
    file.write(line('new', { time: Date.now() }))
    await file.close()
    const output = await text(
      exportLog(dir, { engine: 'ready', level: 'info' }),
    )
    expect(output).not.toContain('expired')
    expect(output).not.toContain('fresh')
    expect(output).not.toContain('invalid')
    expect(output).toContain('new')
  })
  it('rotates quiet active files by age and filters reads before physical cleanup', async () => {
    const at = Date.now()
    const file = new RotatingFile(dir)
    file.write(line('old', { time: at }))
    vi.setSystemTime(at + 86400000)
    await file.maintain()
    expect(existsSync(join(dir, 'torsher.1.log'))).toBe(true)
    vi.setSystemTime(at + 7 * 86400000)
    expect(readTail(dir, 100)).toEqual([])
    expect(
      await text(exportLog(dir, { engine: 'ready', level: 'info' })),
    ).not.toContain(' old')
    await file.maintain()
    expect(existsSync(join(dir, 'torsher.1.log'))).toBe(false)
    await file.close()
  })
  it('reports asynchronous stream failure immediately', async () => {
    const warn = vi.fn()
    const file = new RotatingFile(dir, { warn })
    const stream = (
      file as unknown as { stream: import('node:fs').WriteStream }
    ).stream
    stream.emit('error', new Error('disk full'))
    expect(file.enabled).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    expect(file.retentionState).toBe('degraded')
    await file.maintain()
    expect(file.retentionState).toBe('degraded')
    await file.close()
  })
})

it('does not inspect or unlink a young active file with a partially completed write', async () => {
  const file = new RotatingFile(dir)
  const stream = (file as unknown as { stream: import('node:fs').WriteStream })
    .stream
  const { writeSync } = await import('node:fs')
  let complete!: () => void
  let started!: () => void
  const pending = new Promise<void>((resolve) => {
    started = resolve
  })
  const write = vi
    .spyOn(stream, '_write')
    .mockImplementation((chunk, _encoding, callback) => {
      const bytes = Buffer.from(chunk)
      const half = Math.floor(bytes.length / 2)
      const fd = (stream as unknown as { fd: number }).fd
      writeSync(fd, bytes.subarray(0, half))
      complete = () => {
        writeSync(fd, bytes.subarray(half))
        callback(null)
      }
      started()
    })
  file.write(line('pending-fresh', { time: Date.now() }))
  await pending
  await file.maintain()
  expect(existsSync(join(dir, 'torsher.log'))).toBe(true)
  expect(file.enabled).toBe(true)
  complete()
  write.mockRestore()
  await file.close()
  expect(readTail(dir, 100).map(value => JSON.parse(value).msg)).toEqual([
    'pending-fresh',
  ])
})
