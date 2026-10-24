import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { aboutRoutes } from './about.ts'
import { authRoutes } from './auth.ts'
import { backupRoutes } from './backups.ts'
import { catalogRoutes } from './catalog.ts'
import { collectionRoutes } from './collections.ts'
import { deviceRoutes } from './devices.ts'
import { engineRoutes } from './engine.ts'
import { hlsRoutes } from './hls.ts'
import { homeRoutes } from './home.ts'
import { imageRoutes } from './images.ts'
import { indexerManagerRoutes } from './indexerManagers.ts'
import { indexerRoutes } from './indexers.ts'
import { librariesRoutes } from './libraries.ts'
import { libraryRoutes } from './library.ts'
import { logRoutes } from './logs.ts'
import { mineRoutes } from './mine.ts'
import { netRoutes } from './net.ts'
import { notificationRoutes } from './notifications.ts'
import { overviewRoutes } from './overview.ts'
import { playbackRoutes } from './playback.ts'
import { profileImportRoutes } from './profileImports.ts'
import { profileRoutes } from './profiles.ts'
import { settingsRoutes } from './settings.ts'
import { setupRoutes } from './setup.ts'
import { storageRoutes } from './storage.ts'
import { streamRoutes } from './stream.ts'
import { titleRoutes } from './titles.ts'
import { torrentRoutes } from './torrents.ts'
import { transferRoutes } from './transfer.ts'
import { updateRoutes } from './updates.ts'
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
    (_request, reply) => {
      // Обёртка ТВ проверяет адрес со своей страницы на file:// (origin null).
      // Роут публичный и без cookie, поэтому открыт любому origin
      reply.header('Access-Control-Allow-Origin', '*')

      return { status: 'ok' as const }
    },
  )

  app.register(aboutRoutes, { prefix: '/about' })
  app.register(overviewRoutes, { prefix: '/overview' })
  app.register(updateRoutes, { prefix: '/updates' })
  app.register(notificationRoutes, { prefix: '/notifications' })
  app.register(authRoutes, { prefix: '/auth' })
  app.register(userRoutes, { prefix: '/users' })
  app.register(catalogRoutes, { prefix: '/catalog' })
  app.register(homeRoutes, { prefix: '/home' })
  app.register(imageRoutes, { prefix: '/img' })
  app.register(indexerRoutes, { prefix: '/indexers' })
  app.register(indexerManagerRoutes, { prefix: '/indexer-managers' })
  app.register(titleRoutes, { prefix: '/titles' })
  app.register(mineRoutes, { prefix: '/mine' })
  app.register(collectionRoutes, { prefix: '/collections' })
  app.register(torrentRoutes, { prefix: '/torrents' })
  app.register(streamRoutes, { prefix: '/stream' })
  app.register(libraryRoutes, { prefix: '/library' })
  app.register(librariesRoutes, { prefix: '/libraries' })
  app.register(hlsRoutes, { prefix: '/hls' })
  app.register(storageRoutes, { prefix: '/storage' })
  app.register(backupRoutes, { prefix: '/backups' })
  app.register(transferRoutes, { prefix: '/transfer' })
  app.register(netRoutes, { prefix: '/net' })
  app.register(settingsRoutes, { prefix: '/settings' })
  app.register(setupRoutes, { prefix: '/setup' })
  app.register(playbackRoutes)
  app.register(profileRoutes, { prefix: '/profiles' })
  app.register(profileImportRoutes, { prefix: '/profiles' })
  app.register(deviceRoutes, { prefix: '/devices' })
  app.register(engineRoutes, { prefix: '/engine' })
  app.register(logRoutes, { prefix: '/logs' })
}
