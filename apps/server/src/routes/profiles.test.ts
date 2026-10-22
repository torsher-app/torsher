import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import {
  ACCESS_TOKEN_COOKIE,
  DEVICE_TOKEN_COOKIE,
  PROFILE_COOKIE,
} from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { torrents } from '../db/schema.ts'
import {
  pairingPollLimiter,
  pairingStartLimiter,
} from '../services/devices/index.ts'
import { resetPinAttempts } from '../services/profiles/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()

let owner: Record<string, string>
let torrentId: string

beforeAll(() => {
  migrateDb()

  const user = createOwner({
    name: 'Owner',
    email: 'owner@example.com',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
  torrentId = getDb()
    .insert(torrents)
    .values({
      infoHash: '7'.repeat(40),
      name: 'Quiet Harbor S01E02',
      source: 'file',
      files: [{ path: 'Quiet.Harbor.S01E02.mkv', size: 1000, padding: false }],
      pieceLength: 262_144,
      status: 'ready',
    })
    .returning()
    .get()
    .id
})

beforeEach(() => {
  resetPinAttempts()
  pairingStartLimiter.reset()
  pairingPollLimiter.reset()
})

async function listProfiles(cookies = owner) {
  const res = await app.inject({ url: '/api/profiles', cookies })

  return res.json() as {
    items: { id: string, name: string, hasPin: boolean }[]
    currentId: string
    selected: boolean
  }
}

async function createProfile(payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    cookies: owner,
    payload,
  })

  expect(res.statusCode).toBe(201)

  return res.json() as { id: string, name: string, hasPin: boolean }
}

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

  return { [DEVICE_TOKEN_COOKIE]: cookie.value }
}

function select(cookies: Record<string, string>, id: string, pin?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/profiles/${id}/select`,
    cookies,
    payload: pin ? { pin } : {},
  })
}

function saveProgress(cookies: Record<string, string>, position: number) {
  return app.inject({
    method: 'PUT',
    url: '/api/watch-state',
    cookies,
    payload: {
      torrentId,
      fileIndex: 0,
      position,
      duration: 3000,
      title: { id: 'tmdb:tv:5', season: 1, episode: 2 },
    },
  })
}

async function progressOf(cookies: Record<string, string>) {
  const res = await app.inject({
    url: '/api/titles/tmdb:tv:5/progress',
    cookies,
  })

  return res.json().last?.position ?? null
}

describe('профили', () => {
  it('аккаунт владельца создаёт профиль с его именем', async () => {
    const list = await listProfiles()

    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({ name: 'Owner', hasPin: false })
    expect(list.currentId).toBe(list.items[0]!.id)
  })

  it('создаёт, правит и не отдаёт хеш PIN', async () => {
    const kids = await createProfile({
      name: 'Kids',
      color: 'green',
      language: 'ru_RU',
      ageLimit: 12,
      pin: '1234',
    })

    expect(kids).toMatchObject({
      name: 'Kids',
      color: 'green',
      language: 'ru_RU',
      ageLimit: 12,
      hasPin: true,
    })

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${kids.id}`,
      cookies: owner,
      payload: { name: 'Children', ageLimit: null },
    })

    expect(patched.json()).toMatchObject({ name: 'Children', ageLimit: null })
    expect(JSON.stringify(await listProfiles())).not.toContain('argon2')

    const badAge = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      cookies: owner,
      payload: { name: 'X', color: 'green', ageLimit: 13 },
    })

    expect(badAge.statusCode).toBe(400)
  })

  it('задаёт и убирает PIN', async () => {
    const guest = await createProfile({ name: 'Guest', color: 'blue' })
    const set = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${guest.id}/pin`,
      cookies: owner,
      payload: { pin: '0042' },
    })

    expect(set.json()).toMatchObject({ hasPin: true })

    const short = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${guest.id}/pin`,
      cookies: owner,
      payload: { pin: '12' },
    })

    expect(short.statusCode).toBe(400)

    const cleared = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${guest.id}/pin`,
      cookies: owner,
    })

    expect(cleared.json()).toMatchObject({ hasPin: false })
  })

  it('не удаляет последний профиль', async () => {
    const { items } = await listProfiles()

    for (const item of items.slice(1)) {
      await app.inject({
        method: 'DELETE',
        url: `/api/profiles/${item.id}`,
        cookies: owner,
      })
    }

    const last = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${items[0]!.id}`,
      cookies: owner,
    })

    expect(last.statusCode).toBe(409)
  })
})

describe('выбор профиля на устройстве', () => {
  it('выбирает профиль без PIN и с PIN', async () => {
    const tv = await pairDevice()
    const open = await createProfile({ name: 'Open', color: 'teal' })
    const locked = await createProfile({
      name: 'Locked',
      color: 'rose',
      pin: '4321',
    })

    expect((await listProfiles(tv)).selected).toBe(false)
    expect((await select(tv, open.id)).statusCode).toBe(200)
    expect(await listProfiles(tv)).toMatchObject({
      currentId: open.id,
      selected: true,
    })

    const noPin = await select(tv, locked.id)

    expect(noPin.statusCode).toBe(403)
    expect(noPin.json()).toMatchObject({ kind: 'wrong_pin', attemptsLeft: 4 })
    expect((await select(tv, locked.id, '4321')).statusCode).toBe(200)
    expect((await listProfiles(tv)).currentId).toBe(locked.id)
  })

  it('после пяти неверных PIN закрывает профиль на устройстве', async () => {
    const tv = await pairDevice()
    const otherTv = await pairDevice()
    const locked = await createProfile({
      name: 'Parents',
      color: 'slate',
      pin: '5555',
    })

    for (let i = 0; i < 4; i++)
      expect((await select(tv, locked.id, '0000')).statusCode).toBe(403)

    const fifth = await select(tv, locked.id, '0000')

    expect(fifth.statusCode).toBe(429)
    expect(fifth.json()).toMatchObject({ kind: 'locked', retryAfter: 300 })
    // Во время блокировки не проходит и верный PIN
    expect((await select(tv, locked.id, '5555')).statusCode).toBe(429)
    // Другое устройство перебор первого не блокирует
    expect((await select(otherTv, locked.id, '5555')).statusCode).toBe(200)
  })

  it('сессия владельца запоминает профиль в cookie', async () => {
    const mine = await createProfile({ name: 'Mine', color: 'amber' })
    const res = await select(owner, mine.id)
    const cookie = res.cookies.find(item => item.name === PROFILE_COOKIE)

    expect(cookie).toMatchObject({ value: mine.id, httpOnly: true })
    expect((await listProfiles(owner)).selected).toBe(false)
    expect(
      await listProfiles({ ...owner, [PROFILE_COOKIE]: mine.id }),
    ).toMatchObject({ currentId: mine.id, selected: true })
  })
})

describe('прогресс по профилям', () => {
  it('позиции двух профилей не смешиваются', async () => {
    const tv = await pairDevice()
    const first = await createProfile({ name: 'First', color: 'violet' })
    const second = await createProfile({ name: 'Second', color: 'orange' })

    await select(tv, first.id)
    expect((await saveProgress(tv, 100)).statusCode).toBe(200)

    await select(tv, second.id)
    expect(await progressOf(tv)).toBeNull()
    await saveProgress(tv, 900)
    expect(await progressOf(tv)).toBe(900)

    await select(tv, first.id)
    expect(await progressOf(tv)).toBe(100)
  })

  it('удаление переносит прогресс в другой профиль или удаляет его', async () => {
    const tv = await pairDevice()
    const from = await createProfile({ name: 'From', color: 'violet' })
    const to = await createProfile({ name: 'To', color: 'green' })
    const dropped = await createProfile({ name: 'Dropped', color: 'rose' })

    await select(tv, from.id)
    await saveProgress(tv, 700)
    await select(tv, dropped.id)
    await saveProgress(tv, 50)

    const moved = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${from.id}?moveTo=${to.id}`,
      cookies: owner,
    })

    expect(moved.statusCode).toBe(200)
    await select(tv, to.id)
    expect(await progressOf(tv)).toBe(700)

    await select(tv, dropped.id)
    await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${dropped.id}`,
      cookies: owner,
    })
    // Профиль устройства удалён: оно снова смотрит профилем по умолчанию
    const list = await listProfiles(tv)

    expect(list.currentId).toBe(list.items[0]!.id)
    expect(list.selected).toBe(false)

    const missing = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${to.id}?moveTo=nope`,
      cookies: owner,
    })

    expect(missing.statusCode).toBe(400)
  })
})
