import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { Readable } from 'node:stream'
import { streamParams, streamQuery } from '../dto/playback.ts'
import { requireAuth } from '../middleware/auth.ts'
import { trackStream } from '../services/storage/index.ts'
import {
  contentTypeOf,
  getTorrent,
  openFileStream,
  playableFile,
  touchTorrent,
} from '../services/torrents/index.ts'
import { verifyTokenFor } from '../utils/token.ts'
import { sendEngineError } from './engineResponses.ts'

// Заголовки ответа движка, которые нужны плееру для перемотки
const FORWARDED_HEADERS = ['content-length', 'content-range', 'accept-ranges']

/** `<video>` не умеет обновлять сессию: принимаем токен потока из адреса или cookie */
async function requireStreamAuth(request: FastifyRequest, reply: FastifyReply) {
  const { token } = request.query as { token?: string }

  if (!token)
    return requireAuth(request, reply)

  try {
    request.userId = verifyTokenFor(token, 'stream').userId
  }
  catch {
    return reply.code(401).send({ message: 'Unauthorized' })
  }
}

/**
 * Поток файла раздачи через ядро: движок слушает только loopback, а здесь —
 * авторизация, `Content-Type` по расширению и отмена чтения из движка, когда
 * плеер закрыл соединение (перемотка открывает новое).
 */
export const streamRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/:torrentId/:fileIndex',
    {
      onRequest: requireStreamAuth,
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

      if (!torrent || !file)
        return reply.code(404).send({ message: 'File not found' })

      if (torrent.status !== 'ready') {
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
        )
      }
      catch (err) {
        if (controller.signal.aborted)
          return reply
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
