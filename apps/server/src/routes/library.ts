import { acquireMaintenanceLease } from '../services/libraryMaintenance/admission.ts'
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
import { cachedThumb } from '../services/library/thumbs.ts'
import { sendLibraryFile } from '../services/library/stream.ts'

export { parseRange } from '../services/library/stream.ts'

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
      return sendLibraryFile(
        request,
        reply,
        request.params.id,
        request.profileId,
      )
    },
  )

  // Кадр-превью файла библиотеки для карточек витрины; только готовый кэш
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
      const releaseMaintenance = acquireMaintenanceLease({
        mediaFileId: request.params.id,
      })
      reply.raw.once('close', releaseMaintenance)
      const found = playableMediaFile(request.params.id, request.profileId)
      const available
        = found?.folder.status === 'ok'
          && (await stat(found.path).then(
            info => info.isFile(),
            () => false,
          ))
      const path = found && available && (await cachedThumb(found.file))

      if (!path)
        return reply.code(404).send({ message: 'Thumbnail not found' })

      return reply
        .header('Content-Type', 'image/jpeg')
        .header('Cache-Control', 'private, no-cache')
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
