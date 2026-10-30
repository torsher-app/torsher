import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import {
  createIndexerManager,
  deleteIndexerManagerQuery,
  idParams,
  indexerManagerList,
  indexerManagerSyncResult,
  sourceErrorResponse,
} from '../dto/sources.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  checkIndexers,
  deleteManager,
  importManager,
  listManagers,
  syncManager,
} from '../services/indexers/index.ts'
import {
  logCheckError,
  sendSourceError,
  toManagerResponse,
  toSyncResponse,
} from './sourceResponses.ts'

const guardResponses = {
  401: messageResponse,
}

export const indexerManagerRoutes: FastifyPluginAsyncZod = async (app) => {
  // onRequest, а не preHandler: без входа ответ 401 приходит до разбора
  // тела, а не 400 о неверных полях
  app.addHook('onRequest', requireOwner)

  app.get(
    '',
    {
      schema: {
        operationId: 'getIndexerManagers',
        tags: ['Sources'],
        response: { 200: indexerManagerList, ...guardResponses },
      },
    },
    async () => ({ items: listManagers().map(toManagerResponse) }),
  )

  // Импорт и повторный импорт того же менеджера: индексаторы проверяются
  // после ответа, результат появляется в списке индексаторов
  app.post(
    '',
    {
      schema: {
        operationId: 'postIndexerManager',
        tags: ['Sources'],
        body: createIndexerManager,
        response: {
          200: indexerManagerSyncResult,
          400: messageResponse,
          422: sourceErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await importManager(request.body)

        void checkIndexers(result.toCheck, logCheckError)

        return toSyncResponse(result)
      }
      catch (err) {
        return sendSourceError(reply, err, request.body.url)
      }
    },
  )

  app.post(
    '/:id/sync',
    {
      schema: {
        operationId: 'postIndexerManagerSync',
        tags: ['Sources'],
        params: idParams,
        response: {
          200: indexerManagerSyncResult,
          404: messageResponse,
          422: sourceErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await syncManager(request.params.id)

        if (!result)
          return reply.code(404).send({ message: 'Indexer manager not found' })

        void checkIndexers(result.toCheck, logCheckError)

        return toSyncResponse(result)
      }
      catch (err) {
        return sendSourceError(reply, err)
      }
    },
  )

  app.delete(
    '/:id',
    {
      schema: {
        operationId: 'deleteIndexerManager',
        tags: ['Sources'],
        params: idParams,
        querystring: deleteIndexerManagerQuery,
        response: {
          200: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!deleteManager(request.params.id, request.query.indexers))
        return reply.code(404).send({ message: 'Indexer manager not found' })

      return { message: 'Indexer manager deleted' }
    },
  )
}
