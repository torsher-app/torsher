import jwt from 'jsonwebtoken'
import { config } from '../config.ts'

/**
 * Время жизни задаётся здесь и проверяется при верификации: токен,
 * подписанный на другой срок, отвергается. Это не даёт использовать
 * долгоживущий refresh там, где ожидается короткий access.
 */
export const TOKEN_TTL = {
  user_access: 15 * 60,
  user_refresh: 7 * 24 * 60 * 60,
  email_verify: 15 * 60,
  password_reset: 15 * 60,
} as const

export type TokenPurpose = keyof typeof TOKEN_TTL

export interface VerifiedToken {
  userId: string
  purpose: TokenPurpose
  iat: number
  exp: number
}

export function signToken(userId: string, purpose: TokenPurpose) {
  return jwt.sign({ userId, purpose }, config.secretKey, {
    expiresIn: TOKEN_TTL[purpose],
    algorithm: 'HS256',
  })
}

export function generateSessionTokens(userId: string) {
  return {
    accessToken: signToken(userId, 'user_access'),
    refreshToken: signToken(userId, 'user_refresh'),
  }
}

export function verifyTokenFor(
  token: string,
  expectedPurpose: TokenPurpose,
): VerifiedToken {
  const payload = jwt.verify(token, config.secretKey, {
    algorithms: ['HS256'],
  })

  if (typeof payload !== 'object' || payload === null)
    throw new TypeError('Invalid token payload')

  const { userId, purpose, iat, exp } = payload as Record<string, unknown>

  if (
    typeof userId !== 'string'
    || userId.length === 0
    || typeof iat !== 'number'
    || typeof exp !== 'number'
  ) {
    throw new TypeError('Invalid token claims')
  }

  if (purpose !== expectedPurpose)
    throw new TypeError('Invalid token purpose')

  if (Math.abs(exp - iat - TOKEN_TTL[expectedPurpose]) > 5)
    throw new TypeError('Invalid token TTL')

  return { userId, purpose: expectedPurpose, iat, exp }
}
