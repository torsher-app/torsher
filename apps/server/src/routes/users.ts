import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { User } from '../db/schema.ts'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/index.ts'
import { users } from '../db/schema.ts'
import { messageResponse } from '../dto/common.ts'
import { meResponse, updateMe } from '../dto/users.ts'
import { requireAuth } from '../middleware/auth.ts'

const responses = {
  200: meResponse,
  401: messageResponse,
  404: messageResponse,
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
      preHandler: requireAuth,
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
      preHandler: requireAuth,
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
}
