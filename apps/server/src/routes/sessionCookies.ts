import type { FastifyReply } from 'fastify'
import type { User } from '../db/schema.ts'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  sessionCookieOptions,
} from '../config.ts'
import { generateSessionTokens } from '../utils/token.ts'

export function setSession(
  reply: FastifyReply,
  user: Pick<User, 'id' | 'sessionVersion'>,
) {
  const { accessToken, refreshToken } = generateSessionTokens(
    user.id,
    user.sessionVersion,
  )

  reply.setCookie(ACCESS_TOKEN_COOKIE, accessToken, sessionCookieOptions)
  reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, sessionCookieOptions)
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(ACCESS_TOKEN_COOKIE, { path: sessionCookieOptions.path })
  reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: sessionCookieOptions.path })
}
