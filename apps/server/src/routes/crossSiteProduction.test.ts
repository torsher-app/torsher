import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { migrateDb } from '../db/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

// Образ не задаёт CLIENT_URL: адрес по умолчанию для разработки в
// production доверенным быть не должен
vi.stubEnv('NODE_ENV', 'production')
vi.stubEnv('CLIENT_URL', '')
vi.stubEnv('SECRET_KEY', 'f'.repeat(64))

const DEV_ORIGIN = 'http://localhost:3000'
const app = createApp()

let owner: Record<string, string>

beforeAll(async () => {
  await migrateDb()

  const user = createOwner({
    name: 'Owner',
    email: 'owner@example.com',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
})

describe('production without CLIENT_URL', () => {
  it('trusts no origin for cross-site changes', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      cookies: owner,
      headers: { 'sec-fetch-site': 'same-site', 'origin': DEV_ORIGIN },
      payload: { name: 'Owner' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('sends no CORS origin', async () => {
    const res = await app.inject({
      url: '/api/users/me',
      cookies: owner,
      headers: { origin: DEV_ORIGIN },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('keeps the health check open to any origin', async () => {
    const res = await app.inject({
      url: '/api/health',
      headers: { origin: 'null' },
    })

    expect(res.headers['access-control-allow-origin']).toBe('*')
  })
})
