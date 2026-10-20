import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import { homeQuery, homeResponse } from '../dto/home.ts'
import { requireAuth } from '../middleware/auth.ts'
import { getHomeRows } from '../services/tmdb/index.ts'
import { sendTmdbError } from './catalog.ts'

export const homeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '',
    {
      preHandler: requireAuth,
      schema: {
        operationId: 'getHome',
        tags: ['Catalog'],
        querystring: homeQuery,
        response: {
          200: homeResponse,
          400: messageResponse,
          401: messageResponse,
          502: messageResponse,
          503: messageResponse,
        },
      },
    },
    async (request, reply) => {
      const { mode, language } = request.query

      try {
        return { rows: await getHomeRows(mode, language) }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )
}
