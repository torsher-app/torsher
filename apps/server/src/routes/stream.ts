import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { Readable } from 'node:stream'
import { streamParams, streamQuery } from '../dto/playback.ts'
import { requireStream } from '../middleware/auth.ts'
import { throttleLog } from '../services/logs/index.ts'
import { streamWindowFor } from '../services/media/index.ts'
import { trackStream } from '../services/storage/index.ts'
import {
  contentTypeOf,
  getTorrent,
  openFileStream,
  playableFile,
  touchTorrent,
} from '../services/torrents/index.ts'
import { engineFailureOf, sendEngineError } from './engineResponses.ts'

// Заголовки ответа движка, которые нужны плееру для перемотки
const FORWARDED_HEADERS = ['content-length', 'content-range', 'accept-ranges']

/**
 * Отказ отдать поток. Плеер переоткрывает его на каждой перемотке, поэтому
 * одна и та же причина пишется раз в минуту
 */
function logRejection(
  request: FastifyRequest,
  reason: string,
  fields: { torrentId: string, infoHash?: string, fileIndex: number },
  extra: Record<string, string | number> = {},
) {
  const key = `stream:${fields.torrentId}:${fields.fileIndex}:${reason}`

  if (throttleLog(key, 60 * 1000)) {
    request.log
      .child({ source: 'playback' })
      .warn({ ...fields, ...extra }, `stream rejected: ${reason}`)
  }
}

/**
 * Поток файла раздачи через ядро: движок слушает только loopback, а здесь —
 * авторизация, `Content-Type` по расширению, окно просмотра и отмена чтения
 * из движка, когда плеер закрыл соединение (перемотка открывает новое).
 */
export const streamRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/:torrentId/:fileIndex',
    {
      onRequest: requireStream,
      schema: {
        // Бинарный ответ: в OpenAPI и generated-клиенте роут не нужен
        hide: true,
        params: streamParams,
        querystring: streamQuery,
      },
    },
    async (request, reply) => {
      const torrent = getTorrent(request.params.torrentId)
      const fileIndex = Number(request.params.fileIndex)
      const file = torrent && playableFile(torrent, fileIndex)
      const fields = {
        torrentId: request.params.torrentId,
        ...(torrent && { infoHash: torrent.infoHash }),
        fileIndex,
      }

      if (!torrent || !file) {
        logRejection(request, 'file not found', fields)
        return reply.code(404).send({ message: 'File not found' })
      }

      if (torrent.status !== 'ready') {
        logRejection(request, 'metadata not ready', fields, {
          status: torrent.status,
        })
        return reply
          .code(409)
          .send({ message: 'Torrent metadata is not ready' })
      }

      const controller = new AbortController()
      // Пока поток открыт, раздачу не вытесняют и не ставят на паузу из-за места
      const release = trackStream(torrent.id)

      reply.raw.on('close', () => {
        release()

        if (!reply.raw.writableFinished)
          controller.abort()
      })

      let upstream: Response

      try {
        upstream = await openFileStream(
          torrent,
          fileIndex,
          request.headers.range,
          controller.signal,
          streamWindowFor(torrent, fileIndex),
        )
      }
      catch (err) {
        if (controller.signal.aborted)
          return reply

        const failure = engineFailureOf(err)

        if (failure)
          logRejection(request, failure.reason, fields, failure.fields)
        return sendEngineError(reply, err)
      }

      touchTorrent(torrent.id)

      if (upstream.status === 416) {
        return reply
          .code(416)
          .header('Content-Range', `bytes */${file.size}`)
          .send({ message: 'Range not satisfiable' })
      }

      reply.code(upstream.status)

      for (const name of FORWARDED_HEADERS) {
        const value = upstream.headers.get(name)

        if (value)
          reply.header(name, value)
      }

      reply
        .header('Accept-Ranges', 'bytes')
        .header('Content-Type', contentTypeOf(file.path))
        .header('Cache-Control', 'no-store')

      if (!upstream.body)
        return reply.send()

      return reply.send(Readable.fromWeb(upstream.body))
    },
  )
}
