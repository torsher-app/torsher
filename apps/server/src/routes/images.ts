import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { Readable } from 'node:stream'
import { z } from 'zod'
import { TMDB_MAX_CACHE_AGE_MS } from '../services/tmdb/cache.ts'
import { fetchTmdbImage, TmdbError } from '../services/tmdb/index.ts'

// Браузер и ТВ тоже хранят картинку: срок не длиннее предела хранения данных TMDB
const CACHE_CONTROL = `public, max-age=${TMDB_MAX_CACHE_AGE_MS / 1000}, immutable`

const IMAGE_SIZES = [
  'w185',
  'w300',
  'w342',
  'w500',
  'w780',
  'w1280',
  'original',
] as const

// Тип ответа — по расширению, а не от апстрима: свой origin не отдаёт чужой
// документ как HTML или SVG со скриптом
const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const imageParams = z.object({
  size: z.enum(IMAGE_SIZES),
  // Имя файла TMDB без каталогов: прокси не превращается в открытый прокси к хосту
  file: z.string().regex(/^[\w-]+\.(?:jpg|jpeg|png|webp)$/),
})

/**
 * Картинки TMDB через свой origin: клиенты не ходят во внешние хосты.
 * Без авторизации — `<img>` не везде шлёт cookie, а содержимое публичное.
 */
export const imageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/:size/:file',
    {
      schema: {
        // Бинарный ответ: в OpenAPI и generated-клиенте роут не нужен
        hide: true,
        params: imageParams,
      },
    },
    async (request, reply) => {
      const { size, file } = request.params

      let upstream: Response

      try {
        upstream = await fetchTmdbImage(size, file)
      }
      catch (err) {
        if (err instanceof TmdbError)
          return reply.code(502).send({ message: err.message })

        throw err
      }

      if (upstream.status === 404)
        return reply.code(404).send({ message: 'Image not found' })

      const upstreamType = upstream.headers.get('content-type') ?? ''

      if (!upstream.ok || !upstream.body || !upstreamType.startsWith('image/'))
        return reply.code(502).send({ message: 'TMDB image is unavailable' })

      const contentLength = upstream.headers.get('content-length')

      if (contentLength)
        reply.header('Content-Length', contentLength)

      const extension = file.slice(file.lastIndexOf('.') + 1)

      return reply
        .header('Content-Type', CONTENT_TYPES[extension])
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', CACHE_CONTROL)
        .send(Readable.fromWeb(upstream.body))
    },
  )
}
