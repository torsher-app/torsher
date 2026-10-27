import { mkdtempSync, rmSync } from 'node:fs'
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
import { ACCESS_TOKEN_COOKIE, DEVICE_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { serverSettings } from '../db/schema.ts'
import {
  createLogger,
  installLogger,
  logFor,
  setLogLevel,
} from '../services/logs/index.ts'
import { RequestLogController } from '../services/logs/requestLog.ts'
import { resetScrub } from '../services/logs/scrub.ts'
import { getSetting } from '../services/settings/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const quiet = { write: () => true }
let owner: Record<string, string>
let device: Record<string, string>
let dir: string

function flushFiles() {
  return new Promise(resolve => setTimeout(resolve, 50))
}

async function logs(query = '') {
  const res = await app.inject({ url: `/api/logs${query}`, cookies: owner })

  expect(res.statusCode).toBe(200)

  return res.json()
}

beforeAll(async () => {
  await migrateDb()

  const user = createOwner({
    username: 'Owner',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }

  const started = await app.inject({
    method: 'POST',
    url: '/api/devices/pairing',
    payload: {},
  })

  await app.inject({
    method: 'POST',
    url: '/api/devices/pairing/confirm',
    cookies: owner,
    payload: { code: started.json().code, name: 'TV' },
  })

  const approved = await app.inject({
    url: `/api/devices/pairing/${started.json().secret}`,
  })
  const cookie = approved.cookies.find(
    item => item.name === DEVICE_TOKEN_COOKIE,
  )

  device = { [DEVICE_TOKEN_COOKIE]: cookie!.value }
})

beforeEach(() => {
  vi.stubEnv('DOWNLOADS_PATH', '/data/downloads')
  resetScrub()
  dir = mkdtempSync(join(tmpdir(), 'torsher-logs-route-'))
  installLogger(createLogger({ level: 'info', logsDir: dir, stdout: quiet }))
  getDb().delete(serverSettings).run()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetScrub()
  installLogger(pino({ level: 'silent' }))
  rmSync(dir, { recursive: true, force: true })
})

afterAll(() => app.close())

describe('доступ', () => {
  it('без входа и с токеном устройства — 401', async () => {
    for (const cookies of [{}, device]) {
      for (const [method, url] of [
        ['GET', '/api/logs'],
        ['GET', '/api/logs/download'],
        ['PUT', '/api/logs/level'],
      ] as const) {
        const res = await app.inject({
          method,
          url,
          cookies,
          payload: method === 'PUT' ? { level: 'debug' } : undefined,
        })

        expect(res.statusCode, `${method} ${url}`).toBe(401)
      }
    }
  })
})

describe('журнал', () => {
  it('фильтры по уровню, источникам и тексту', async () => {
    logFor('engine').error('Engine crashed')
    logFor('storage').warn('Cache evicted')
    logFor('server').info('Server started')
    logFor('engine').info('Engine is ready')

    const messages = async (query: string) =>
      (await logs(query)).entries.map(
        (entry: { message: string }) => entry.message,
      )

    expect(await messages('')).toEqual([
      'Engine is ready',
      'Server started',
      'Cache evicted',
      'Engine crashed',
    ])
    expect(await messages('?level=warn')).toEqual([
      'Cache evicted',
      'Engine crashed',
    ])
    expect(await messages('?source=engine,storage&level=info')).toEqual([
      'Engine is ready',
      'Cache evicted',
      'Engine crashed',
    ])
    expect(await messages('?q=ENGINE')).toEqual([
      'Engine is ready',
      'Engine crashed',
    ])

    const res = await app.inject({
      url: '/api/logs?source=nope',
      cookies: owner,
    })

    expect(res.statusCode).toBe(400)
  })

  it('курсоры и признак продолжения', async () => {
    for (let i = 1; i <= 5; i++) logFor('server').info(`m${i}`)

    const first = await logs('?limit=2')
    const seqs = (body: { entries: { seq: number }[] }) =>
      body.entries.map(entry => entry.seq)

    expect(first.hasMore).toBe(true)
    expect(
      first.entries.map((entry: { message: string }) => entry.message),
    ).toEqual(['m5', 'm4'])

    const older = await logs(`?limit=10&before=${seqs(first).at(-1)}`)

    expect(
      older.entries.map((entry: { message: string }) => entry.message),
    ).toEqual(['m3', 'm2', 'm1'])
    expect(older.hasMore).toBe(false)

    logFor('server').info('m6')

    const newer = await logs(`?after=${seqs(first)[0]}`)

    expect(
      newer.entries.map((entry: { message: string }) => entry.message),
    ).toEqual(['m6'])

    // Повтор той же записи виден по `after`: тот же id, новый seq
    const cursor = seqs(newer)[0]

    logFor('server').info('m6')

    const repeated = await logs(`?after=${cursor}`)

    expect(repeated.entries).toMatchObject([
      { id: newer.entries[0].id, message: 'm6', repeat: 2 },
    ])
    expect(repeated.entries[0].seq).toBeGreaterThan(cursor!)
  })

  it('id журнала постоянен в процессе и меняется с новым журналом', async () => {
    const first = (await logs()).instance

    expect(first).toEqual(expect.any(String))
    expect((await logs()).instance).toBe(first)

    installLogger(createLogger({ level: 'info', logsDir: dir, stdout: quiet }))

    expect((await logs()).instance).not.toBe(first)
  })

  it('запись: уровень, источник, детали и контекст', async () => {
    logFor('engine').error(
      { code: 2, details: 'panic: x\ngoroutine 1' },
      'Engine crashed (exit code 2) after 3m 12s',
    )

    expect((await logs()).entries[0]).toEqual({
      id: expect.any(Number),
      seq: expect.any(Number),
      time: expect.any(String),
      level: 'error',
      source: 'engine',
      message: 'Engine crashed (exit code 2) after 3m 12s',
      details: 'panic: x\ngoroutine 1',
      context: { code: 2 },
    })
  })

  it('секреты и пути загрузок до ответа не доходят', async () => {
    logFor('sources').warn(
      { url: 'http://indexer.example/api?t=caps&apikey=SECRET1' },
      'Request to http://user:SECRET2@proxy.example failed',
    )
    logFor('storage').error(
      { path: '/data/downloads/Some Movie (2008)/movie.mkv' },
      'open /data/downloads/Some Movie (2008)/movie.mkv: permission denied',
    )
    await flushFiles()

    const res = await app.inject({ url: '/api/logs', cookies: owner })
    const download = await app.inject({
      url: '/api/logs/download',
      cookies: owner,
    })

    for (const body of [res.body, download.body]) {
      expect(body).not.toContain('SECRET')
      expect(body).not.toContain('Some Movie')
      expect(body).toContain('open <downloads>/…')
    }
  })
})

describe('скачивание', () => {
  it('текстовый файл с шапкой и записями', async () => {
    logFor('engine').error('Engine crashed')
    await flushFiles()

    const res = await app.inject({ url: '/api/logs/download', cookies: owner })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="torsher-\d{4}-\d{2}-\d{2}\.log"$/,
    )
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toMatch(/^Torsher \d+\.\d+\.\d+\n/)
    expect(res.body).toContain('Engine: ')
    expect(res.body).toContain('Log level: info')
    expect(res.body).toMatch(/Z ERROR engine {2}Engine crashed\n/)
  })
})

describe('уровень журнала', () => {
  it('меняется сразу и сохраняется в настройках', async () => {
    logFor('server').debug('hidden')

    const res = await app.inject({
      method: 'PUT',
      url: '/api/logs/level',
      cookies: owner,
      payload: { level: 'debug' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ level: 'debug' })
    expect(getSetting('logLevel')).toBe('debug')

    logFor('server').debug('shown')

    const body = await logs()

    expect(body.level).toBe('debug')
    expect(body.levelLocked).toBe(false)
    expect(
      body.entries.map((entry: { message: string }) => entry.message),
    ).toEqual(['shown'])
  })

  it('уровень из LOG_LEVEL блокирует смену из панели', async () => {
    vi.stubEnv('LOG_LEVEL', 'debug')

    expect((await logs()).levelLocked).toBe(true)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/logs/level',
      cookies: owner,
      payload: { level: 'info' },
    })

    expect(res.statusCode).toBe(409)
    expect(getSetting('logLevel')).toBeUndefined()
  })

  it('принимает только info и debug', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/logs/level',
      cookies: owner,
      payload: { level: 'error' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('запросы в журнале', () => {
  it('запрос — debug без токена в адресе, необработанная ошибка — error со стеком', async () => {
    const logger = createLogger({ level: 'info', logsDir: dir, stdout: quiet })
    const logged = createApp({
      loggerInstance: logger,
      logController: new RequestLogController(),
    })

    installLogger(logger)
    logged.get('/boom', async () => {
      throw new Error('boom')
    })

    await logged.inject({ url: '/api/about?token=abc123' })
    expect((await logs()).entries).toEqual([])

    setLogLevel('debug')
    await logged.inject({ url: '/api/about?token=abc123' })
    await logged.inject({ url: '/boom' })
    await logged.close()

    const { entries } = await logs()
    const completed = entries.find(
      (entry: { message: string, context?: { url?: string } }) =>
        entry.message === 'Request completed'
        && entry.context?.url?.startsWith('/api/about'),
    )
    const failed = entries.find(
      (entry: { level: string }) => entry.level === 'error',
    )

    expect(completed.context).toMatchObject({
      method: 'GET',
      url: '/api/about?token=[redacted]',
      statusCode: 200,
    })
    expect(JSON.stringify(entries)).not.toContain('abc123')
    expect(failed).toMatchObject({
      message: 'boom',
      context: { method: 'GET', url: '/boom', statusCode: 500 },
    })
    expect(failed.details).toContain('Error: boom')
  })
})
