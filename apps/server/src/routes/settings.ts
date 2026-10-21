import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { config } from '../config.ts'
import { messageResponse } from '../dto/common.ts'
import {
  checkMetadataKey,
  metadataKeyCheck,
  metadataSettings,
  updateMetadataSettings,
} from '../dto/net.ts'
import { requireOwner } from '../middleware/auth.ts'
import { checkTmdbKey } from '../services/tmdb/client.ts'
import { saveTmdbKey, tmdbKeySource } from '../services/tmdb/credentials.ts'

function toMetadataResponse() {
  return {
    tmdb: {
      source: tmdbKeySource(),
      hasAppKey: Boolean(config.tmdbAccessToken),
    },
  }
}

const guardResponses = {
  401: messageResponse,
}

/** Настройки сервера: только сессия аккаунта. Ключи в ответы не попадают */
export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '/metadata',
    {
      schema: {
        operationId: 'getMetadataSettings',
        tags: ['Settings'],
        response: { 200: metadataSettings, ...guardResponses },
      },
    },
    async () => toMetadataResponse(),
  )

  app.put(
    '/metadata',
    {
      schema: {
        operationId: 'putMetadataSettings',
        tags: ['Settings'],
        body: updateMetadataSettings,
        response: {
          200: metadataSettings,
          400: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request) => {
      saveTmdbKey(request.body.tmdbKey)

      return toMetadataResponse()
    },
  )

  // Неудачная проверка — не ошибка запроса: итог в `ok` и `kind`
  app.post(
    '/metadata/check',
    {
      schema: {
        operationId: 'postMetadataCheck',
        tags: ['Settings'],
        body: checkMetadataKey,
        response: {
          200: metadataKeyCheck,
          400: messageResponse,
          ...guardResponses,
        },
      },
    },
    async request => checkTmdbKey(request.body.tmdbKey),
  )
}
