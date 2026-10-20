import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import {
  catalogSearchQuery,
  catalogSearchResponse,
  catalogTitleParams,
  catalogTitleQuery,
  titleDetails,
} from '../dto/catalog.ts'
import { messageResponse } from '../dto/common.ts'
import { requireAuth } from '../middleware/auth.ts'
import { getTitle, searchTitles, TmdbError } from '../services/tmdb/index.ts'

const errorResponses = {
  401: messageResponse,
  502: messageResponse,
  503: messageResponse,
}

const TMDB_ERROR_STATUS = {
  config: 503,
  not_found: 404,
  unavailable: 502,
} as const

function sendTmdbError(reply: FastifyReply, err: unknown) {
  if (!(err instanceof TmdbError))
    throw err

  return reply.code(TMDB_ERROR_STATUS[err.kind]).send({ message: err.message })
}

export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/search',
    {
      preHandler: requireAuth,
      schema: {
        operationId: 'getCatalogSearch',
        tags: ['Catalog'],
        querystring: catalogSearchQuery,
        response: {
          200: catalogSearchResponse,
          400: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const { query, language } = request.query

      try {
        return { items: await searchTitles(query, language) }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/titles/:id',
    {
      preHandler: requireAuth,
      schema: {
        operationId: 'getCatalogTitle',
        tags: ['Catalog'],
        params: catalogTitleParams,
        querystring: catalogTitleQuery,
        response: {
          200: titleDetails,
          404: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const details = await getTitle(
          request.params.id,
          request.query.language,
        )

        if (!details)
          return reply.code(404).send({ message: 'Title not found' })

        return details
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )
}
