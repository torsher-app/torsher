import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { messageResponse } from '../dto/common.ts'
import {
  homeVideoList,
  homeVideoSection,
  homeVideosQuery,
} from '../dto/home.ts'
import { libraryStreamParams, streamQuery } from '../dto/playback.ts'
import { requireStream, requireViewer } from '../middleware/auth.ts'
import { playableMediaFile } from '../services/library/folders.ts'
import {
  fileCardsOf,
  homeAlbums,
  homeVideos,
} from '../services/library/home.ts'
import { ensureThumb } from '../services/library/thumbs.ts'
import { contentTypeOf } from '../services/torrents/index.ts'

/** `bytes=start-end` → границы; `undefined` — заголовка нет, `null` — вне файла */
export function parseRange(header: string | undefined, size: number) {
  if (!header)
    return undefined

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())

  if (!match || (!match[1] && !match[2]))
    return null

  let start: number
  let end: number

  if (!match[1]) {
    // `bytes=-500` — последние 500 байт
    start = Math.max(0, size - Number(match[2]))
    end = size - 1
  }
  else {
    start = Number(match[1])
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  }

  return start <= end && start < size ? { start, end } : null
}

/**
 * Файлы библиотеки: поток с диска для плеера. Движок здесь не участвует — файл
 * играется, даже когда раздачи уже нет.
 */
export const libraryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/files/:id/stream',
    {
      onRequest: requireStream,
      schema: {
        // Бинарный ответ: в OpenAPI и generated-клиенте роут не нужен
        hide: true,
        params: libraryStreamParams,
        querystring: streamQuery,
      },
    },
    async (request, reply) => {
      const found = playableMediaFile(request.params.id, request.profileId)
      const info = found && (await stat(found.path).catch(() => undefined))

      if (!found || !info?.isFile())
        return reply.code(404).send({ message: 'File not found' })

      const size = info.size
      const range = parseRange(request.headers.range, size)

      if (range === null) {
        return reply
          .code(416)
          .header('Content-Range', `bytes */${size}`)
          .send({ message: 'Range not satisfiable' })
      }

      reply
        .header('Accept-Ranges', 'bytes')
        .header('Content-Type', contentTypeOf(found.file.relPath))
        .header('Cache-Control', 'no-store')

      if (!range) {
        return reply
          .header('Content-Length', size)
          .send(createReadStream(found.path))
      }

      return reply
        .code(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        .header('Content-Length', range.end - range.start + 1)
        .send(createReadStream(found.path, range))
    },
  )

  // Кадр-превью файла библиотеки для карточек витрины; делается по первому запросу
  app.get(
    '/files/:id/thumb',
    {
      onRequest: requireViewer,
      schema: {
        hide: true,
        params: libraryStreamParams,
      },
    },
    async (request, reply) => {
      const found = playableMediaFile(request.params.id, request.profileId)
      const path = found && (await ensureThumb(found.file, found.path))

      if (!path)
        return reply.code(404).send({ message: 'Thumbnail not found' })

      return reply
        .header('Content-Type', 'image/jpeg')
        .header('Cache-Control', 'private, max-age=86400')
        .send(createReadStream(path))
    },
  )

  // Раздел «Домашнее видео»: альбомы профиля; пусто — раздела в рейле нет
  app.get(
    '/home',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getHomeVideo',
        tags: ['Library'],
        response: { 200: homeVideoSection, 401: messageResponse },
      },
    },
    async request => ({ albums: homeAlbums(request.profileId) }),
  )

  // Видео домашнего видео по дате съёмки: все или одного альбома
  app.get(
    '/home/videos',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getHomeVideos',
        tags: ['Library'],
        querystring: homeVideosQuery,
        response: { 200: homeVideoList, 401: messageResponse },
      },
    },
    async (request) => {
      const { profileId } = request

      return {
        items: fileCardsOf(homeVideos(profileId, request.query), profileId),
      }
    },
  )
}
