import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { aboutRoutes } from './about.ts'
import { authRoutes } from './auth.ts'
import { catalogRoutes } from './catalog.ts'
import { homeRoutes } from './home.ts'
import { imageRoutes } from './images.ts'
import { indexerManagerRoutes } from './indexerManagers.ts'
import { indexerRoutes } from './indexers.ts'
import { playbackRoutes } from './playback.ts'
import { streamRoutes } from './stream.ts'
import { torrentRoutes } from './torrents.ts'
import { userRoutes } from './users.ts'

export const apiRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      // HEALTHCHECK образа дёргает роут каждые 30 с: без этого он забивает лог
      logLevel: 'warn',
      schema: {
        operationId: 'getHealth',
        tags: ['Health'],
        response: {
          200: z.object({ status: z.literal('ok') }),
        },
      },
    },
    () => ({ status: 'ok' as const }),
  )

  app.register(aboutRoutes, { prefix: '/about' })
  app.register(authRoutes, { prefix: '/auth' })
  app.register(userRoutes, { prefix: '/users' })
  app.register(catalogRoutes, { prefix: '/catalog' })
  app.register(homeRoutes, { prefix: '/home' })
  app.register(imageRoutes, { prefix: '/img' })
  app.register(indexerRoutes, { prefix: '/indexers' })
  app.register(indexerManagerRoutes, { prefix: '/indexer-managers' })
  app.register(torrentRoutes, { prefix: '/torrents' })
  app.register(streamRoutes, { prefix: '/stream' })
  app.register(playbackRoutes)
}
