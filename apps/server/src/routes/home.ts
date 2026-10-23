import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import { homeQuery, homeResponse } from '../dto/home.ts'
import { requireViewer } from '../middleware/auth.ts'
import { withPosterRatings } from '../services/mine/index.ts'
import { personalHomeRows } from '../services/mine/home.ts'
import { getHomeRows } from '../services/tmdb/index.ts'
import { sendTmdbError } from './catalog.ts'

export const homeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '',
    {
      onRequest: requireViewer,
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
        // Личные ряды — только на главной, перед рядами TMDB
        const [personal, rows] = await Promise.all([
          mode === 'all' ? personalHomeRows(request.profileId, language) : [],
          getHomeRows(mode, language),
        ])

        return {
          rows: [...personal, ...rows].map(row => ({
            ...row,
            items: withPosterRatings(row.items, request.profileId),
          })),
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )
}
