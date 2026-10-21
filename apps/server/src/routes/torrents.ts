import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { Buffer } from 'node:buffer'
import { messageResponse } from '../dto/common.ts'
import type { Torrent } from '../db/schema.ts'
import {
  createTorrent,
  deleteTorrentQuery,
  downloadTorrent,
  engineUnavailableResponse,
  torrent,
  TORRENT_FILE_MAX_BYTES,
  torrentIdParams,
  torrentList,
  torrentStats,
  torrentStatsQuery,
  updateRetention,
} from '../dto/torrents.ts'
import { requireByRoute } from '../middleware/auth.ts'
import { engineState } from '../services/engine/index.ts'
import { cacheSummary } from '../services/storage/index.ts'
import {
  addMagnet,
  addTorrentFile,
  deleteTorrent,
  downloadFiles,
  getTorrent,
  InvalidMagnetError,
  listTorrents,
  liveTorrents,
  NotInEngineError,
  NotReadyError,
  pauseDownload,
  playableFile,
  resumeDownload,
  retryTorrent,
  setRetention,
  streamStats,
} from '../services/torrents/index.ts'
import { sendEngineError, toTorrentResponse } from './engineResponses.ts'

/** Ответ с живыми данными движка: прогресс, скорость, пиры */
async function respond(found: Torrent) {
  const live = await liveTorrents()

  return toTorrentResponse(found, live.get(found.infoHash))
}

const guardResponses = {
  401: messageResponse,
}

const engineResponses = {
  502: messageResponse,
  503: engineUnavailableResponse,
  504: messageResponse,
}

export const torrentRoutes: FastifyPluginAsyncZod = async (app) => {
  // Раздачу и её статистику читает и витрина (ожидание magnet, буфер
  // плеера) — такие роуты помечены `config.viewer`; остальное — панель
  app.addHook('onRequest', requireByRoute)

  app.get(
    '',
    {
      schema: {
        operationId: 'getTorrents',
        tags: ['Torrents'],
        response: { 200: torrentList, ...guardResponses },
      },
    },
    async () => {
      const live = await liveTorrents()
      const items = listTorrents().map(row =>
        toTorrentResponse(row, live.get(row.infoHash)),
      )

      return {
        items,
        engine: engineState(),
        totals: {
          downloadSpeed: items.reduce(
            (sum, item) => sum + item.downloadSpeed,
            0,
          ),
          uploadSpeed: items.reduce((sum, item) => sum + item.uploadSpeed, 0),
        },
        cache: await cacheSummary(live),
      }
    },
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
          .send(await respond(result.torrent))
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
      config: { viewer: true },
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

      return respond(found)
    },
  )

  // По умолчанию файлы на диске остаются; `?files=delete` удаляет и их
  app.delete(
    '/:id',
    {
      schema: {
        operationId: 'deleteTorrent',
        tags: ['Torrents'],
        params: torrentIdParams,
        querystring: deleteTorrentQuery,
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
        await deleteTorrent(found, {
          deleteFiles: request.query.files === 'delete',
        })
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
        return await respond(await retryTorrent(found))
      }
      catch (err) {
        return sendEngineError(reply, err)
      }
    },
  )

  // Скачать выбранные файлы целиком сейчас; скачанное руками закрепляется
  app.post(
    '/:id/download',
    {
      schema: {
        operationId: 'postTorrentDownload',
        tags: ['Torrents'],
        params: torrentIdParams,
        body: downloadTorrent,
        response: {
          200: torrent,
          400: messageResponse,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
          ...engineResponses,
        },
      },
    },
    async (request, reply) => {
      const found = getTorrent(request.params.id)

      if (!found)
        return reply.code(404).send({ message: 'Torrent not found' })

      if (found.status !== 'ready') {
        return reply
          .code(409)
          .send({ message: 'Torrent metadata is not ready' })
      }

      const files = [...new Set(request.body.files)]

      if (files.some(index => !playableFile(found, index)))
        return reply.code(400).send({ message: 'Unknown file index' })

      try {
        return await respond(await downloadFiles(found, files))
      }
      catch (err) {
        if (err instanceof NotReadyError)
          return reply.code(409).send({ message: err.message })

        return sendEngineError(reply, err)
      }
    },
  )

  for (const action of ['pause', 'resume'] as const) {
    app.post(
      `/:id/${action}`,
      {
        schema: {
          operationId:
            action === 'pause' ? 'postTorrentPause' : 'postTorrentResume',
          tags: ['Torrents'],
          params: torrentIdParams,
          response: {
            200: torrent,
            404: messageResponse,
            409: messageResponse,
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
          const updated
            = action === 'pause'
              ? await pauseDownload(found)
              : await resumeDownload(found)

          return await respond(updated)
        }
        catch (err) {
          if (err instanceof NotInEngineError)
            return reply.code(409).send({ message: err.message })

          return sendEngineError(reply, err)
        }
      },
    )
  }

  // «Оставить» выводит раздачу из-под вытеснения кэша
  app.put(
    '/:id/retention',
    {
      schema: {
        operationId: 'putTorrentRetention',
        tags: ['Torrents'],
        params: torrentIdParams,
        body: updateRetention,
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
        return await respond(await setRetention(found, request.body.retention))
      }
      catch (err) {
        return sendEngineError(reply, err)
      }
    },
  )

  app.get(
    '/:id/stats',
    {
      config: { viewer: true },
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
