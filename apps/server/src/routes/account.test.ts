import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../config.ts'
import { migrateDb } from '../db/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()

let username = 'Owner'
let password = 'password123'

beforeAll(async () => {
  await migrateDb()
  await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { username, password },
  })
})

type Cookies = Record<string, string>

function cookiesOf(res: { cookies: { name: string, value: string }[] }) {
  const cookies: Cookies = {}

  for (const cookie of res.cookies) {
    if (cookie.value)
      cookies[cookie.name] = cookie.value
  }

  return cookies
}

async function signin() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signin',
    payload: { username, password },
  })

  expect(res.statusCode).toBe(200)

  return cookiesOf(res)
}

function me(cookies: Cookies) {
  return app.inject({ url: '/api/users/me', cookies })
}

function refresh(cookies: Cookies) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    cookies: { [REFRESH_TOKEN_COOKIE]: cookies[REFRESH_TOKEN_COOKIE]! },
  })
}

describe('put /api/users/me/password', () => {
  it('без входа — 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/password',
      payload: { currentPassword: password, newPassword: 'new-password' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('неверный текущий пароль — 403 с полем', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/password',
      cookies: await signin(),
      payload: {
        currentPassword: 'wrong-password',
        newPassword: 'new-password',
      },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({
      message: 'Current password is incorrect',
      field: 'currentPassword',
    })
  })

  it('короткий новый пароль — 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/password',
      cookies: await signin(),
      payload: { currentPassword: password, newPassword: 'short' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('меняет пароль, выкидывает прочие сессии и оставляет текущую', async () => {
    const other = await signin()
    const current = await signin()

    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/password',
      cookies: current,
      payload: { currentPassword: password, newPassword: 'new-password' },
    })

    expect(res.statusCode).toBe(200)

    const renewed = cookiesOf(res)

    expect(renewed[ACCESS_TOKEN_COOKIE]).toBeDefined()
    expect(renewed[REFRESH_TOKEN_COOKIE]).toBeDefined()
    expect((await me(renewed)).statusCode).toBe(200)
    expect((await refresh(renewed)).statusCode).toBe(200)

    // Прежние токены — и той же вкладки, и другого браузера — больше не действуют
    expect((await me(current)).statusCode).toBe(401)
    expect((await me(other)).statusCode).toBe(401)
    expect((await refresh(other)).statusCode).toBe(401)

    const oldSignin = await app.inject({
      method: 'POST',
      url: '/api/auth/signin',
      payload: { username, password },
    })

    expect(oldSignin.statusCode).toBe(400)

    password = 'new-password'
    await signin()
  })

  it('отзывает и адрес потока прежней сессии', async () => {
    const stale = signToken((await me(await signin())).json().id, 'stream', 0)
    const res = await app.inject({
      url: `/api/stream/missing/0?token=${stale}`,
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('post /api/auth/signin', () => {
  function attempt(payload: { username: string, password: string }) {
    return app.inject({ method: 'POST', url: '/api/auth/signin', payload })
  }

  it('имя — без учёта регистра и пробелов по краям', async () => {
    const res = await attempt({
      username: `  ${username.toUpperCase()} `,
      password,
    })

    expect(res.statusCode).toBe(200)
  })

  it('неверное имя при верном пароле — тот же ответ, что неверный пароль', async () => {
    const wrongName = await attempt({ username: 'Somebody', password })
    const wrongPassword = await attempt({
      username,
      password: 'wrong-password',
    })

    expect(wrongName.statusCode).toBe(400)
    expect(wrongName.json()).toEqual(wrongPassword.json())
  })
})

describe('put /api/users/me/username', () => {
  it('неверный текущий пароль — 403 с полем', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/username',
      cookies: await signin(),
      payload: { username: 'Renamed', currentPassword: 'wrong-password' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().field).toBe('currentPassword')
  })

  it.each(['A', 'a'.repeat(65), 'Line\nbreak'])(
    'отклоняет имя %j — 400',
    async (value) => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/users/me/username',
        cookies: await signin(),
        payload: { username: value, currentPassword: password },
      })

      expect(res.statusCode).toBe(400)
    },
  )

  it('меняет имя, выкидывает прочие сессии и оставляет текущую', async () => {
    const other = await signin()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/username',
      cookies: await signin(),
      payload: { username: '  Антон Р. ', currentPassword: password },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().username).toBe('Антон Р.')

    const renewed = cookiesOf(res)

    expect((await me(renewed)).json().username).toBe('Антон Р.')
    expect((await me(other)).statusCode).toBe(401)

    const oldName = await app.inject({
      method: 'POST',
      url: '/api/auth/signin',
      payload: { username, password },
    })

    expect(oldName.statusCode).toBe(400)

    username = 'антон р.'
    await signin()
  })
})
