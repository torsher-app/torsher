import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, DEVICE_TOKEN_COOKIE } from '../config.ts'
import { eq } from 'drizzle-orm'
import { getDb, migrateDb } from '../db/index.ts'
import { devices } from '../db/schema.ts'
import {
  pairingPollLimiter,
  pairingStartLimiter,
} from '../services/devices/index.ts'
import { setEngineDown } from '../services/engine/index.ts'
import {
  defaultProfile,
  resetPinAttempts,
} from '../services/profiles/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()

let owner: Record<string, string>

beforeAll(async () => {
  await migrateDb()
  setEngineDown('stopped')

  const user = createOwner({
    username: 'Owner',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
})

beforeEach(() => {
  resetPinAttempts()
  pairingStartLimiter.reset()
  pairingPollLimiter.reset()
})

async function pairDevice() {
  const started = (
    await app.inject({
      method: 'POST',
      url: '/api/devices/pairing',
      payload: {},
    })
  ).json()

  await app.inject({
    method: 'POST',
    url: '/api/devices/pairing/confirm',
    cookies: owner,
    payload: { code: started.code, name: 'TV' },
  })

  const res = await app.inject({
    url: `/api/devices/pairing/${started.secret}`,
  })
  const cookie = res.cookies.find(item => item.name === DEVICE_TOKEN_COOKIE)!
  const devices = (
    await app.inject({ url: '/api/devices', cookies: owner })
  ).json()

  return {
    cookies: { [DEVICE_TOKEN_COOKIE]: cookie.value },
    id: devices.items.at(-1).id as string,
  }
}

function setPin(id: string, pin: string | null) {
  return app.inject({
    method: pin ? 'PUT' : 'DELETE',
    url: `/api/profiles/${id}/pin`,
    cookies: owner,
    payload: pin ? { pin } : undefined,
  })
}

function mine(cookies: Record<string, string>) {
  return app.inject({ url: '/api/mine', cookies })
}

describe('device without a chosen profile', () => {
  it('must choose when the default profile has a PIN', async () => {
    const main = defaultProfile()

    await setPin(main.id, '1234')

    const device = await pairDevice()
    const denied = await mine(device.cookies)

    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toEqual({ message: 'profile_required' })

    const stream = await app.inject({
      url: `/api/stream/missing/0?token=${signToken(`device:${device.id}`, 'stream')}`,
    })

    expect(stream.statusCode).toBe(403)

    // Поток по cookie без токена: отказ и без отметки «смотрит сейчас»
    const byCookie = await app.inject({
      url: '/api/stream/missing/0',
      cookies: device.cookies,
    })

    expect(byCookie.statusCode).toBe(403)
    expect(
      getDb()
        .select({ lastStreamAt: devices.lastStreamAt })
        .from(devices)
        .where(eq(devices.id, device.id))
        .get()
        ?.lastStreamAt,
    ).toBeNull()

    const list = await app.inject({
      url: '/api/profiles',
      cookies: device.cookies,
    })

    expect(list.statusCode).toBe(200)
    expect(list.json()).toMatchObject({ selected: false, currentId: '' })

    const selected = await app.inject({
      method: 'POST',
      url: `/api/profiles/${main.id}/select`,
      cookies: device.cookies,
      payload: { pin: '1234' },
    })

    expect(selected.statusCode).toBe(200)
    expect((await mine(device.cookies)).statusCode).toBe(200)

    await setPin(main.id, null)
  })

  it('watches the default profile when it has no PIN', async () => {
    const device = await pairDevice()

    expect((await mine(device.cookies)).statusCode).toBe(200)
  })

  it('must choose again when its profile is deleted and the default has a PIN', async () => {
    const guest = (
      await app.inject({
        method: 'POST',
        url: '/api/profiles',
        cookies: owner,
        payload: { name: 'Guest', color: 'blue' },
      })
    ).json()
    const device = await pairDevice()

    await app.inject({
      method: 'POST',
      url: `/api/profiles/${guest.id}/select`,
      cookies: device.cookies,
      payload: {},
    })
    await setPin(defaultProfile().id, '1234')
    await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${guest.id}`,
      cookies: owner,
    })

    const res = await mine(device.cookies)

    expect(res.statusCode).toBe(403)
    expect(res.json().message).toBe('profile_required')

    await setPin(defaultProfile().id, null)
  })

  it('keeps the owner session on the default profile with a PIN', async () => {
    await setPin(defaultProfile().id, '1234')

    expect((await mine(owner)).statusCode).toBe(200)

    await setPin(defaultProfile().id, null)
  })
})
