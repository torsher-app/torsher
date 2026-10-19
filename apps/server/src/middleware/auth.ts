import type { FastifyReply, FastifyRequest } from 'fastify'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { verifyTokenFor } from '../utils/token.ts'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
  }
}

/**
 * preHandler защищённых роутов: без валидного access-cookie хендлер не вызывается,
 * а в хендлере `request.userId` всегда заполнен.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = request.cookies[ACCESS_TOKEN_COOKIE] ?? ''

  try {
    request.userId = verifyTokenFor(token, 'user_access').userId
  }
  catch {
    return reply.code(401).send({ message: 'Unauthorized' })
  }
}
