import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, config } from '../config.ts'
import { migrateDb } from '../db/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()

let owner: Record<string, string>

beforeAll(async () => {
  await migrateDb()

  const user = createOwner({
    username: 'Owner',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
})

function change(headers: Record<string, string>) {
  return app.inject({
    method: 'PUT',
    url: '/api/updates/settings',
    cookies: owner,
    headers,
    payload: { enabled: true, channel: 'stable' },
  })
}

describe('cross-site requests with the owner cookie', () => {
  it('rejects a panel change from another site', async () => {
    const res = await change({ 'sec-fetch-site': 'same-site' })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ message: 'cross_site_request' })
  })

  it('rejects it on a route whose 403 has another shape', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/password',
      cookies: owner,
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { currentPassword: 'x', newPassword: 'new-password' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ message: 'cross_site_request' })
  })

  it('lets same-origin, direct and header-less requests through', async () => {
    expect((await change({ 'sec-fetch-site': 'same-origin' })).statusCode).toBe(
      200,
    )
    expect((await change({ 'sec-fetch-site': 'none' })).statusCode).toBe(200)
    expect((await change({})).statusCode).toBe(200)
  })

  it('lets the configured client origin through', async () => {
    const res = await change({
      'sec-fetch-site': 'cross-site',
      'origin': config.clientUrl!,
    })

    expect(res.statusCode).toBe(200)
  })

  it('does not check reads', async () => {
    const res = await app.inject({
      url: '/api/users/me',
      cookies: owner,
      headers: { 'sec-fetch-site': 'cross-site' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('does not check showcase routes', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/profiles/current/player',
      cookies: owner,
      headers: { 'sec-fetch-site': 'same-site' },
      payload: { autoNext: false },
    })

    expect(res.statusCode).toBe(200)
  })

  it('still answers 401 without a session', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/updates/settings',
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { enabled: true, channel: 'stable' },
    })

    expect(res.statusCode).toBe(401)
  })
})
