import type { FastifyReply, FastifyRequest } from 'fastify'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { verifySession } from '../services/users/session.ts'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
  }
}

/**
 * preHandler защищённых роутов: без валидного access-cookie хендлер не вызывается,
 * а в хендлере `request.userId` всегда заполнен. Токен отозванной сессии
 * (сменился пароль или email) получает 401, как и просроченный.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = request.cookies[ACCESS_TOKEN_COOKIE] ?? ''

  try {
    request.userId = verifySession(token, 'user_access').userId
  }
  catch {
    return reply.code(401).send({ message: 'Unauthorized' })
  }
}
