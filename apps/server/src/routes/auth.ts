import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { randomUUID } from 'node:crypto'
import { REFRESH_TOKEN_COOKIE } from '../config.ts'
import { setupResponse, signin, signup } from '../dto/auth.ts'
import { messageResponse, tooManyAttemptsResponse } from '../dto/common.ts'
import { restoreInProgress } from '../services/backups/index.ts'
import {
  createOwner,
  findOwner,
  needsSetup,
  SetupDoneError,
  signinLimiter,
} from '../services/users/index.ts'
import { logFor } from '../services/logs/index.ts'
import { verifySession } from '../services/users/session.ts'
import { hashPassword, verifyPassword } from '../utils/password.ts'
import { normalizeUsername } from '../utils/username.ts'
import { clearSession, setSession } from './sessionCookies.ts'

let placeholderHash: Promise<string> | undefined

// Хеш для входа на сервер без аккаунта: argon2 считается и тогда, чтобы
// время ответа не отличалось
function passwordHashToCheck(storedHash: string | undefined) {
  if (storedHash)
    return storedHash

  placeholderHash ??= hashPassword(randomUUID())

  return placeholderHash
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
      const limitKey = `signin:${request.ip}`

      // Попытка засчитывается до проверки пароля: параллельные запросы не
      // проскочат лимит, пока argon2 считает
      if (signinLimiter.isLimited(limitKey) || !signinLimiter.hit(limitKey)) {
        const retryAfter = signinLimiter.retryAfter(limitKey)

        return reply
          .code(429)
          .header('Retry-After', String(retryAfter))
          .send({ message: 'too_many_attempts', retryAfter })
      }

      const user = findOwner()
      // Пароль проверяется и при неверном имени: ни ответ, ни его время не
      // подсказывают, что имя угадано
      const passwordOk = await verifyPassword(
        request.body.password,
        await passwordHashToCheck(user?.passwordHash),
      )

      if (
        !user
        || !passwordOk
        || normalizeUsername(user.username)
        !== normalizeUsername(request.body.username)
      ) {
        logFor('auth').warn({ ip: request.ip }, 'Sign-in failed')
        return reply
          .code(400)
          .send({ message: 'Invalid username or password' })
      }

      signinLimiter.reset(limitKey)

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
        // Отозванная сессия (сменился пароль или имя пользователя) не продлевается
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
