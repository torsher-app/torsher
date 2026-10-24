import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { migrateDb } from '../db/index.ts'
import { accelDeps, resetAccel } from '../services/media/accel.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
let owner = {}

beforeAll(async () => {
  await migrateDb()

  const { id } = createOwner({
    name: 'Owner',
    email: 'owner@example.com',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(id, 'user_access') }
})

afterEach(() => {
  vi.restoreAllMocks()
  resetAccel()
})

// Сервер с одной встроенной графикой Intel: кодирует и декодирует H.264
function intelServer() {
  const run = vi.spyOn(accelDeps, 'run').mockImplementation(async args => ({
    code: args.some(arg => /h264_vaapi|libx264|scale_vaapi/.test(arg))
      ? 0
      : 1,
    stderr: 'VAAPI driver: Intel iHD driver.\n',
    ms: 400,
  }))

  vi.spyOn(accelDeps, 'list').mockImplementation(async kind =>
    kind === '-encoders'
      ? ' V....D libx264  H.264\n V....D h264_vaapi  VAAPI\n'
      : ' .SC zscale  V->V\n .S. tonemap  V->V\n',
  )
  vi.spyOn(accelDeps, 'renderNodes').mockResolvedValue(['/dev/dri/renderD128'])

  return run
}

describe('настройки воспроизведения', () => {
  it('без сессии аккаунта — 401', async () => {
    const res = await app.inject({ url: '/api/settings/playback' })

    expect(res.statusCode).toBe(401)
  })

  it('показывает найденную видеокарту и переключает на процессор', async () => {
    intelServer()

    const found = await app.inject({
      url: '/api/settings/playback',
      cookies: owner,
    })

    expect(found.statusCode).toBe(200)
    expect(found.json()).toMatchObject({
      accel: 'auto',
      encoder: 'vaapi',
      gpus: [{ encoder: 'vaapi', name: 'Intel iHD driver', lowPower: false }],
      software: true,
      softwareMaxHeight: 1080,
      softwareToneMapping: true,
    })

    const software = await app.inject({
      method: 'PUT',
      url: '/api/settings/playback',
      cookies: owner,
      payload: { accel: 'software' },
    })

    expect(software.json()).toMatchObject({
      accel: 'software',
      encoder: 'software',
    })

    await app.inject({
      method: 'PUT',
      url: '/api/settings/playback',
      cookies: owner,
      payload: { accel: 'auto' },
    })
  })

  it('«Проверить снова» запускает пробы заново', async () => {
    const run = intelServer()

    await app.inject({ url: '/api/settings/playback', cookies: owner })

    const before = run.mock.calls.length
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/playback/check',
      cookies: owner,
    })

    expect(res.statusCode).toBe(200)
    expect(run.mock.calls.length).toBeGreaterThan(before)
  })
})
