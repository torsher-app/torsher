import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import {
  createPlayback,
  insufficientStorageResponse,
  playback,
  updateWatchState,
  watchState,
} from '../dto/playback.ts'
import { engineUnavailableResponse } from '../dto/torrents.ts'
import { requireAuth } from '../middleware/auth.ts'
import {
  getTitleProgress,
  saveTitleProgress,
} from '../services/sources/progress.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'
import { resumePosition } from '../services/torrents/playback.ts'
import {
  fileNameOf,
  getTorrent,
  getWatchState,
  playableFile,
  prepareStream,
  saveWatchState,
} from '../services/torrents/index.ts'
import { sessionVersionOf } from '../services/users/session.ts'
import { signToken } from '../utils/token.ts'
import { sendEngineError } from './engineResponses.ts'

const guardResponses = {
  401: messageResponse,
}

/**
 * Клиенты ходят в API через `/api` своего origin (прокси панели и витрины,
 * в продакшене — сам сервер), поэтому адрес потока для `<video>` — с этим префиксом.
 */
function streamUrlOf(torrentId: string, fileIndex: number, userId: string) {
  const token = encodeURIComponent(
    signToken(userId, 'stream', sessionVersionOf(userId)),
  )

  return `/api/stream/${torrentId}/${fileIndex}?token=${token}`
}

export const playbackRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAuth)

  app.post(
    '/playback',
    {
      schema: {
        operationId: 'postPlayback',
        tags: ['Playback'],
        body: createPlayback,
        response: {
          200: playback,
          400: messageResponse,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
          502: messageResponse,
          503: engineUnavailableResponse,
          504: messageResponse,
          // Места не хватит даже после вытеснения кэша
          507: insufficientStorageResponse,
        },
      },
    },
    async (request, reply) => {
      const { torrentId, fileIndex, title } = request.body
      const found = getTorrent(torrentId)
      const file = found && playableFile(found, fileIndex)

      if (!found || !file || (title && !parseCatalogId(title.id)))
        return reply.code(404).send({ message: 'File not found' })

      if (found.status !== 'ready') {
        return reply
          .code(409)
          .send({ message: 'Torrent metadata is not ready' })
      }

      try {
        await prepareStream(found, fileIndex)
      }
      catch (err) {
        return sendEngineError(reply, err)
      }

      // Прогресс серии сильнее позиции файла: раздачу могли сменить
      const progress = title
        ? getTitleProgress({
            titleId: title.id,
            season: title.season,
            episode: title.episode,
          })
        : undefined
      const state = progress?.position
        ? progress
        : getWatchState(torrentId, fileIndex)

      return {
        streamUrl: streamUrlOf(torrentId, fileIndex, request.userId),
        mode: 'direct' as const,
        title: found.name,
        fileName: fileNameOf(file.path),
        size: file.size,
        duration: state?.duration ?? null,
        startPosition: state
          ? resumePosition(state.position, state.duration)
          : null,
      }
    },
  )

  app.put(
    '/watch-state',
    {
      schema: {
        operationId: 'putWatchState',
        tags: ['Playback'],
        body: updateWatchState,
        response: {
          200: watchState,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const { torrentId, fileIndex, position, duration, title } = request.body
      const found = getTorrent(torrentId)

      if (
        !found
        || !playableFile(found, fileIndex)
        || (title && !parseCatalogId(title.id))
      ) {
        return reply.code(404).send({ message: 'File not found' })
      }

      if (title) {
        saveTitleProgress(
          { titleId: title.id, season: title.season, episode: title.episode },
          { position, duration: duration ?? null, torrentId, fileIndex },
        )
      }

      const saved = saveWatchState({
        torrentId,
        fileIndex,
        position,
        duration: duration ?? null,
      })

      return {
        torrentId: saved.torrentId,
        fileIndex: saved.fileIndex,
        position: saved.position,
        duration: saved.duration,
        updatedAt: saved.updatedAt.toISOString(),
      }
    },
  )
}
