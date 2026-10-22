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
  dir = mkdtempSync(join(tmpdir(), 'torsher-logs-'))
})

afterEach(() => {
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
    writeFileSync(join(dir, 'torsher.log'), 'a'.repeat(90))

    const file = new RotatingFile(dir, { maxBytes: 100 })

    file.write(line('next'))
    await file.close()

    expect(readFileSync(join(dir, 'torsher.1.log'), 'utf8')).toBe(
      'a'.repeat(90),
    )
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
