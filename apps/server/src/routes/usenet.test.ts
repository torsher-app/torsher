import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { users } from '../db/schema.ts'
import { netResolveDeps } from '../services/net/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const owner = {
  [ACCESS_TOKEN_COOKIE]: signToken('usenet-owner', 'user_access'),
}

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({
      id: 'usenet-owner',
      username: 'Usenet test owner',
      passwordHash: 'unused',
    })
    .run()
})
afterAll(() => app.close())

describe('usenet routes', () => {
  it('requires an owner and same origin for configuration actions', async () => {
    const dns = vi.spyOn(netResolveDeps, 'routeAddresses')
    try {
      expect((await app.inject('/api/usenet')).statusCode).toBe(401)
      expect((await app.inject('/api/usenet/jobs')).statusCode).toBe(401)
      const rejected = await app.inject({
        method: 'POST',
        url: '/api/usenet/address',
        cookies: owner,
        headers: {
          'sec-fetch-site': 'cross-site',
          'origin': 'https://foreign.example',
        },
        payload: { url: 'https://sab.example' },
      })
      expect(rejected.statusCode).toBe(403)
      expect(dns).not.toHaveBeenCalled()
    }
    finally {
      dns.mockRestore()
    }
  })

  it('provides a disabled default and checks private candidates without contacting them', async () => {
    const dns = vi
      .spyOn(netResolveDeps, 'routeAddresses')
      .mockResolvedValue(['192.168.20.12'])
    try {
      const config = await app.inject({
        method: 'GET',
        url: '/api/usenet',
        cookies: owner,
      })
      expect(config.statusCode, config.body).toBe(200)
      expect(config.json()).toEqual({ config: null })
      const preview = await app.inject({
        method: 'POST',
        url: '/api/usenet/address',
        cookies: owner,
        payload: { url: 'http://sab.example/base' },
      })
      expect(preview.statusCode, preview.body).toBe(200)
      expect(preview.json()).toEqual({
        origin: 'http://sab.example',
        lanAddresses: ['192.168.20.12'],
      })
    }
    finally {
      dns.mockRestore()
    }
  })

  it('keeps the viewer API absent from the unauthenticated title path', async () => {
    expect(
      (await app.inject('/api/titles/tmdb:movie:9000001/usenet-sources'))
        .statusCode,
    ).toBe(401)
    expect(
      (await app.inject('/api/titles/tmdb:movie:9000001/usenet-jobs'))
        .statusCode,
    ).toBe(401)
  })
})
