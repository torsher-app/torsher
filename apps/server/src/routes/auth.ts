import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { eq } from 'drizzle-orm'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  sessionCookieOptions,
} from '../config.ts'
import { getDb } from '../db/index.ts'
import { users } from '../db/schema.ts'
import { signin, signup } from '../dto/auth.ts'
import { messageResponse } from '../dto/common.ts'
import { normalizeEmail } from '../utils/email.ts'
import { hashPassword, verifyPassword } from '../utils/password.ts'
import { generateSessionTokens, verifyTokenFor } from '../utils/token.ts'

// Drizzle может завернуть ошибку драйвера в свою, тогда код лежит в cause
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null)
    return false

  if ('code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE')
    return true

  return 'cause' in err && isUniqueViolation(err.cause)
}

function setSession(reply: FastifyReply, userId: string) {
  const { accessToken, refreshToken } = generateSessionTokens(userId)

  reply.setCookie(ACCESS_TOKEN_COOKIE, accessToken, sessionCookieOptions)
  reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, sessionCookieOptions)
}

function clearSession(reply: FastifyReply) {
  reply.clearCookie(ACCESS_TOKEN_COOKIE, { path: sessionCookieOptions.path })
  reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: sessionCookieOptions.path })
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/signup',
    {
      schema: {
        operationId: 'postAuthSignup',
        tags: ['Auth'],
        body: signup,
        response: {
          201: messageResponse,
          400: messageResponse,
          500: messageResponse,
        },
      },
    },
    async (request, reply) => {
      try {
        getDb()
          .insert(users)
          .values({
            name: request.body.name,
            email: normalizeEmail(request.body.email),
            passwordHash: await hashPassword(request.body.password),
          })
          .run()

        return reply.code(201).send({ message: 'User created' })
      }
      catch (err) {
        if (isUniqueViolation(err))
          return reply.code(400).send({ message: 'Email already in use' })

        request.log.error(err)

        return reply
          .code(500)
          .send({ message: 'Something went wrong, try later' })
      }
    },
  )

  app.post(
    '/signin',
    {
      schema: {
        operationId: 'postAuthSignin',
        tags: ['Auth'],
        body: signin,
        response: {
          200: messageResponse,
          400: messageResponse,
          403: messageResponse,
        },
      },
    },
    async (request, reply) => {
      const user = getDb()
        .select()
        .from(users)
        .where(eq(users.email, normalizeEmail(request.body.email)))
        .get()

      // Одинаковый ответ на несуществующий email и неверный пароль,
      // чтобы форма логина не превращалась в проверку существования аккаунта
      if (
        !user
        || !(await verifyPassword(request.body.password, user.passwordHash))
      ) {
        return reply.code(400).send({ message: 'Invalid email or password' })
      }

      if (user.isBanned || user.isDeleted)
        return reply.code(403).send({ message: 'Account is not available' })

      if (!user.isActive)
        return reply.code(403).send({ message: 'Account is not active' })

      setSession(reply, user.id)

      return { message: 'Signed in' }
    },
  )

  app.post(
    '/refresh',
    {
      schema: {
        operationId: 'postAuthRefresh',
        tags: ['Auth'],
        response: {
          200: messageResponse,
          401: messageResponse,
        },
      },
    },
    async (request, reply) => {
      try {
        const { userId } = verifyTokenFor(
          request.cookies[REFRESH_TOKEN_COOKIE] ?? '',
          'user_refresh',
        )

        setSession(reply, userId)

        return { message: 'Refreshed' }
      }
      catch {
        clearSession(reply)

        return reply.code(401).send({ message: 'Invalid token' })
      }
    },
  )

  app.post(
    '/logout',
    {
      schema: {
        operationId: 'postAuthLogout',
        tags: ['Auth'],
        response: {
          200: messageResponse,
        },
      },
    },
    async (_request, reply) => {
      clearSession(reply)

      return { message: 'Signed out' }
    },
  )
}
