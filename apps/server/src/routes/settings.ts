import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import {
  checkMetadataKey,
  imdbDatasetStatus,
  metadataKeyCheck,
  metadataSettings,
  updateImdbSettings,
  updateMetadataSettings,
} from '../dto/net.ts'
import { followSettingsResponse, updateFollowSettings } from '../dto/follow.ts'
import { playbackSettings, updatePlaybackSettings } from '../dto/media.ts'
import {
  restartBlockedResponse,
  torrentSettings,
  updateTorrentSettings,
} from '../dto/torrentSettings.ts'
import { config } from '../config.ts'
import {
  engineState,
  isEngineReady,
  putEngineSettings,
  restartEngine,
} from '../services/engine/index.ts'
import {
  followSettings,
  saveFollowSettings,
} from '../services/follow/settings.ts'
import { logFor } from '../services/logs/index.ts'
import { anyMoving } from '../services/storage/moving.ts'
import { streamingCount } from '../services/storage/index.ts'
import { liveTorrents } from '../services/torrents/index.ts'
import { enforceSeeding } from '../services/torrents/seeding.ts'
import {
  customTorrentKeys,
  defaultTorrentSettings,
  getTorrentSettings,
  liveSettingsOf,
  pendingRestartKeys,
  saveTorrentSettings,
} from '../services/torrents/settings.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  mediaAccel,
  playbackSettingsOf,
  recheckAccel,
  setAccelMode,
} from '../services/media/index.ts'
import {
  imdbStatus,
  refreshImdbNow,
  setImdbRatingsEnabled,
} from '../services/ratings/imdb/index.ts'
import { checkTmdbKey } from '../services/tmdb/client.ts'
import {
  saveTmdbKey,
  tmdbDefaultKey,
  tmdbKeySource,
} from '../services/tmdb/credentials.ts'

function toMetadataResponse() {
  return {
    tmdb: {
      source: tmdbKeySource(),
      defaultKey: tmdbDefaultKey(),
    },
    imdb: imdbStatus(),
  }
}

const guardResponses = {
  401: messageResponse,
}

function restartBlocked() {
  if (engineState() !== 'ready')
    return 'not_running' as const

  // Перенос переживает перезапуск, но начнётся заново: ждём, пока закончится
  if (anyMoving())
    return 'moving' as const

  return null
}

function toTorrentSettingsResponse() {
  const values = getTorrentSettings()

  return {
    values,
    defaults: defaultTorrentSettings(),
    custom: customTorrentKeys(),
    peerPortEnv: config.enginePeerPort || null,
    pendingRestart: pendingRestartKeys(values),
    restartBlocked: restartBlocked(),
    activeStreams: streamingCount(),
  }
}

const LIVE_KEYS = new Set([
  'downloadLimit',
  'uploadLimit',
  'activeDownloads',
  'connsPerTorrent',
  'connsTotal',
])

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
    async () => playbackSettingsOf(await mediaAccel()),
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
      playbackSettingsOf(await setAccelMode(request.body.accel)),
  )

  app.get(
    '/torrent',
    {
      schema: {
        operationId: 'getTorrentSettings',
        tags: ['Settings'],
        response: { 200: torrentSettings, ...guardResponses },
      },
    },
    async () => toTorrentSettingsResponse(),
  )

  // Лимиты, очередь и соединения движок применяет сразу; без движка — при
  // его запуске, они уходят флагами. Сеть — только после перезапуска
  app.put(
    '/torrent',
    {
      schema: {
        operationId: 'putTorrentSettings',
        tags: ['Settings'],
        body: updateTorrentSettings,
        response: {
          200: torrentSettings,
          400: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request) => {
      const saved = saveTorrentSettings(request.body)
      const keys = Object.keys(request.body)

      if (isEngineReady() && keys.some(key => LIVE_KEYS.has(key))) {
        try {
          await putEngineSettings(liveSettingsOf(saved))
        }
        catch (err) {
          logFor('engine').warn(
            { err },
            'Torrent settings not applied, they apply on the next engine start',
          )
        }
      }

      if (keys.includes('seedRule') || keys.includes('seedCache'))
        await enforceSeeding(await liveTorrents())

      return toTorrentSettingsResponse()
    },
  )

  // Мягкий перезапуск ради сетевых настроек: просмотр на всех устройствах прервётся
  app.post(
    '/torrent/restart',
    {
      schema: {
        operationId: 'postTorrentRestart',
        tags: ['Settings'],
        response: {
          202: messageResponse,
          409: restartBlockedResponse,
          ...guardResponses,
        },
      },
    },
    async (_request, reply) => {
      const blocked = restartBlocked()

      if (blocked || !restartEngine({ graceful: true })) {
        return reply.code(409).send({
          message: 'Engine cannot be restarted now',
          reason: blocked ?? 'not_running',
        })
      }

      return reply.code(202).send({ message: 'Engine restarting' })
    },
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
    async () => playbackSettingsOf(await recheckAccel()),
  )

  app.get(
    '/follow',
    {
      schema: {
        operationId: 'getFollowSettings',
        tags: ['Settings'],
        response: { 200: followSettingsResponse, ...guardResponses },
      },
    },
    async () => followSettings(),
  )

  app.put(
    '/follow',
    {
      schema: {
        operationId: 'putFollowSettings',
        tags: ['Settings'],
        body: updateFollowSettings,
        response: {
          200: followSettingsResponse,
          400: messageResponse,
          ...guardResponses,
        },
      },
    },
    async request => saveFollowSettings(request.body),
  )
}
