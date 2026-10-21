import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { config } from '../config.ts'
import { signToken, verifyTokenFor } from './token.ts'

describe('verifyTokenFor', () => {
  it('принимает токен с ожидаемым purpose', () => {
    const token = signToken('user-1', 'user_access')

    expect(verifyTokenFor(token, 'user_access').userId).toBe('user-1')
  })

  it('отвергает токен, выданный для другой цели', () => {
    const refresh = signToken('user-1', 'user_refresh')

    expect(() => verifyTokenFor(refresh, 'user_access')).toThrow()
  })

  it('отвергает токен без purpose', () => {
    const token = jwt.sign({ userId: 'user-1' }, config.secretKey, {
      expiresIn: 15 * 60,
      algorithm: 'HS256',
    })

    expect(() => verifyTokenFor(token, 'user_access')).toThrow()
  })

  it('отвергает токен с чужой подписью', () => {
    const token = jwt.sign(
      { userId: 'user-1', purpose: 'user_access' },
      'another-secret',
      { expiresIn: 15 * 60, algorithm: 'HS256' },
    )

    expect(() => verifyTokenFor(token, 'user_access')).toThrow()
  })

  it('отвергает access-токен с подделанным сроком жизни', () => {
    const token = jwt.sign(
      { userId: 'user-1', purpose: 'user_access' },
      config.secretKey,
      { expiresIn: 30 * 24 * 60 * 60, algorithm: 'HS256' },
    )

    expect(() => verifyTokenFor(token, 'user_access')).toThrow()
  })

  it('отдаёт версию сессий, а токен без неё считает версией 0', () => {
    const versioned = signToken('user-1', 'user_access', 3)
    const legacy = jwt.sign(
      { userId: 'user-1', purpose: 'user_access' },
      config.secretKey,
      { expiresIn: 15 * 60, algorithm: 'HS256' },
    )

    expect(verifyTokenFor(versioned, 'user_access').sessionVersion).toBe(3)
    expect(verifyTokenFor(legacy, 'user_access').sessionVersion).toBe(0)
  })
})
