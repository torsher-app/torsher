import type { HTTPMethods } from 'fastify'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, DEVICE_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { users } from '../db/schema.ts'
import { setEngineDown } from '../services/engine/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

// Каждый маршрут API помечен явно: публичный, витрина (сессия владельца или
// токен устройства) или панель (только владелец). Новый маршрут без пометки
// здесь считается панелью — тест упадёт, если он открыт без входа или если
// витрине нужен роут, закрытый от устройства
const PUBLIC = new Set([
  'GET /api/health',
  'GET /api/about',
  'GET /api/img/:size/:file',
  'GET /api/auth/setup',
  'POST /api/auth/signup',
  'POST /api/auth/signin',
  'POST /api/auth/refresh',
  'POST /api/auth/logout',
  'POST /api/devices/pairing',
  'GET /api/devices/pairing/:secret',
])

const VIEWER = new Set([
  'GET /api/home',
  'GET /api/home/continue',
  'GET /api/catalog/search',
  'GET /api/catalog/trending',
  'GET /api/catalog/backdrops',
  'GET /api/catalog/discover',
  'GET /api/catalog/genres',
  'GET /api/catalog/titles/:id',
  'GET /api/catalog/titles/:id/extras',
  'GET /api/catalog/titles/:id/seasons/:number',
  'GET /api/catalog/people/:id',
  'GET /api/titles/:id/sources',
  'PUT /api/titles/:id/voice',
  'POST /api/titles/:id/watch',
  'GET /api/titles/:id/progress',
  'GET /api/titles/:id/up-next',
  'POST /api/titles/:id/open',
  'GET /api/titles/:id/files/:torrentId',
  'GET /api/titles/:id/download',
  'GET /api/titles/:id/library',
  'POST /api/titles/:id/download',
  'DELETE /api/titles/:id/download',
  'POST /api/titles/:id/keep',
  'PUT /api/titles/:id/watched',
  'GET /api/titles/:id/mine',
  'PATCH /api/titles/:id/mine',
  'GET /api/titles/:id/follow',
  'PUT /api/titles/:id/follow',
  'DELETE /api/titles/:id/follow',
  'GET /api/schedule',
  'GET /api/mine',
  'GET /api/mine/items',
  'PUT /api/collections/:id/titles/:titleId',
  'DELETE /api/collections/:id/titles/:titleId',
  'POST /api/playback',
  'GET /api/playback/:id',
  'DELETE /api/playback/:id',
  'GET /api/playback/:id/subtitles/:trackId',
  'GET /api/hls/:id/main.m3u8',
  'GET /api/hls/:id/:segment',
  'PUT /api/watch-state',
  'GET /api/stream/:torrentId/:fileIndex',
  'GET /api/library/files/:id/stream',
  'GET /api/library/files/:id/thumb',
  'GET /api/library/home',
  'GET /api/library/home/videos',
  'GET /api/torrents/:id',
  'GET /api/torrents/:id/stats',
  'PUT /api/torrents/:id/title',
  'GET /api/profiles',
  'POST /api/profiles/:id/select',
  'PUT /api/profiles/current/player',
])

// Роуты потока: токен из адреса вместо cookie (`requireStream`)
const STREAM = [
  'GET /api/stream/:torrentId/:fileIndex',
  'GET /api/library/files/:id/stream',
  'GET /api/hls/:id/main.m3u8',
  'GET /api/hls/:id/:segment',
]

const app = createApp()
const routes: { method: HTTPMethods, url: string }[] = []

app.addHook('onRoute', (route) => {
  const methods = Array.isArray(route.method) ? route.method : [route.method]

  for (const method of methods) {
    if (method !== 'HEAD' && route.url.startsWith('/api'))
      routes.push({ method, url: route.url })
  }
})

let device: Record<string, string>
let deviceId: string
let owner: Record<string, string>
let ownerId: string

function keyOf(route: { method: string, url: string }) {
  return `${route.method} ${route.url}`
}

function inject(
  route: { method: HTTPMethods, url: string },
  cookies: Record<string, string>,
) {
  return app.inject({
    method: route.method,
    url: route.url.replace(/:\w+/g, '0'),
    cookies,
  })
}

beforeAll(async () => {
  await migrateDb()
  // Без движка роуты раздач отвечают сразу, а не ждут его
  setEngineDown('stopped')
  await app.ready()

  const user = createOwner({
    name: 'Owner',
    email: 'owner@example.com',
    passwordHash: 'x',
  })

  ownerId = user.id
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
  deviceId = (await app.inject({ url: '/api/devices', cookies: owner })).json().items[0].id
})

function streamUrl(key: string, token: string) {
  return `${key.split(' ')[1]!.replace(/:\w+/g, '0')}?token=${token}`
}

describe('доступ к маршрутам API', () => {
  it('списки ссылаются только на существующие маршруты', () => {
    const known = new Set(routes.map(keyOf))

    for (const key of [...PUBLIC, ...VIEWER])
      expect(known.has(key), key).toBe(true)
  })

  it('без входа открыты только публичные маршруты', async () => {
    for (const route of routes) {
      if (PUBLIC.has(keyOf(route)))
        continue

      expect((await inject(route, {})).statusCode, keyOf(route)).toBe(401)
    }
  })

  it('токен устройства открывает витрину и не открывает панель', async () => {
    for (const route of routes) {
      const key = keyOf(route)

      if (PUBLIC.has(key))
        continue

      const status = (await inject(route, device)).statusCode

      if (VIEWER.has(key))
        expect(status, key).not.toBe(401)
      else expect(status, key).toBe(401)
    }
  })

  it('сессия владельца проходит везде', async () => {
    for (const route of routes) {
      if (PUBLIC.has(keyOf(route)))
        continue

      expect((await inject(route, owner)).statusCode, keyOf(route)).not.toBe(
        401,
      )
    }
  })
})

describe('токены потока и сессии', () => {
  it('токен потока устройства открывает роуты потока', async () => {
    const token = signToken(`device:${deviceId}`, 'stream')

    for (const key of STREAM) {
      const res = await app.inject({ url: streamUrl(key, token) })

      expect(res.statusCode, key).not.toBe(401)
    }
  })

  it('access и refresh в адресе потока не принимаются', async () => {
    for (const purpose of ['user_access', 'user_refresh'] as const) {
      const token = signToken(ownerId, purpose)

      for (const key of STREAM) {
        const res = await app.inject({ url: streamUrl(key, token) })

        expect(res.statusCode, `${purpose} ${key}`).toBe(401)
      }
    }
  })

  it('токен потока в access-cookie не открывает панель', async () => {
    const res = await app.inject({
      url: '/api/users/me',
      cookies: { [ACCESS_TOKEN_COOKIE]: signToken(ownerId, 'stream') },
    })

    expect(res.statusCode).toBe(401)
  })

  it('access с устаревшей версией сессий — 401', async () => {
    const stale = {
      [ACCESS_TOKEN_COOKIE]: signToken(ownerId, 'user_access', 0),
    }
    const db = getDb()

    db.update(users)
      .set({ sessionVersion: 1 })
      .where(eq(users.id, ownerId))
      .run()

    try {
      expect(
        (await app.inject({ url: '/api/users/me', cookies: stale })).statusCode,
      ).toBe(401)
      expect(
        (await app.inject({ url: '/api/profiles', cookies: stale })).statusCode,
      ).toBe(401)
    }
    finally {
      db.update(users)
        .set({ sessionVersion: 0 })
        .where(eq(users.id, ownerId))
        .run()
    }
  })
})
