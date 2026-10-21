import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import {
  createIndexer,
  idParams,
  indexer,
  indexerList,
  sourceErrorResponse,
  updateIndexer,
} from '../dto/sources.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  checkIndexer,
  createManualIndexer,
  deleteIndexer,
  listIndexers,
  updateIndexer as patchIndexer,
} from '../services/indexers/index.ts'
import { sendSourceError, toIndexerResponse } from './sourceResponses.ts'

const guardResponses = {
  401: messageResponse,
}

export const indexerRoutes: FastifyPluginAsyncZod = async (app) => {
  // onRequest, а не preHandler: без входа ответ 401 приходит до разбора
  // тела, а не 400 о неверных полях
  app.addHook('onRequest', requireOwner)

  app.get(
    '',
    {
      schema: {
        operationId: 'getIndexers',
        tags: ['Sources'],
        response: { 200: indexerList, ...guardResponses },
      },
    },
    async () => ({ items: listIndexers().map(toIndexerResponse) }),
  )

  app.post(
    '',
    {
      schema: {
        operationId: 'postIndexer',
        tags: ['Sources'],
        body: createIndexer,
        response: {
          201: indexer,
          400: messageResponse,
          422: sourceErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const created = await createManualIndexer(request.body)

        return reply.code(201).send(toIndexerResponse(created))
      }
      catch (err) {
        return sendSourceError(reply, err)
      }
    },
  )

  app.patch(
    '/:id',
    {
      schema: {
        operationId: 'patchIndexer',
        tags: ['Sources'],
        params: idParams,
        body: updateIndexer,
        response: {
          200: indexer,
          400: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const updated = patchIndexer(request.params.id, request.body)

      if (!updated)
        return reply.code(404).send({ message: 'Indexer not found' })

      return toIndexerResponse(updated)
    },
  )

  app.delete(
    '/:id',
    {
      schema: {
        operationId: 'deleteIndexer',
        tags: ['Sources'],
        params: idParams,
        response: {
          200: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!deleteIndexer(request.params.id))
        return reply.code(404).send({ message: 'Indexer not found' })

      return { message: 'Indexer deleted' }
    },
  )

  // Неудачная проверка — не ошибка запроса: результат записан в индексатор
  app.post(
    '/:id/test',
    {
      schema: {
        operationId: 'postIndexerTest',
        tags: ['Sources'],
        params: idParams,
        response: {
          200: indexer,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const checked = await checkIndexer(request.params.id)

      if (!checked)
        return reply.code(404).send({ message: 'Indexer not found' })

      return toIndexerResponse(checked)
    },
  )
}
