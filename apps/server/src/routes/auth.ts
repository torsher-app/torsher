import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { eq } from 'drizzle-orm'
import { REFRESH_TOKEN_COOKIE } from '../config.ts'
import { getDb } from '../db/index.ts'
import { users } from '../db/schema.ts'
import { setupResponse, signin, signup } from '../dto/auth.ts'
import { messageResponse } from '../dto/common.ts'
import {
  createOwner,
  needsSetup,
  SetupDoneError,
} from '../services/users/index.ts'
import { verifySession } from '../services/users/session.ts'
import { normalizeEmail } from '../utils/email.ts'
import { hashPassword, verifyPassword } from '../utils/password.ts'
import { clearSession, setSession } from './sessionCookies.ts'

// Drizzle может завернуть ошибку драйвера в свою, тогда код лежит в cause
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null)
    return false

  if ('code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE')
    return true

  return 'cause' in err && isUniqueViolation(err.cause)
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  // Без авторизации: форма входа по нему решает, показать ли создание аккаунта
  app.get(
    '/setup',
    {
      schema: {
        operationId: 'getAuthSetup',
        tags: ['Auth'],
        response: {
          200: setupResponse,
        },
      },
    },
    async () => ({ needsSetup: needsSetup() }),
  )

  // Создаёт единственный аккаунт — владельца сервера, только на пустой базе
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
          403: messageResponse,
          500: messageResponse,
        },
      },
    },
    async (request, reply) => {
      try {
        createOwner({
          name: request.body.name,
          email: normalizeEmail(request.body.email),
          passwordHash: await hashPassword(request.body.password),
        })

        return reply.code(201).send({ message: 'User created' })
      }
      catch (err) {
        if (err instanceof SetupDoneError)
          return reply.code(403).send({ message: 'Registration is closed' })

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

      setSession(reply, user)

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
        // Отозванная сессия (сменился пароль или email) не продлевается
        const { userId, sessionVersion } = verifySession(
          request.cookies[REFRESH_TOKEN_COOKIE] ?? '',
          'user_refresh',
        )

        setSession(reply, { id: userId, sessionVersion })

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
