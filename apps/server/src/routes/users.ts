import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { User } from '../db/schema.ts'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/index.ts'
import { users } from '../db/schema.ts'
import type { FastifyReply } from 'fastify'
import { messageResponse, tooManyAttemptsResponse } from '../dto/common.ts'
import {
  changeEmail,
  changePassword,
  meResponse,
  updateMe,
  wrongPasswordResponse,
} from '../dto/users.ts'
import { requireOwner } from '../middleware/auth.ts'
import { logFor } from '../services/logs/index.ts'
import {
  findActiveUser,
  passwordConfirmLimiter,
  updateEmail,
  updatePassword,
} from '../services/users/index.ts'
import { normalizeEmail } from '../utils/email.ts'
import { hashPassword, verifyPassword } from '../utils/password.ts'
import { setSession } from './sessionCookies.ts'

const responses = {
  200: meResponse,
  401: messageResponse,
  404: messageResponse,
}

const WRONG_PASSWORD = {
  message: 'Current password is incorrect',
  field: 'currentPassword',
} as const

/**
 * Аккаунт запроса, если текущий пароль верен; иначе `undefined`. После пяти
 * неверных подряд отвечает 429 сам и возвращает `null`: пароль не проверяется.
 */
async function confirmPassword(
  reply: FastifyReply,
  userId: string,
  password: string,
) {
  const limitKey = `password-confirm:${userId}`

  if (
    passwordConfirmLimiter.isLimited(limitKey)
    || !passwordConfirmLimiter.hit(limitKey)
  ) {
    const retryAfter = passwordConfirmLimiter.retryAfter(limitKey)

    await reply
      .code(429)
      .header('Retry-After', String(retryAfter))
      .send({ message: 'too_many_attempts', retryAfter })

    return null
  }

  const user = findActiveUser(userId)

  if (user && (await verifyPassword(password, user.passwordHash))) {
    passwordConfirmLimiter.reset(limitKey)
    return user
  }
}

// Наружу отдаём явно собранный объект, а не строку таблицы (в ней passwordHash)
function toMeResponse(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  }
}

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getUsersMe',
        tags: ['Users'],
        response: responses,
      },
    },
    async (request, reply) => {
      const user = getDb()
        .select()
        .from(users)
        .where(eq(users.id, request.userId))
        .get()

      if (!user || user.isDeleted)
        return reply.code(404).send({ message: 'User not found' })

      return toMeResponse(user)
    },
  )

  app.patch(
    '/me',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'patchUsersMe',
        tags: ['Users'],
        body: updateMe,
        response: responses,
      },
    },
    async (request, reply) => {
      const user = getDb()
        .update(users)
        .set(request.body)
        .where(and(eq(users.id, request.userId), eq(users.isDeleted, false)))
        .returning()
        .get()

      if (!user)
        return reply.code(404).send({ message: 'User not found' })

      return toMeResponse(user)
    },
  )

  // Смена пароля и email выкидывает все прочие сессии (версия сессий растёт),
  // а текущая получает новые cookie и остаётся во входе
  app.put(
    '/me/password',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'putUsersMePassword',
        tags: ['Users'],
        body: changePassword,
        response: {
          200: messageResponse,
          401: messageResponse,
          403: wrongPasswordResponse,
          429: tooManyAttemptsResponse,
        },
      },
    },
    async (request, reply) => {
      const user = await confirmPassword(
        reply,
        request.userId,
        request.body.currentPassword,
      )

      if (user === null)
        return reply

      if (!user)
        return reply.code(403).send(WRONG_PASSWORD)

      setSession(
        reply,
        updatePassword(user.id, await hashPassword(request.body.newPassword)),
      )
      logFor('auth').info({ userId: user.id }, 'Password changed')

      return { message: 'Password changed' }
    },
  )

  app.put(
    '/me/email',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'putUsersMeEmail',
        tags: ['Users'],
        body: changeEmail,
        response: {
          200: meResponse,
          401: messageResponse,
          403: wrongPasswordResponse,
          429: tooManyAttemptsResponse,
        },
      },
    },
    async (request, reply) => {
      const user = await confirmPassword(
        reply,
        request.userId,
        request.body.currentPassword,
      )

      if (user === null)
        return reply

      if (!user)
        return reply.code(403).send(WRONG_PASSWORD)

      const updated = updateEmail(user.id, normalizeEmail(request.body.email))

      setSession(reply, updated)

      return toMeResponse(updated)
    },
  )
}
