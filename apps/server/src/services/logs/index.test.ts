import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closeLogFiles,
  createLogger,
  installLogger,
  logFor,
  queryLogs,
  setLogLevel,
  throttleLog,
} from './index.ts'

const dirs: string[] = []
const quiet = { write: () => true }

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'torsher-logger-'))

  dirs.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  installLogger(pino({ level: 'silent' }))
  await closeLogFiles()

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

  it('очищает JSON-текст с escape до stdout, буфера и файла', async () => {
    const dir = tempDir()
    const lines: string[] = []
    const raw = String.raw`{"value":"http://127.0.0.1:9696/1/api?t=caps\u0026apikey=SYNTHETIC_ONLY\u0026extended=1"}`
    const expected = String.raw`{"value":"http://127.0.0.1:9696/1/api?t=caps\u0026apikey=[redacted]\u0026extended=1"}`

    installLogger(
      createLogger({
        level: 'info',
        logsDir: dir,
        stdout: { write: (line: string) => lines.push(line) },
      }),
    )
    logFor('sources').warn({ response: raw }, raw)
    await closeLogFiles()

    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('SYNTHETIC_ONLY')
    const stdout = JSON.parse(lines[0]!)

    expect(stdout.msg).toBe(expected)
    expect(stdout.response).toBe(expected)
    expect(JSON.parse(stdout.msg).value).toBe(
      'http://127.0.0.1:9696/1/api?t=caps&apikey=[redacted]&extended=1',
    )
    expect(queryLogs({}).entries).toMatchObject([
      { source: 'sources', message: expected, context: { response: expected } },
    ])
    expect(readFileSync(join(dir, 'torsher.log'), 'utf8')).toBe(lines[0])
  })

  it('адреса Fastify при запуске уходят на debug', async () => {
    const logger = createLogger({
      level: 'info',
      logsDir: tempDir(),
      stdout: quiet,
    })

    installLogger(logger)

    async function listen() {
      const app = Fastify({ loggerInstance: logger })

      await app.listen({ port: 0, host: '127.0.0.1' })
      await app.close()
    }

    await listen()

    expect(queryLogs({}).entries).toEqual([])

    setLogLevel('debug')
    await listen()

    expect(
      queryLogs({}).entries.map(entry => [entry.level, entry.message]),
    ).toEqual([['debug', expect.stringMatching(/^Server listening at /)]])
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
    // Поток файла пишет асинхронно: закрытие дожидается записи на диск
    await closeLogFiles()

    installLogger(createLogger({ level: 'info', logsDir: dir, stdout: quiet }))

    expect(queryLogs({}).entries.map(entry => entry.message)).toEqual([
      'before restart',
    ])
  })
})

describe('bounded log throttle', () => {
  it('preserves active windows, refuses excess keys, admits expiry and resets on install', () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    installLogger(pino({ level: 'silent' }))
    for (let i = 0; i < 1000; i++)
      expect(throttleLog(`active-${i}`, 10000)).toBe(true)
    expect(throttleLog('overflow', 10000)).toBe(false)
    now += 5000
    expect(throttleLog('active-0', 10000)).toBe(false)
    expect(throttleLog('overflow', 10000)).toBe(false)
    now += 5000
    expect(throttleLog('overflow', 10000)).toBe(true)
    expect(throttleLog('overflow', 10000)).toBe(false)
    installLogger(pino({ level: 'silent' }))
    expect(throttleLog('overflow', 10000)).toBe(true)
  })
})
