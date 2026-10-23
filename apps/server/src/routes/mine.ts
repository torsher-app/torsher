import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import {
  mineItemsQuery,
  mineItems as mineItemsResponse,
  mineResponse,
  titleMineQuery,
} from '../dto/mine.ts'
import { requireViewer } from '../middleware/auth.ts'
import {
  mineItems,
  MineNotFoundError,
  mineSections,
  withPosterRatings,
} from '../services/mine/index.ts'

const guardResponses = {
  401: messageResponse,
}

/** Экран «Моё»: разделы профиля и их содержимое */
export const mineRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireViewer)

  app.get(
    '',
    {
      schema: {
        operationId: 'getMine',
        tags: ['Mine'],
        querystring: titleMineQuery,
        response: {
          200: mineResponse,
          400: messageResponse,
          ...guardResponses,
        },
      },
    },
    async request => ({
      sections: await mineSections(request.profileId, request.query.language),
    }),
  )

  app.get(
    '/items',
    {
      schema: {
        operationId: 'getMineItems',
        tags: ['Mine'],
        querystring: mineItemsQuery,
        response: {
          200: mineItemsResponse,
          400: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const page = await mineItems(request.profileId, request.query)

        return {
          ...page,
          items: withPosterRatings(page.items, request.profileId),
        }
      }
      catch (err) {
        if (err instanceof MineNotFoundError)
          return reply.code(404).send({ message: err.message })

        throw err
      }
    },
  )
}
