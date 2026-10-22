import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createLogger,
  installLogger,
  logFor,
  queryLogs,
  setLogLevel,
} from './index.ts'

const dirs: string[] = []
const quiet = { write: () => true }

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'torsher-logger-'))

  dirs.push(dir)
  return dir
}

afterEach(() => {
  installLogger(pino({ level: 'silent' }))

  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('логгер журнала', () => {
  it('уровень корня меняет уровень дочерних логгеров без своего', () => {
    const lines: string[] = []
    const root = pino(
      { level: 'info' },
      { write: (line: string) => lines.push(line) },
    )
    const child = root.child({ source: 'engine' })

    child.debug('hidden')
    root.level = 'debug'
    child.debug('shown')

    expect(lines.map(line => JSON.parse(line).msg)).toEqual(['shown'])
  })

  it('debug доходит до журнала, источник и очистка на месте', () => {
    installLogger(
      createLogger({ level: 'info', logsDir: tempDir(), stdout: quiet }),
    )

    logFor('engine').debug('hidden')
    setLogLevel('debug')
    logFor('engine').debug('shown')
    logFor('sources').warn(
      { url: 'http://x/api?apikey=SECRET' },
      'Indexer check failed',
    )

    const { entries } = queryLogs({})

    expect(entries.map(entry => [entry.source, entry.message])).toEqual([
      ['sources', 'Indexer check failed'],
      ['engine', 'shown'],
    ])
    expect(entries[0]!.context).toEqual({
      url: 'http://x/api?apikey=[redacted]',
    })
  })

  it('известные поля с секретами вырезаются', () => {
    installLogger(
      createLogger({ level: 'info', logsDir: tempDir(), stdout: quiet }),
    )

    logFor('auth').info({ password: 'p', user: { token: 't' } }, 'x')

    expect(queryLogs({}).entries[0]!.context).toEqual({
      password: '[redacted]',
    })
  })

  it('журнал переживает перезапуск: буфер начинается с хвоста файлов', async () => {
    const dir = tempDir()

    installLogger(createLogger({ level: 'info', logsDir: dir, stdout: quiet }))
    logFor('server').info('before restart')
    // Поток файла пишет асинхронно
    await new Promise(resolve => setTimeout(resolve, 50))

    installLogger(createLogger({ level: 'info', logsDir: dir, stdout: quiet }))

    expect(queryLogs({}).entries.map(entry => entry.message)).toEqual([
      'before restart',
    ])
  })
})
