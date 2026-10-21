import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { Buffer } from 'node:buffer'
import { messageResponse } from '../dto/common.ts'
import {
  createTorrent,
  engineUnavailableResponse,
  torrent,
  TORRENT_FILE_MAX_BYTES,
  torrentIdParams,
  torrentList,
  torrentStats,
  torrentStatsQuery,
} from '../dto/torrents.ts'
import { requireAuth } from '../middleware/auth.ts'
import { engineState } from '../services/engine/index.ts'
import {
  addMagnet,
  addTorrentFile,
  deleteTorrent,
  getTorrent,
  InvalidMagnetError,
  listTorrents,
  playableFile,
  retryTorrent,
  streamStats,
} from '../services/torrents/index.ts'
import { sendEngineError, toTorrentResponse } from './engineResponses.ts'

const guardResponses = {
  401: messageResponse,
}

const engineResponses = {
  502: messageResponse,
  503: engineUnavailableResponse,
  504: messageResponse,
}

export const torrentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAuth)

  app.get(
    '',
    {
      schema: {
        operationId: 'getTorrents',
        tags: ['Torrents'],
        response: { 200: torrentList, ...guardResponses },
      },
    },
    async () => ({
      items: listTorrents().map(toTorrentResponse),
      engine: engineState(),
    }),
  )

  // Уже добавленная раздача возвращается как есть со статусом 200
  app.post(
    '',
    {
      // base64 `.torrent` больше лимита тела по умолчанию
      bodyLimit: Math.ceil(TORRENT_FILE_MAX_BYTES / 3) * 4 + 64 * 1024,
      schema: {
        operationId: 'postTorrent',
        tags: ['Torrents'],
        body: createTorrent,
        response: {
          200: torrent,
          201: torrent,
          400: messageResponse,
          ...guardResponses,
          ...engineResponses,
        },
      },
    },
    async (request, reply) => {
      const { magnet, torrentFile } = request.body

      try {
        const result = magnet
          ? await addMagnet(magnet)
          : await addTorrentFile(Buffer.from(torrentFile ?? '', 'base64'))

        return reply
          .code(result.created ? 201 : 200)
          .send(toTorrentResponse(result.torrent))
      }
      catch (err) {
        if (err instanceof InvalidMagnetError)
          return reply.code(400).send({ message: err.message })

        return sendEngineError(reply, err)
      }
    },
  )

  app.get(
    '/:id',
    {
      schema: {
        operationId: 'getTorrent',
        tags: ['Torrents'],
        params: torrentIdParams,
        response: { 200: torrent, 404: messageResponse, ...guardResponses },
      },
    },
    async (request, reply) => {
      const found = getTorrent(request.params.id)

      if (!found)
        return reply.code(404).send({ message: 'Torrent not found' })

      return toTorrentResponse(found)
    },
  )

  // Файлы на диске остаются: их удаление — отдельное действие хранилища
  app.delete(
    '/:id',
    {
      schema: {
        operationId: 'deleteTorrent',
        tags: ['Torrents'],
        params: torrentIdParams,
        response: {
          200: messageResponse,
          404: messageResponse,
          ...guardResponses,
          ...engineResponses,
        },
      },
    },
    async (request, reply) => {
      const found = getTorrent(request.params.id)

      if (!found)
        return reply.code(404).send({ message: 'Torrent not found' })

      try {
        await deleteTorrent(found)
      }
      catch (err) {
        return sendEngineError(reply, err)
      }

      return { message: 'Torrent deleted' }
    },
  )

  // Повтор magnet, который не дождался пиров; другую раздачу возвращает как есть
  app.post(
    '/:id/retry',
    {
      schema: {
        operationId: 'postTorrentRetry',
        tags: ['Torrents'],
        params: torrentIdParams,
        response: {
          200: torrent,
          404: messageResponse,
          ...guardResponses,
          ...engineResponses,
        },
      },
    },
    async (request, reply) => {
      const found = getTorrent(request.params.id)

      if (!found)
        return reply.code(404).send({ message: 'Torrent not found' })

      try {
        return toTorrentResponse(await retryTorrent(found))
      }
      catch (err) {
        return sendEngineError(reply, err)
      }
    },
  )

  app.get(
    '/:id/stats',
    {
      schema: {
        operationId: 'getTorrentStats',
        tags: ['Torrents'],
        params: torrentIdParams,
        querystring: torrentStatsQuery,
        response: {
          200: torrentStats,
          404: messageResponse,
          ...guardResponses,
          ...engineResponses,
        },
      },
    },
    async (request, reply) => {
      const found = getTorrent(request.params.id)
      const fileIndex = Number(request.query.fileIndex)

      if (!found || !playableFile(found, fileIndex))
        return reply.code(404).send({ message: 'File not found' })

      try {
        return await streamStats(
          found,
          fileIndex,
          Number(request.query.offset ?? 0),
        )
      }
      catch (err) {
        return sendEngineError(reply, err)
      }
    },
  )
}
