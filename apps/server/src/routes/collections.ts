import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { CollectionWithCounts } from '../services/collections/index.ts'
import {
  collectionErrorResponse,
  collectionList,
  collectionParams,
  collection as collectionResponse,
  collectionTitleParams,
  collectionTitles,
  collectionTitlesQuery,
  createCollection as createCollectionBody,
  updateCollection as updateCollectionBody,
} from '../dto/collections.ts'
import { messageResponse } from '../dto/common.ts'
import { requireByRoute } from '../middleware/auth.ts'
import {
  addToCollection,
  CollectionNameTakenError,
  createCollection,
  deleteCollection,
  getCollection,
  isVisibleTo,
  listCollections,
  removeFromCollection,
  updateCollection,
} from '../services/collections/index.ts'
import { collectionCards } from '../services/mine/index.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'

const guardResponses = {
  401: messageResponse,
}

const notFound = { message: 'Collection not found' }
const duplicate = {
  message: 'Collection with this name already exists',
  kind: 'duplicate' as const,
}

function toCollectionResponse(row: CollectionWithCounts) {
  return {
    id: row.id,
    name: row.name,
    count: row.count,
    showOnHome: row.showOnHome,
    hiddenFrom: row.hiddenFrom,
  }
}

/**
 * Подборки: общие на сервер, правит их панель; витрина только кладёт и убирает
 * тайтлы — в подборки, видимые профилю.
 */
export const collectionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireByRoute)

  app.get(
    '',
    {
      schema: {
        operationId: 'getCollections',
        tags: ['Collections'],
        response: { 200: collectionList, ...guardResponses },
      },
    },
    async () => ({ items: listCollections().map(toCollectionResponse) }),
  )

  app.post(
    '',
    {
      schema: {
        operationId: 'postCollection',
        tags: ['Collections'],
        body: createCollectionBody,
        response: {
          201: collectionResponse,
          400: messageResponse,
          409: collectionErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const created = createCollection(request.body)

        return reply.code(201).send(toCollectionResponse(created))
      }
      catch (err) {
        if (err instanceof CollectionNameTakenError)
          return reply.code(409).send(duplicate)

        throw err
      }
    },
  )

  app.patch(
    '/:id',
    {
      schema: {
        operationId: 'patchCollection',
        tags: ['Collections'],
        params: collectionParams,
        body: updateCollectionBody,
        response: {
          200: collectionResponse,
          400: messageResponse,
          404: messageResponse,
          409: collectionErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const updated = updateCollection(request.params.id, request.body)

        if (!updated)
          return reply.code(404).send(notFound)

        return toCollectionResponse(updated)
      }
      catch (err) {
        if (err instanceof CollectionNameTakenError)
          return reply.code(409).send(duplicate)

        throw err
      }
    },
  )

  app.delete(
    '/:id',
    {
      schema: {
        operationId: 'deleteCollection',
        tags: ['Collections'],
        params: collectionParams,
        response: {
          200: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!deleteCollection(request.params.id))
        return reply.code(404).send(notFound)

      return { message: 'Collection deleted' }
    },
  )

  app.get(
    '/:id/titles',
    {
      schema: {
        operationId: 'getCollectionTitles',
        tags: ['Collections'],
        params: collectionParams,
        querystring: collectionTitlesQuery,
        response: {
          200: collectionTitles,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!getCollection(request.params.id))
        return reply.code(404).send(notFound)

      return {
        items: await collectionCards(request.params.id, request.query.language),
      }
    },
  )

  // Витрина кладёт тайтл только в подборку, видимую профилю; владелец — в любую
  function canEdit(
    request: { deviceId: string | null, profileId: string },
    id: string,
  ) {
    if (!getCollection(id))
      return false

    return request.deviceId === null || isVisibleTo(id, request.profileId)
  }

  app.put(
    '/:id/titles/:titleId',
    {
      config: { viewer: true },
      schema: {
        operationId: 'putCollectionTitle',
        tags: ['Collections'],
        params: collectionTitleParams,
        response: {
          200: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const { id, titleId } = request.params

      if (!parseCatalogId(titleId) || !canEdit(request, id))
        return reply.code(404).send(notFound)

      addToCollection(id, titleId, request.profileId)

      return { message: 'Title added' }
    },
  )

  app.delete(
    '/:id/titles/:titleId',
    {
      config: { viewer: true },
      schema: {
        operationId: 'deleteCollectionTitle',
        tags: ['Collections'],
        params: collectionTitleParams,
        response: {
          200: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const { id, titleId } = request.params

      if (!canEdit(request, id))
        return reply.code(404).send(notFound)

      removeFromCollection(id, titleId)

      return { message: 'Title removed' }
    },
  )
}
