import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FileHandle } from 'node:fs/promises'
import { hlsParams, hlsSegmentParams, streamQuery } from '../dto/playback.ts'
import { requireStream, streamSubjectOf } from '../middleware/auth.ts'
import { EngineError } from '../services/engine/index.ts'
import {
  buildPlaylist,
  getSession,
  SegmentTimeoutError,
  TranscodeFailedError,
} from '../services/media/index.ts'

/**
 * Перепакованный поток для hls.js: плейлист и сегменты MPEG-TS. Как и поток
 * файла, адреса несут токен потока — hls.js не обновляет сессию.
 */
export const hlsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireStream)

  app.get(
    '/:id/main.m3u8',
    {
      schema: { hide: true, params: hlsParams, querystring: streamQuery },
    },
    async (request, reply) => {
      const session = getSession(request.params.id, streamSubjectOf(request))
      const hls = session?.hls

      if (!session || !hls || !session.media?.duration)
        return reply.code(404).send({ message: 'Playback not found' })

      const token = encodeURIComponent(request.query.token ?? '')
      const playlist = buildPlaylist(
        hls.starts,
        session.media.duration,
        index => `${index}.ts${token ? `?token=${token}` : ''}`,
      )

      return reply
        .header('Content-Type', 'application/vnd.apple.mpegurl')
        .header('Cache-Control', 'no-store')
        .send(playlist)
    },
  )

  app.get(
    '/:id/:segment',
    {
      schema: {
        hide: true,
        params: hlsSegmentParams,
        querystring: streamQuery,
      },
    },
    async (request, reply) => {
      const session = getSession(request.params.id, streamSubjectOf(request))
      const hls = session?.hls
      const index = Number.parseInt(request.params.segment, 10)

      if (!session || !hls || index >= hls.segmentCount)
        return reply.code(404).send({ message: 'Segment not found' })

      // hls.js отменяет запрос сегмента при перемотке: ждать дальше незачем
      const controller = new AbortController()

      reply.raw.on('close', () => controller.abort())

      let file: FileHandle

      try {
        file = await hls.segment(index, controller.signal)
      }
      catch (err) {
        if (controller.signal.aborted)
          return reply

        if (err instanceof SegmentTimeoutError)
          return reply.code(504).send({ message: 'Segment is not ready' })

        if (err instanceof EngineError && err.kind === 'unavailable') {
          return reply
            .code(503)
            .send({ message: 'Torrent engine is restarting' })
        }

        if (err instanceof TranscodeFailedError) {
          request.log
            .child({ source: 'playback' })
            .warn(`hls ${session.id}: transcoding failed`)
          return reply.code(502).send({ message: 'Transcoding failed' })
        }

        throw err
      }

      return reply
        .header('Content-Type', 'video/mp2t')
        .header('Cache-Control', 'no-store')
        .send(file.createReadStream())
    },
  )
}
