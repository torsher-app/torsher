import type { FastifyServerOptions } from 'fastify'
import type { ClientDirs } from './static.ts'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import Fastify from 'fastify'
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import { config } from './config.ts'
import { apiRoutes } from './routes/api.ts'
import { playbackRoutes } from './routes/playback.ts'
import { streamRoutes } from './routes/stream.ts'
import { torrentRoutes } from './routes/torrents.ts'
import { registerClients } from './static.ts'

/**
 * Приложение отделено от `main.ts`, чтобы тесты и выгрузка OpenAPI могли
 * поднять его через `app.inject()` без сокета и без файла базы.
 * Собранные клиенты раздаются, только если переданы их каталоги.
 */
export function createApp(
  options: FastifyServerOptions = {},
  clients?: ClientDirs,
) {
  const app = Fastify(options).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.decorateRequest('userId', '')

  app.register(cors, {
    origin: config.clientUrl,
    credentials: true,
  })
  app.register(cookie)
  app.register(swagger, {
    openapi: {
      info: {
        title: 'Torsher API',
        version: '0.0.0',
      },
      tags: [
        { name: 'Auth', description: 'Регистрация, вход, сессия' },
        { name: 'Users', description: 'Профиль пользователя' },
        {
          name: 'Catalog',
          description: 'Каталог: главная, поиск и карточки тайтлов',
        },
        {
          name: 'Sources',
          description: 'Torznab-индексаторы и менеджеры индексаторов',
        },
        {
          name: 'Torrents',
          description: 'Раздачи по magnet и .torrent, статистика движка',
        },
        {
          name: 'Playback',
          description: 'Запуск воспроизведения и позиция просмотра',
        },
        { name: 'About', description: 'Версия, лицензия и исходники' },
      ],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  })

  // Весь API — под /api: корень и /panel/ занимают витрина и панель,
  // которые сервер отдаёт с того же origin
  app.register(apiRoutes, { prefix: '/api' })
  app.register(torrentRoutes, { prefix: '/torrents' })
  app.register(streamRoutes, { prefix: '/stream' })
  app.register(playbackRoutes)

  if (clients)
    registerClients(app, clients)

  return app
}

export type App = ReturnType<typeof createApp>
