import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { migrateDb } from '../db/index.ts'

const app = createApp()

beforeAll(() => {
  migrateDb()
})

async function signupAndSignin(email: string) {
  await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { name: 'User', email, password: 'password123' },
  })

  const res = await app.inject({
    method: 'POST',
    url: '/auth/signin',
    payload: { email, password: 'password123' },
  })
  const cookie = res.cookies.find(item => item.name === ACCESS_TOKEN_COOKIE)

  return { [ACCESS_TOKEN_COOKIE]: cookie!.value }
}

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

describe('первый запуск', () => {
  it('создаёт только один аккаунт', async () => {
    const before = await app.inject({ url: '/auth/setup' })

    expect(before.json()).toEqual({ needsSetup: true })

    const owner = await signupAndSignin('owner@example.com')
    const me = await app.inject({ url: '/users/me', cookies: owner })

    expect(me.json().email).toBe('owner@example.com')
    expect((await app.inject({ url: '/auth/setup' })).json()).toEqual({
      needsSetup: false,
    })

    const second = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        name: 'User',
        email: 'second@example.com',
        password: 'password123',
      },
    })

    expect(second.statusCode).toBe(403)
  })
})

describe('get /health', () => {
  it('отвечает ok', async () => {
    const res = await app.inject({ url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
