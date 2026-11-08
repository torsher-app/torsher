import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import pino from 'pino'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../../app.ts'
import {
  ACCESS_TOKEN_COOKIE,
  config,
  DEVICE_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../../config.ts'
import { getDb, migrateDb } from '../../db/index.ts'
import { devicePairings, devices, users } from '../../db/schema.ts'
import { hashPassword } from '../../utils/password.ts'
import {
  signToken,
  TOKEN_TTL,
  tokenRejectionReason,
} from '../../utils/token.ts'
import {
  pairingPollLimiter,
  pairingStartLimiter,
  startPairing,
} from '../devices/index.ts'
import {
  closeLogFiles,
  createLogger,
  installLogger,
  queryLogs,
} from '../logs/index.ts'
import { projectRecord, projectRingEntry } from '../logs/reportProjection.ts'
import { RequestLogController } from '../logs/requestLog.ts'
import { LOG_RETENTION_MS } from '../logs/ring.ts'
import { setSetting } from '../settings/index.ts'
import { createOwner, signinLimiter } from '../users/index.ts'

const marker = 'PRIVATE_AUTH_MARKER'
const username = 'PrivateOwnerMarker'
const password = 'PrivatePasswordMarker123'
let userId: string
let app: ReturnType<typeof createApp>
let dir: string
let stdout: string[]
let owner: Record<string, string>
function events(event?: string) {
  return queryLogs({ sources: ['auth'], limit: 500 }).entries.filter(
    entry => !event || entry.context?.event === event,
  )
}

beforeAll(async () => {
  await migrateDb()
  userId = createOwner({
    username,
    passwordHash: await hashPassword(password),
  }).id
})
beforeEach(() => {
  getDb().delete(devicePairings).run()
  getDb().delete(devices).run()
  getDb()
    .update(users)
    .set({
      isActive: true,
      isBanned: false,
      isDeleted: false,
      sessionVersion: 0,
    })
    .where(eq(users.id, userId))
    .run()
  pairingStartLimiter.reset()
  pairingPollLimiter.reset()
  signinLimiter.reset()
  setSetting('userActionDiagnostics', false)
  owner = { [ACCESS_TOKEN_COOKIE]: signToken(userId, 'user_access') }
  dir = mkdtempSync(join(tmpdir(), 'torsher-auth-logs-'))
  stdout = []
  const logger = createLogger({
    level: 'debug',
    logsDir: dir,
    stdout: { write: line => stdout.push(line) },
  })
  installLogger(logger)
  app = createApp({
    loggerInstance: logger,
    logController: new RequestLogController(),
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await app.close()
  await closeLogFiles()
  installLogger(pino({ level: 'silent' }))
  rmSync(dir, { recursive: true, force: true })
})

async function start() {
  const response = await app.inject({
    method: 'POST',
    url: '/api/devices/pairing',
    headers: { 'user-agent': marker },
    payload: { type: 'tv' },
  })
  expect(response.statusCode).toBe(201)
  return response.json() as { secret: string, code: string }
}
async function confirm(code: string) {
  return app.inject({
    method: 'POST',
    url: '/api/devices/pairing/confirm',
    cookies: owner,
    payload: { code, name: marker },
  })
}
function poll(secret: string) {
  return app.inject({ url: `/api/devices/pairing/${secret}?query=${marker}` })
}
async function signin(input = { username, password }) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/signin',
    payload: input,
  })
}
function stream(token: string) {
  return app.inject({
    url: `/api/stream/fixture-torrent/0?token=${encodeURIComponent(token)}`,
  })
}

// Every assertion traverses the real Fastify controller and pino sinks. The
// regular download deliberately retains more than the safe report projection.
async function assertPrivate(values: string[]) {
  const regular = await app.inject({
    url: '/api/logs/download',
    cookies: owner,
  })
  const report = await app.inject({
    url: '/api/logs/download?format=report',
    cookies: owner,
  })
  expect(regular.statusCode).toBe(200)
  expect(report.statusCode).toBe(200)
  await closeLogFiles()
  const disk = readFileSync(join(dir, 'torsher.log'), 'utf8')
  const ring = queryLogs({ limit: 500 }).entries
  for (const output of [
    stdout.join(''),
    disk,
    JSON.stringify(ring),
    regular.body,
    report.body,
  ]) {
    for (const value of [marker, username, password, ...values])
      expect(output).not.toContain(value)
  }
  for (const entry of events()) {
    const projected = projectRingEntry(entry, Date.now() + 1, LOG_RETENTION_MS)
    expect(projected.kind).toBe('event')
    if (projected.kind === 'event') {
      expect(projected.value.origin).toBe('server')
      expect(projected.value.facts).not.toHaveProperty('ip')
    }
  }
  const physicalEvents = disk
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
    .filter(record => record.event?.startsWith('auth.'))
  expect(physicalEvents.length).toBeGreaterThan(0)
  for (const record of physicalEvents) {
    expect(projectRecord(record, Date.now() + 1, LOG_RETENTION_MS).kind).toBe(
      'event',
    )
  }
  return { regular: regular.body, report: report.body, disk }
}

describe('operational auth diagnostics', () => {
  it('does not infer token reasons from arbitrary exception messages', () => {
    expect(tokenRejectionReason(new Error('jwt expired'))).toBe('unknown')
    expect(tokenRejectionReason(new TypeError('Invalid token purpose'))).toBe(
      'unknown',
    )
    expect(tokenRejectionReason('jwt expired')).toBe('unknown')
  })
  it('records pairing only after creation and claim, preserves responses and keeps secrets out of verbose HTTP logs/downloads', async () => {
    const { secret, code } = await start()
    expect(events('auth.pairing_started')).toHaveLength(1)
    expect((await poll(secret)).json().status).toBe('pending')
    expect((await confirm(code)).json()).toEqual({ name: marker, type: 'tv' })
    expect(events('auth.device_paired')).toHaveLength(0)
    const claimed = await poll(secret)
    expect(claimed.json()).toMatchObject({
      status: 'approved',
      device: { name: marker },
    })
    const cookie = claimed.cookies.find(
      item => item.name === DEVICE_TOKEN_COOKIE,
    )!
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' })
    const id = claimed.json().device.id
    expect(events('auth.device_paired')[0]!.context).toMatchObject({
      deviceId: id,
      type: 'tv',
      origin: 'server',
    })
    expect((await poll(secret)).statusCode).toBe(404)
    expect((await confirm('ZZZZZZ')).statusCode).toBe(422)
    expect(
      events('auth.pairing_rejected')
        .map(entry => entry.context?.step)
        .sort(),
    ).toEqual(['confirm', 'poll'])
    // Unknown path and validation failures must also avoid interpolated input.
    expect(
      (await app.inject({ url: `/missing/${marker}?token=${marker}` }))
        .statusCode,
    ).toBe(404)
    expect(
      (await app.inject({ url: `/api/devices/pairing/${marker}` })).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/signin',
          payload: { username: marker, password: null },
        })
      ).statusCode,
    ).toBe(400)
    const { report, disk } = await assertPrivate([
      secret,
      code,
      cookie.value,
      owner[ACCESS_TOKEN_COOKIE]!,
    ])
    const completed = disk
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
      .filter(record => record.msg === 'Request completed')
    expect(
      completed.some(record => record.url === '/api/devices/pairing/:secret'),
    ).toBe(true)
    expect(disk).toContain('<unmatched>')
    expect(report).toContain('auth.device_paired')
    expect(report).toContain(id)
  })

  it('distinguishes invalid/expired pairing and each unchanged rate-limit outcome without repeated warnings', async () => {
    const { secret, code } = await start()
    getDb()
      .update(devicePairings)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run()
    expect((await confirm(code)).json().kind).toBe('expired')
    expect((await poll(secret)).json().status).toBe('expired')
    expect((await confirm('ZZZZZZ')).json().kind).toBe('invalid')
    expect(
      events('auth.pairing_rejected')
        .map(entry => `${entry.context?.step}:${entry.context?.reason}`)
        .sort(),
    ).toEqual(['confirm:expired', 'confirm:invalid', 'poll:expired'])
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/devices/pairing',
        payload: {},
      })
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/devices/pairing',
          payload: {},
        })
      ).statusCode,
    ).toBe(429)
    for (let i = 0; i < 62; i++) await poll('a'.repeat(64))
    expect((await poll('a'.repeat(64))).statusCode).toBe(429)
    pairingStartLimiter.reset()
    getDb().delete(devicePairings).run()
    for (let i = 0; i < 50; i++) startPairing({ type: 'other' })
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/devices/pairing',
          payload: {},
        })
      ).json(),
    ).toEqual({ message: 'Too many requests' })
    expect(
      events('auth.rate_limited')
        .map(entry => entry.context?.limit)
        .sort(),
    ).toEqual(['active', 'poll', 'start'])
    await assertPrivate([secret, code])
  })

  it('reports an unknown revoked cookie without inventing its id, while preserving a verified stream subject', async () => {
    const { secret, code } = await start()
    await confirm(code)
    const claimed = await poll(secret)
    const id = claimed.json().device.id
    const cookie = claimed.cookies.find(
      item => item.name === DEVICE_TOKEN_COOKIE,
    )!.value
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/devices/${id}`,
          cookies: owner,
        })
      ).statusCode,
    ).toBe(200)
    for (let i = 0; i < 3; i++) {
      const denied = await app.inject({
        url: '/api/profiles',
        cookies: { [DEVICE_TOKEN_COOKIE]: cookie },
      })
      expect(denied.statusCode).toBe(401)
      expect(
        denied.cookies.find(item => item.name === DEVICE_TOKEN_COOKIE)?.value,
      ).toBe('')
    }
    const signed = signToken(`device:${id}`, 'stream')
    expect((await stream(signed)).statusCode).toBe(401)
    const rows = events('auth.token_rejected')
    expect(rows).toHaveLength(2)
    expect(
      rows.find(entry => entry.context?.tokenKind === 'device_cookie')!
        .context,
    ).not.toHaveProperty('deviceId')
    expect(
      rows.find(entry => entry.context?.tokenKind === 'device_stream')!
        .context,
    ).toMatchObject({ reason: 'unknown', type: 'unknown', deviceId: id })
    await assertPrivate([cookie, signed, code, secret])
  })

  it('classifies verified session failures without decoding unverified claims or warning on an anonymous visit', async () => {
    expect((await app.inject({ url: '/api/devices' })).statusCode).toBe(401)
    expect(events()).toHaveLength(0)
    const wrongPurpose = signToken(userId, 'user_refresh')
    const expired = jwt.sign(
      {
        userId,
        purpose: 'user_access',
        sv: 0,
        iat: Math.floor(Date.now() / 1000) - TOKEN_TTL.user_access - 60,
      },
      config.secretKey,
      { algorithm: 'HS256', expiresIn: TOKEN_TTL.user_access },
    )
    const badSignature = jwt.sign(
      { userId: `device:${marker}`, purpose: 'stream' },
      'wrong-secret',
      { expiresIn: TOKEN_TTL.stream },
    )
    for (const token of [wrongPurpose, expired, marker]) {
      expect(
        (
          await app.inject({
            url: '/api/devices',
            cookies: { [ACCESS_TOKEN_COOKIE]: token },
          })
        ).statusCode,
      ).toBe(401)
    }
    expect((await stream(badSignature)).statusCode).toBe(401)
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/refresh' }))
        .statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/refresh',
          cookies: { [REFRESH_TOKEN_COOKIE]: marker },
        })
      ).statusCode,
    ).toBe(401)
    getDb().update(users).set({ sessionVersion: 1 }).run()
    expect(
      (await app.inject({ url: '/api/devices', cookies: owner })).statusCode,
    ).toBe(401)
    const rows = events('auth.session_rejected')
    expect(
      rows
        .map(
          entry => `${entry.context?.sessionKind}:${entry.context?.reason}`,
        )
        .sort(),
    ).toEqual([
      'access:expired',
      'access:invalid',
      'access:purpose',
      'access:revoked',
      'refresh:invalid',
      'refresh:missing',
      'stream:invalid',
    ])
    expect(
      rows.every(entry => !Object.hasOwn(entry.context!, 'deviceId')),
    ).toBe(true)
    owner = { [ACCESS_TOKEN_COOKIE]: signToken(userId, 'user_access', 1) }
    await assertPrivate([wrongPurpose, expired, badSignature])
  })

  it('keeps cross-site policy and credential outcomes, logs typed reasons and does not expose input', async () => {
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/devices/pairing/confirm',
      cookies: owner,
      headers: {
        'origin': `https://${marker}.invalid`,
        'sec-fetch-site': 'cross-site',
      },
      payload: { code: marker, name: marker },
    })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json()).toEqual({ message: 'cross_site_request' })
    expect(events('auth.cross_site')[0]!.context).toMatchObject({
      originKind: 'different',
      fetchSite: 'cross-site',
      operation: 'postDevicePairingConfirm',
    })
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/devices/pairing/confirm',
      cookies: owner,
      headers: {
        'origin': `https://${marker}.invalid`,
        'sec-fetch-site': 'same-origin',
      },
      payload: { code: 'ZZZZZZ', name: marker },
    })
    expect(allowed.statusCode).toBe(422)
    expect(events('auth.cross_site')).toHaveLength(1)
    expect((await signin({ username: marker, password })).statusCode).toBe(400)
    expect(events('auth.signin_failed')[0]!.context?.reason).toBe(
      'invalid_credentials',
    )
    getDb().update(users).set({ isActive: false }).run()
    expect((await signin()).statusCode).toBe(403)
    getDb().update(users).set({ isActive: true, isBanned: true }).run()
    expect((await signin()).statusCode).toBe(403)
    getDb().update(users).set({ isBanned: false }).run()
    for (let i = 0; i < 10; i++) await signin({ username, password: marker })
    expect((await signin()).statusCode).toBe(429)
    expect((await signin()).statusCode).toBe(429)
    expect(
      events('auth.signin_failed')
        .map(entry => entry.context?.reason)
        .sort(),
    ).toEqual(['inactive', 'invalid_credentials', 'unavailable'])
    expect(
      events('auth.rate_limited').map(entry => entry.context?.limit),
    ).toEqual(['signin'])
    await assertPrivate([])
  })

  it('identifies a confirmed device used for the wrong purpose in cookies and signed streams', async () => {
    const { secret, code } = await start()
    await confirm(code)
    const claimed = await poll(secret)
    const id = claimed.json().device.id
    const cookie = claimed.cookies.find(
      item => item.name === DEVICE_TOKEN_COOKIE,
    )!.value
    getDb()
      .update(devices)
      .set({ purpose: 'jellyfin' })
      .where(eq(devices.id, id))
      .run()
    expect(
      (
        await app.inject({
          url: '/api/profiles',
          cookies: { [DEVICE_TOKEN_COOKIE]: cookie },
        })
      ).statusCode,
    ).toBe(401)
    const token = signToken(`device:${id}`, 'stream')
    expect((await stream(token)).statusCode).toBe(401)
    expect(events('auth.token_rejected').map(entry => entry.context)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'purpose',
          tokenKind: 'device_cookie',
          deviceId: id,
          type: 'tv',
        }),
        expect.objectContaining({
          reason: 'purpose',
          tokenKind: 'device_stream',
          deviceId: id,
          type: 'tv',
        }),
      ]),
    )
    await assertPrivate([secret, code, token, cookie])
  })

  it('distinguishes a server without an owner from a wrong username on an existing server', async () => {
    const user = getDb()
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get()!
    getDb().delete(users).where(eq(users.id, userId)).run()
    try {
      expect(
        (await signin({ username: marker, password: marker })).statusCode,
      ).toBe(400)
      expect(events('auth.signin_failed')[0]!.context?.reason).toBe('no_user')
    }
    finally {
      getDb().insert(users).values(user).run()
    }
    await assertPrivate([])
  })

  it('keeps expired refresh responses and classifies local Origin headers without exporting them', async () => {
    const expired = jwt.sign(
      {
        userId,
        purpose: 'user_refresh',
        sv: 0,
        iat: Math.floor(Date.now() / 1000) - TOKEN_TTL.user_refresh - 60,
      },
      config.secretKey,
      { algorithm: 'HS256', expiresIn: TOKEN_TTL.user_refresh },
    )
    const denied = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { [REFRESH_TOKEN_COOKIE]: expired },
    })
    expect(denied.json()).toEqual({ message: 'Invalid token' })
    expect(denied.cookies.every(cookie => cookie.value === '')).toBe(true)
    expect(events('auth.session_rejected')[0]!.context).toMatchObject({
      reason: 'expired',
      sessionKind: 'refresh',
    })
    for (const [origin, kind] of [
      ['null', 'opaque'],
      [marker, 'invalid'],
      [undefined, 'missing'],
      ['http://localhost', 'same'],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/devices/pairing/confirm',
        cookies: owner,
        headers: {
          ...(origin ? { origin } : {}),
          'sec-fetch-site': 'cross-site',
        },
        payload: { code: 'ZZZZZZ', name: marker },
      })
      expect(response.statusCode).toBe(403)
      expect(
        events('auth.cross_site').some(
          entry => entry.context?.originKind === kind,
        ),
      ).toBe(true)
    }
    await assertPrivate([expired])
  })

  it('allows the next rejection warning only after ten minutes without changing 401 responses', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const request = () =>
      app.inject({
        url: '/api/profiles',
        cookies: { [DEVICE_TOKEN_COOKIE]: marker },
      })
    expect((await request()).statusCode).toBe(401)
    clock.mockReturnValue(now + 599_999)
    expect((await request()).statusCode).toBe(401)
    expect(events('auth.token_rejected')).toHaveLength(1)
    clock.mockReturnValue(now + 600_000)
    expect((await request()).statusCode).toBe(401)
    expect(events('auth.token_rejected')).toHaveLength(2)
  })
})
