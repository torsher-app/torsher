import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import {
  catalogSearchQuery,
  catalogSearchResponse,
  catalogSeasonParams,
  catalogTitleParams,
  catalogTitleQuery,
  catalogTrendingResponse,
  seasonDetails,
  titleDetails,
  titleExtras,
} from '../dto/catalog.ts'
import { messageResponse } from '../dto/common.ts'
import { requireViewer } from '../middleware/auth.ts'
import {
  getSeason,
  getTitle,
  getTitleExtras,
  getTrending,
  searchTitles,
  TmdbError,
} from '../services/tmdb/index.ts'

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

export function sendTmdbError(reply: FastifyReply, err: unknown) {
  if (!(err instanceof TmdbError))
    throw err

  return reply.code(TMDB_ERROR_STATUS[err.kind]).send({ message: err.message })
}

export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/search',
    {
      onRequest: requireViewer,
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
      onRequest: requireViewer,
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

  app.get(
    '/titles/:id/seasons/:number',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getCatalogSeason',
        tags: ['Catalog'],
        params: catalogSeasonParams,
        querystring: catalogTitleQuery,
        response: {
          200: seasonDetails,
          400: messageResponse,
          404: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const { id, number } = request.params

      try {
        const season = await getSeason(
          id,
          Number(number),
          request.query.language,
        )

        if (!season)
          return reply.code(404).send({ message: 'Season not found' })

        return season
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/titles/:id/extras',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getCatalogTitleExtras',
        tags: ['Catalog'],
        params: catalogTitleParams,
        querystring: catalogTitleQuery,
        response: {
          200: titleExtras,
          404: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const extras = await getTitleExtras(
          request.params.id,
          request.query.language,
        )

        if (!extras)
          return reply.code(404).send({ message: 'Title not found' })

        return extras
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/trending',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getCatalogTrending',
        tags: ['Catalog'],
        querystring: catalogTitleQuery,
        response: {
          200: catalogTrendingResponse,
          400: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return { items: await getTrending(request.query.language) }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )
}
