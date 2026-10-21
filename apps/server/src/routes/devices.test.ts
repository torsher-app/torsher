import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, DEVICE_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { devicePairings, devices, torrents } from '../db/schema.ts'
import {
  pairingPollLimiter,
  pairingStartLimiter,
} from '../services/devices/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const TV_AGENT
  = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0'

let owner: Record<string, string>

beforeAll(() => {
  migrateDb()

  const user = createOwner({
    name: 'Owner',
    email: 'owner@example.com',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
})

beforeEach(() => {
  pairingStartLimiter.reset()
  pairingPollLimiter.reset()
})

async function startPairing() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/devices/pairing',
    headers: { 'user-agent': TV_AGENT },
    payload: {},
  })

  expect(res.statusCode).toBe(201)

  return res.json() as { secret: string, code: string, expiresAt: string }
}

function poll(secret: string) {
  return app.inject({ url: `/api/devices/pairing/${secret}` })
}

function confirm(code: string, name = 'Living room TV') {
  return app.inject({
    method: 'POST',
    url: '/api/devices/pairing/confirm',
    cookies: owner,
    payload: { code, name },
  })
}

/** Полный цикл: код, подтверждение, cookie устройства */
async function pairDevice(name?: string) {
  const { secret, code } = await startPairing()

  expect((await confirm(code, name)).statusCode).toBe(200)

  const res = await poll(secret)
  const cookie = res.cookies.find(item => item.name === DEVICE_TOKEN_COOKIE)

  return {
    res,
    secret,
    cookie: cookie!,
    cookies: { [DEVICE_TOKEN_COOKIE]: cookie!.value },
  }
}

describe('подключение по коду', () => {
  it('выдаёт код из шести символов без похожих', async () => {
    const pairing = await startPairing()

    expect(pairing.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(pairing.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(Date.parse(pairing.expiresAt) - Date.now()).toBeGreaterThan(
      9 * 60 * 1000,
    )
  })

  it('проходит полный цикл и гасит секрет после выдачи токена', async () => {
    const { secret, code } = await startPairing()

    expect((await poll(secret)).json()).toMatchObject({
      status: 'pending',
      device: null,
    })

    // Владелец вводит код как удобно: строчными и с дефисом
    const confirmed = await confirm(
      `${code.slice(0, 3)}-${code.slice(3)}`.toLowerCase(),
    )

    expect(confirmed.json()).toEqual({ name: 'Living room TV', type: 'tv' })

    const approved = await poll(secret)
    const cookie = approved.cookies.find(
      item => item.name === DEVICE_TOKEN_COOKIE,
    )

    expect(approved.json()).toMatchObject({
      status: 'approved',
      device: { name: 'Living room TV' },
    })
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
    })
    expect(cookie!.maxAge).toBeGreaterThan(300 * 24 * 60 * 60)

    // Повторный опрос тем же секретом токен второй раз не выдаёт
    const again = await poll(secret)

    expect(again.statusCode).toBe(404)
    expect(again.cookies).toHaveLength(0)

    const list = await app.inject({ url: '/api/devices', cookies: owner })

    expect(list.json().items).toContainEqual(
      expect.objectContaining({
        name: 'Living room TV',
        type: 'tv',
        profile: null,
        watching: false,
      }),
    )
    expect(JSON.stringify(list.json())).not.toContain(cookie!.value)
  })

  it('различает неверный и просроченный код', async () => {
    const { secret, code } = await startPairing()

    getDb()
      .update(devicePairings)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(devicePairings.code, code))
      .run()

    expect((await confirm(code)).json()).toMatchObject({ kind: 'expired' })
    expect((await poll(secret)).json()).toMatchObject({ status: 'expired' })

    const wrong = await confirm('ZZZZZZ')

    expect(wrong.statusCode).toBe(422)
    expect(wrong.json()).toMatchObject({ kind: 'invalid' })
  })

  it('подтверждает код только в сессии владельца', async () => {
    const { code } = await startPairing()
    const { cookies } = await pairDevice()

    const asGuest = await app.inject({
      method: 'POST',
      url: '/api/devices/pairing/confirm',
      payload: { code, name: 'TV' },
    })
    const asDevice = await app.inject({
      method: 'POST',
      url: '/api/devices/pairing/confirm',
      cookies,
      payload: { code, name: 'TV' },
    })

    expect(asGuest.statusCode).toBe(401)
    expect(asDevice.statusCode).toBe(401)
  })

  it('ограничивает выдачу кодов и опрос с одного адреса', async () => {
    for (let i = 0; i < 10; i++) await startPairing()

    const limited = await app.inject({
      method: 'POST',
      url: '/api/devices/pairing',
      payload: {},
    })

    expect(limited.statusCode).toBe(429)

    const secret = 'a'.repeat(64)
    const statuses = []

    for (let i = 0; i < 61; i++) statuses.push((await poll(secret)).statusCode)

    expect(statuses.slice(0, 60).every(status => status === 404)).toBe(true)
    expect(statuses[60]).toBe(429)
  })
})

describe('доступ устройства', () => {
  it('открывает витрину и не открывает панель', async () => {
    const { cookies } = await pairDevice()

    expect(
      (await app.inject({ url: '/api/profiles', cookies })).statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ url: '/api/titles/tmdb:tv:1/progress', cookies }))
        .statusCode,
    ).toBe(200)

    for (const url of [
      '/api/devices',
      '/api/indexers',
      '/api/torrents',
      '/api/storage',
      '/api/users/me',
    ]) {
      expect((await app.inject({ url, cookies })).statusCode, url).toBe(401)
    }

    const create = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      cookies,
      payload: { name: 'Kids', color: 'green' },
    })

    expect(create.statusCode).toBe(401)
  })

  it('отозванное устройство получает 401 на следующем запросе', async () => {
    const { cookies, res } = await pairDevice()
    const id = res.json().device.id

    expect(
      (await app.inject({ url: '/api/profiles', cookies })).statusCode,
    ).toBe(200)

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${id}`,
      cookies: owner,
    })

    expect(revoke.statusCode).toBe(200)

    const after = await app.inject({ url: '/api/profiles', cookies })

    expect(after.statusCode).toBe(401)
    expect(
      after.cookies.find(item => item.name === DEVICE_TOKEN_COOKIE)?.value,
    ).toBe('')
  })

  it('токен потока устройства перестаёт работать после отзыва', async () => {
    const { cookies, res } = await pairDevice()
    const torrent = getDb()
      .insert(torrents)
      .values({
        infoHash: '9'.repeat(40),
        name: 'Sample',
        source: 'file',
        files: [{ path: 'sample.mkv', size: 1000, padding: false }],
        pieceLength: 262_144,
        status: 'ready',
      })
      .returning()
      .get()
    const streamToken = signToken(`device:${res.json().device.id}`, 'stream')
    const url = `/api/stream/${torrent.id}/0?token=${encodeURIComponent(streamToken)}`

    // Движка нет: авторизация пройдена, дальше — ошибка движка
    expect((await app.inject({ url })).statusCode).not.toBe(401)

    const listed = await app.inject({ url: '/api/devices', cookies: owner })

    expect(
      listed
        .json()
        .items.find((item: { id: string }) => item.id === res.json().device.id),
    ).toMatchObject({ watching: true })

    await app.inject({
      method: 'DELETE',
      url: `/api/devices/${res.json().device.id}`,
      cookies: owner,
    })

    expect((await app.inject({ url })).statusCode).toBe(401)
    expect(
      (await app.inject({ url: '/api/profiles', cookies })).statusCode,
    ).toBe(401)
  })

  it('владелец переименовывает устройство', async () => {
    const { res } = await pairDevice('Bedroom')
    const id = res.json().device.id

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/devices/${id}`,
      cookies: owner,
      payload: { name: '  Kitchen  ' },
    })

    expect(renamed.json()).toMatchObject({ id, name: 'Kitchen' })
    expect(
      getDb().select().from(devices).where(eq(devices.id, id)).get()?.name,
    ).toBe('Kitchen')
  })
})
