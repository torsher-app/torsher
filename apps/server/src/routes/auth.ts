import { logSessionRejected } from '../services/auth/logDiagnostics.ts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { REFRESH_TOKEN_COOKIE } from '../config.ts'
import { setupResponse, signin, signup } from '../dto/auth.ts'
import { messageResponse, tooManyAttemptsResponse } from '../dto/common.ts'
import { restoreInProgress } from '../services/backups/index.ts'
import {
  createOwner,
  needsSetup,
  SetupDoneError,
} from '../services/users/index.ts'
import { verifyOwnerCredentials } from '../services/users/credentials.ts'
import { verifySession } from '../services/users/session.ts'
import { hashPassword } from '../utils/password.ts'
import { clearSession, setSession } from './sessionCookies.ts'

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
          409: messageResponse,
          500: messageResponse,
        },
      },
    },
    async (request, reply) => {
      try {
        const passwordHash = await hashPassword(request.body.password)

        // Проверка и создание — без `await` между ними: восстановление на
        // пустом сервере перепроверяет аккаунт так же синхронно
        if (restoreInProgress()) {
          return reply
            .code(409)
            .send({ message: 'Restore from a backup is in progress' })
        }

        createOwner({ username: request.body.username, passwordHash })

        return reply.code(201).send({ message: 'User created' })
      }
      catch (err) {
        if (err instanceof SetupDoneError)
          return reply.code(403).send({ message: 'Registration is closed' })

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
          429: tooManyAttemptsResponse,
        },
      },
    },
    async (request, reply) => {
      const result = await verifyOwnerCredentials(request.body, request.ip)

      if (!result.ok) {
        if (result.retryAfter !== undefined)
          reply.header('Retry-After', String(result.retryAfter))
        return reply.code(result.status).send({
          message: result.message,
          ...(result.retryAfter === undefined
            ? {}
            : { retryAfter: result.retryAfter }),
        })
      }

      const user = result.user

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
        // Отозванная сессия (сменился пароль или имя пользователя) не продлевается
        const { userId, sessionVersion } = verifySession(
          request.cookies[REFRESH_TOKEN_COOKIE] ?? '',
          'user_refresh',
        )

        setSession(reply, { id: userId, sessionVersion })

        return { message: 'Refreshed' }
      }
      catch (error) {
        logSessionRejected(
          request,
          'refresh',
          error,
          !request.cookies[REFRESH_TOKEN_COOKIE],
        )
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
