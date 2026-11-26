import { acquireMaintenanceLease } from '../services/libraryMaintenance/admission.ts'
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { Readable } from 'node:stream'
import { playbackParams, streamParams, streamQuery } from '../dto/playback.ts'
import {
  requireStream,
  streamSubjectOf,
  viewerStillOnProfile,
} from '../middleware/auth.ts'
import { throttleLog } from '../services/logs/index.ts'
import { getSession, streamWindowFor } from '../services/media/index.ts'
import { trackStream } from '../services/storage/index.ts'
import {
  contentTypeOf,
  getTorrent,
  openFileStream,
  playableFile,
  touchTorrent,
} from '../services/torrents/index.ts'
import { engineFailureOf, sendEngineError } from './engineResponses.ts'
import { titleAllowedCached } from '../services/profiles/access.ts'
import { sessionAccessible } from '../services/profiles/playbackAccess.ts'
import { verifySession } from '../services/users/session.ts'

// Заголовки ответа движка, которые нужны плееру для перемотки
const ADDON_ACCESS_INTERVAL_MS = 500
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
    '/addon/:id',
    {
      onRequest: requireStream,
      schema: { hide: true, params: playbackParams, querystring: streamQuery },
    },
    async (request, reply) => {
      const { profileId } = request
      const subject = streamSubjectOf(request)
      const session = getSession(request.params.id, subject)
      const media = session?.addonMedia
      const viewerCurrent = () => {
        if (request.deviceId || !request.query.token)
          return viewerStillOnProfile(request, profileId)
        try {
          const verified = verifySession(request.query.token, 'stream')
          return (
            verified.userId === subject && verified.profileId === profileId
          )
        }
        catch {
          return false
        }
      }
      const current = () =>
        session
        && getSession(session.id, subject) === session
        && viewerCurrent()
        && sessionAccessible(session, profileId)
      if (
        !media
        || session.status !== 'ready'
        || session.addonMediaFailed
        || !current()
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }

      if (media.failed)
        return reply.code(502).send({ message: 'HTTP video is unavailable' })

      const closer = new AbortController()
      let watchdog: ReturnType<typeof setInterval> | undefined
      reply.raw.once('close', () => {
        clearInterval(watchdog)
        closer.abort()
      })
      let result: Awaited<ReturnType<typeof media.response>>
      try {
        result = await media.response(
          request.headers.range,
          request.method === 'HEAD',
          closer.signal,
        )
      }
      catch {
        return reply.code(502).send({ message: 'HTTP video is unavailable' })
      }
      if (!current() || closer.signal.aborted) {
        result.body?.destroy()
        return reply.code(404).send({ message: 'Playback not found' })
      }

      const body = result.body
      if (body) {
        // A browser can keep one Range open well beyond a profile or token change.
        watchdog = setInterval(() => {
          if (current())
            return
          clearInterval(watchdog)
          closer.abort()
          body.destroy()
          reply.raw.destroy()
        }, ADDON_ACCESS_INTERVAL_MS)
        watchdog.unref()
      }
      reply.code(result.status).headers(result.headers)
      return request.method === 'HEAD'
        ? reply.send(Readable.from([]))
        : reply.send(result.body)
    },
  )

  app.get(
    '/:torrentId/:fileIndex',
    {
      onRequest: requireStream,
      schema: {
        // Бинарный ответ: в OpenAPI и generated-клиенте роут не нужен
        hide: true,
        operationId: 'streamTorrentFile',
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

      if (
        !torrent
        || !file
        || !titleAllowedCached(request.profileId, torrent.titleId)
      ) {
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

      const releaseMaintenance = acquireMaintenanceLease({
        torrentId: torrent.id,
      })
      reply.raw.once('close', releaseMaintenance)
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
        return sendEngineError(reply, err, torrent)
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
