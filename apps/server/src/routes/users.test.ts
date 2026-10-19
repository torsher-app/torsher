import { describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'

const app = createApp()

describe('get /users/me', () => {
  it('отвечает 401 без cookie', async () => {
    const res = await app.inject({ url: '/users/me' })

    expect(res.statusCode).toBe(401)
  })

  it('отвечает 401 на подделанный токен', async () => {
    const res = await app.inject({
      url: '/users/me',
      cookies: { [ACCESS_TOKEN_COOKIE]: 'not-a-jwt' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('get /health', () => {
  it('отвечает ok', async () => {
    const res = await app.inject({ url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
