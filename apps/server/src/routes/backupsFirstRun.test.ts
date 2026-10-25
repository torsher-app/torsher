import type { FastifyInstance } from 'fastify'
import { Buffer } from 'node:buffer'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// «Аккаунта нет» управляется тестом: так аккаунт появляется ровно между
// хуком доступа и обработчиком, без гонки по времени
const setup = vi.hoisted(() => ({ needed: true }))

vi.mock('../services/users/index.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/users/index.ts')>()),
  needsSetup: () => setup.needed,
}))

let dataDir: string
let app: FastifyInstance
let backups: typeof import('../services/backups/index.ts')
// Что сделать после хука доступа, до обработчика
let betweenHookAndHandler: () => void = () => {}
const restart = vi.fn()

const GZIP = Buffer.from([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00])

function files(dir: string) {
  try {
    return readdirSync(join(dataDir, dir))
  }
  catch {
    return []
  }
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'torsher-backup-first-run-'))
  vi.stubEnv('DATABASE_PATH', join(dataDir, 'torsher.db'))
  vi.resetModules()

  const db = await import('../db/index.ts')

  await db.migrateDb()
  backups = await import('../services/backups/index.ts')

  const { onRestartRequested } = await import('../services/lifecycle.ts')
  const { createApp } = await import('../app.ts')

  onRestartRequested(restart)
  app = createApp()
  // Хук корня до `ready` достаётся и плагину копий
  app.addHook('preHandler', async () => betweenHookAndHandler())
  await app.ready()
})

beforeEach(() => {
  setup.needed = true
  betweenHookAndHandler = () => {}
})

afterAll(async () => {
  await app?.close()
  vi.unstubAllEnvs()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('без входа: аккаунт появился после хука доступа', () => {
  it('загрузка — 401, файла нет', async () => {
    betweenHookAndHandler = () => {
      setup.needed = false
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/upload',
      headers: { 'content-type': 'application/octet-stream' },
      payload: GZIP,
    })

    expect(res.statusCode).toBe(401)
    expect(
      files('backups').filter(name => name.includes('-uploaded-')),
    ).toEqual([])
  })

  it('восстановление — 401, восстановление не начато', async () => {
    betweenHookAndHandler = () => {
      setup.needed = false
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/torsher-backup-20261024T040000Z-uploaded-v1.0.0.db.gz/restore',
    })

    expect(res.statusCode).toBe(401)
    expect(backups.restoreStatus()).toBeUndefined()
    expect(restart).not.toHaveBeenCalled()
  })

  it('состояние восстановления — 401', async () => {
    betweenHookAndHandler = () => {
      setup.needed = false
    }

    const res = await app.inject({ url: '/api/backups/restore' })

    expect(res.statusCode).toBe(401)
  })

  it('загрузка без входа обрывается, если аккаунт появился посреди тела', async () => {
    const body = new PassThrough()
    const upload = backups.uploadBackup(body, { firstRun: true })

    body.write(GZIP)
    setup.needed = false
    body.end(Buffer.alloc(16))

    await expect(upload).rejects.toMatchObject({ kind: 'account_created' })
    expect(
      files('backups').filter(name => name.includes('-uploaded-')),
    ).toEqual([])
    expect(files('backups-tmp')).toEqual([])
  })
})

describe('без входа на пустом сервере: запрос с чужого сайта', () => {
  it('загрузка копии — 403, файла нет', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/upload',
      headers: {
        'content-type': 'application/octet-stream',
        'sec-fetch-site': 'same-site',
      },
      payload: GZIP,
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ message: 'cross_site_request' })
    expect(
      files('backups').filter(name => name.includes('-uploaded-')),
    ).toEqual([])
  })
})
