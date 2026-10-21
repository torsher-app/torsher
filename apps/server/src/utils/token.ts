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
  // Адрес потока для `<video>`: он сам не обновит сессию, а access-cookie
  // истекает посреди фильма. Срок — с запасом на длинный фильм с паузами
  stream: 12 * 60 * 60,
} as const

export type TokenPurpose = keyof typeof TOKEN_TTL

export interface VerifiedToken {
  userId: string
  purpose: TokenPurpose
  sessionVersion: number
  iat: number
  exp: number
}

/**
 * `sv` — версия сессий аккаунта на момент выдачи (`users.sessionVersion`):
 * токен старой версии отвергает `verifySession` из `services/users`.
 */
export function signToken(
  userId: string,
  purpose: TokenPurpose,
  sessionVersion = 0,
) {
  return jwt.sign({ userId, purpose, sv: sessionVersion }, config.secretKey, {
    expiresIn: TOKEN_TTL[purpose],
    algorithm: 'HS256',
  })
}

export function generateSessionTokens(userId: string, sessionVersion: number) {
  return {
    accessToken: signToken(userId, 'user_access', sessionVersion),
    refreshToken: signToken(userId, 'user_refresh', sessionVersion),
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

  const { userId, purpose, sv, iat, exp } = payload as Record<string, unknown>

  if (
    typeof userId !== 'string'
    || userId.length === 0
    || (sv !== undefined && !Number.isInteger(sv))
    || typeof iat !== 'number'
    || typeof exp !== 'number'
  ) {
    throw new TypeError('Invalid token claims')
  }

  if (purpose !== expectedPurpose)
    throw new TypeError('Invalid token purpose')

  if (Math.abs(exp - iat - TOKEN_TTL[expectedPurpose]) > 5)
    throw new TypeError('Invalid token TTL')

  // Токены, выданные до появления версии сессий, считаются версией 0:
  // обновление сервера никого не разлогинивает
  return {
    userId,
    purpose: expectedPurpose,
    sessionVersion: (sv as number | undefined) ?? 0,
    iat,
    exp,
  }
}
