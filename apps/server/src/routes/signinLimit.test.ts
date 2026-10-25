import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { migrateDb } from '../db/index.ts'
import {
  passwordConfirmLimiter,
  signinLimiter,
} from '../services/users/index.ts'
import { verifyPassword } from '../utils/password.ts'

vi.mock('../utils/password.ts', async (importOriginal) => {
  const original
    = await importOriginal<typeof import('../utils/password.ts')>()

  return { ...original, verifyPassword: vi.fn(original.verifyPassword) }
})

const app = createApp()
const proxied = createApp({ trustProxy: true })

const email = 'owner@example.com'
const password = 'password123'

beforeAll(async () => {
  await migrateDb()
  await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { name: 'Owner', email, password },
  })
})

beforeEach(() => {
  signinLimiter.reset()
  passwordConfirmLimiter.reset()
  vi.mocked(verifyPassword).mockClear()
})

function signin(
  pass: string,
  options: {
    remoteAddress?: string
    forwardedFor?: string
    via?: typeof app
  } = {},
) {
  return (options.via ?? app).inject({
    method: 'POST',
    url: '/api/auth/signin',
    remoteAddress: options.remoteAddress ?? '192.168.1.10',
    headers: options.forwardedFor
      ? { 'x-forwarded-for': options.forwardedFor }
      : {},
    payload: { email, password: pass },
  })
}

describe('post /api/auth/signin attempt limit', () => {
  it('answers 429 after ten failures without checking the password', async () => {
    for (let i = 0; i < 10; i++)
      expect((await signin('wrong-password')).statusCode).toBe(400)

    vi.mocked(verifyPassword).mockClear()

    const res = await signin(password)

    expect(res.statusCode).toBe(429)
    expect(res.json()).toEqual({
      message: 'too_many_attempts',
      retryAfter: expect.any(Number),
    })
    expect(res.json().retryAfter).toBeGreaterThan(0)
    expect(Number(res.headers['retry-after'])).toBe(res.json().retryAfter)
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  it('counts unknown emails as failures', async () => {
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/signin',
        remoteAddress: '192.168.1.10',
        payload: { email: `nobody${i}@example.com`, password },
      })
    }

    expect((await signin(password)).statusCode).toBe(429)
  })

  it('keeps other client addresses open', async () => {
    for (let i = 0; i < 10; i++) await signin('wrong-password')

    expect(
      (await signin('wrong-password', { remoteAddress: '192.168.1.11' }))
        .statusCode,
    ).toBe(400)
  })

  it('resets the counter after a successful sign-in', async () => {
    for (let i = 0; i < 9; i++) await signin('wrong-password')

    expect((await signin(password)).statusCode).toBe(200)

    for (let i = 0; i < 9; i++)
      expect((await signin('wrong-password')).statusCode).toBe(400)
  })

  it('ignores X-Forwarded-For without a trusted proxy', async () => {
    for (let i = 0; i < 10; i++)
      await signin('wrong-password', { forwardedFor: `10.0.0.${i}` })

    expect(
      (await signin(password, { forwardedFor: '10.0.0.99' })).statusCode,
    ).toBe(429)
  })

  it('tells clients apart by X-Forwarded-For behind a trusted proxy', async () => {
    for (let i = 0; i < 10; i++) {
      await signin('wrong-password', {
        via: proxied,
        forwardedFor: '10.0.0.1',
      })
    }

    expect(
      (await signin(password, { via: proxied, forwardedFor: '10.0.0.1' }))
        .statusCode,
    ).toBe(429)
    expect(
      (await signin(password, { via: proxied, forwardedFor: '10.0.0.2' }))
        .statusCode,
    ).toBe(200)
  })
})

describe('current password confirmation limit', () => {
  async function owner() {
    const res = await signin(password)
    const cookies: Record<string, string> = {}

    for (const cookie of res.cookies) cookies[cookie.name] = cookie.value

    return cookies
  }

  it('answers 429 on the sixth wrong current password', async () => {
    const cookies = await owner()

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/users/me/password',
        cookies,
        payload: {
          currentPassword: 'wrong-password',
          newPassword: 'new-password',
        },
      })

      expect(res.statusCode).toBe(403)
    }

    vi.mocked(verifyPassword).mockClear()

    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/email',
      cookies,
      payload: { email: 'new@example.com', currentPassword: password },
    })

    expect(res.statusCode).toBe(429)
    expect(res.json().message).toBe('too_many_attempts')
    expect(res.headers['retry-after']).toBeDefined()
    expect(verifyPassword).not.toHaveBeenCalled()
  })
})
