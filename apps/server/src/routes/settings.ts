import {
  createSourcePreset as createSourcePresetBody,
  sourcePresetParams,
  sourceSettings,
  updateSourcePreset as updateSourcePresetBody,
  updateSourceSettings,
} from '../dto/sourceSettings.ts'
import {
  createSourcePreset,
  deleteSourcePreset,
  sourceSettings as getSourceSettings,
  setDefaultSourcePreset,
  SourcePresetError,
  updateSourcePreset,
} from '../services/sources/profile.ts'
import {
  thumbnailSettings,
  updateThumbnailSettings,
} from '../dto/thumbnails.ts'
import {
  queueUnprobed,
  regenerateThumbnails,
  thumbnailStatus,
} from '../services/library/probe.ts'
import { setAutomaticThumbnails } from '../services/library/thumbnailSettings.ts'
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
  followSettingsView,
  saveFollowSettings,
} from '../services/follow/settings.ts'
import { setServerAudio } from '../services/follow/audio.ts'
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
    '/sources',
    {
      schema: {
        operationId: 'getSourceSettings',
        tags: ['Settings'],
        response: { 200: sourceSettings, ...guardResponses },
      },
    },
    async () => getSourceSettings(),
  )
  app.put(
    '/sources',
    {
      schema: {
        operationId: 'putSourceSettings',
        tags: ['Settings'],
        body: updateSourceSettings,
        response: {
          200: sourceSettings,
          400: messageResponse,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return setDefaultSourcePreset(request.body.defaultPresetId)
      }
      catch (err) {
        if (err instanceof SourcePresetError)
          return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.post(
    '/sources/presets',
    {
      schema: {
        operationId: 'postSourcePreset',
        tags: ['Settings'],
        body: createSourcePresetBody,
        response: {
          200: sourceSettings,
          400: messageResponse,
          ...guardResponses,
        },
      },
    },
    async request => createSourcePreset(request.body.name),
  )
  app.patch(
    '/sources/presets/:presetId',
    {
      schema: {
        operationId: 'patchSourcePreset',
        tags: ['Settings'],
        params: sourcePresetParams,
        body: updateSourcePresetBody,
        response: {
          200: sourceSettings,
          400: messageResponse,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return updateSourcePreset(request.params.presetId, request.body)
      }
      catch (err) {
        if (err instanceof SourcePresetError)
          return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )
  app.delete(
    '/sources/presets/:presetId',
    {
      schema: {
        operationId: 'deleteSourcePreset',
        tags: ['Settings'],
        params: sourcePresetParams,
        response: {
          200: sourceSettings,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return deleteSourcePreset(request.params.presetId)
      }
      catch (err) {
        if (err instanceof SourcePresetError)
          return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.get(
    '/thumbnails',
    {
      schema: {
        operationId: 'getThumbnailSettings',
        tags: ['Settings'],
        response: { 200: thumbnailSettings, ...guardResponses },
      },
    },
    async () => thumbnailStatus(),
  )
  app.put(
    '/thumbnails',
    {
      schema: {
        operationId: 'putThumbnailSettings',
        tags: ['Settings'],
        body: updateThumbnailSettings,
        response: { 200: thumbnailSettings, ...guardResponses },
      },
    },
    async (request) => {
      setAutomaticThumbnails(request.body.automatic)
      if (request.body.automatic)
        queueUnprobed()
      return thumbnailStatus()
    },
  )
  app.post(
    '/thumbnails/regenerate',
    {
      schema: {
        operationId: 'postThumbnailRegenerate',
        tags: ['Settings'],
        response: { 202: thumbnailSettings, ...guardResponses },
      },
    },
    async (_request, reply) => reply.code(202).send(regenerateThumbnails()),
  )

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
    async () => followSettingsView(followSettings()),
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
    async (request) => {
      const { audio, ...patch } = request.body

      if (audio)
        setServerAudio({ value: audio, source: 'user' })

      return followSettingsView(
        Object.keys(patch).length
          ? saveFollowSettings(patch)
          : followSettings(),
      )
    },
  )
}
