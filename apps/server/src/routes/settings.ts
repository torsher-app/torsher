import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { config } from '../config.ts'
import { messageResponse } from '../dto/common.ts'
import {
  checkMetadataKey,
  imdbDatasetStatus,
  metadataKeyCheck,
  metadataSettings,
  updateImdbSettings,
  updateMetadataSettings,
} from '../dto/net.ts'
import { playbackSettings, updatePlaybackSettings } from '../dto/media.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  mediaAccel,
  recheckAccel,
  setAccelMode,
} from '../services/media/index.ts'
import {
  imdbStatus,
  refreshImdbNow,
  setImdbRatingsEnabled,
} from '../services/ratings/imdb/index.ts'
import { checkTmdbKey } from '../services/tmdb/client.ts'
import { saveTmdbKey, tmdbKeySource } from '../services/tmdb/credentials.ts'

function toMetadataResponse() {
  return {
    tmdb: {
      source: tmdbKeySource(),
      hasAppKey: Boolean(config.tmdbAccessToken),
    },
    imdb: imdbStatus(),
  }
}

const guardResponses = {
  401: messageResponse,
}

function toPlaybackResponse(state: Awaited<ReturnType<typeof mediaAccel>>) {
  const { mode, ...rest } = state

  return { accel: mode, ...rest }
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
  app.put(
    '/metadata/imdb',
    {
      schema: {
        operationId: 'putImdbSettings',
        tags: ['Settings'],
        body: updateImdbSettings,
        response: {
          200: imdbDatasetStatus,
          400: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request) => {
      await setImdbRatingsEnabled(request.body.enabled)

      return imdbStatus()
    },
  )

  // Загрузка идёт в фоне: ответ — состояние сразу после запуска
  app.post(
    '/metadata/imdb/refresh',
    {
      schema: {
        operationId: 'postImdbRefresh',
        tags: ['Settings'],
        response: {
          202: imdbDatasetStatus,
          409: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (_request, reply) => {
      if (!imdbStatus().enabled)
        return reply.code(409).send({ message: 'IMDb ratings are off' })

      refreshImdbNow()

      return reply.code(202).send(imdbStatus())
    },
  )

  app.get(
    '/playback',
    {
      schema: {
        operationId: 'getPlaybackSettings',
        tags: ['Settings'],
        response: { 200: playbackSettings, ...guardResponses },
      },
    },
    async () => toPlaybackResponse(await mediaAccel()),
  )

  app.put(
    '/playback',
    {
      schema: {
        operationId: 'putPlaybackSettings',
        tags: ['Settings'],
        body: updatePlaybackSettings,
        response: {
          200: playbackSettings,
          400: messageResponse,
          ...guardResponses,
        },
      },
    },
    async request =>
      toPlaybackResponse(await setAccelMode(request.body.accel)),
  )

  // Новые пробы видеокарты и замер процессора: после смены железа или драйвера
  app.post(
    '/playback/check',
    {
      schema: {
        operationId: 'postPlaybackCheck',
        tags: ['Settings'],
        response: { 200: playbackSettings, ...guardResponses },
      },
    },
    async () => toPlaybackResponse(await recheckAccel()),
  )
}
