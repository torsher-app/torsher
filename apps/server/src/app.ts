import type { FastifyServerOptions } from 'fastify'
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
import { z } from 'zod'
import { config } from './config.ts'
import { authRoutes } from './routes/auth.ts'
import { catalogRoutes } from './routes/catalog.ts'
import { imageRoutes } from './routes/images.ts'
import { userRoutes } from './routes/users.ts'

/**
 * Приложение отделено от `main.ts`, чтобы тесты и выгрузка OpenAPI могли
 * поднять его через `app.inject()` без сокета и без файла базы.
 */
export function createApp(options: FastifyServerOptions = {}) {
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
        { name: 'Catalog', description: 'Каталог: поиск и карточки тайтлов' },
      ],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  })

  app.get(
    '/health',
    {
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

  app.register(authRoutes, { prefix: '/auth' })
  app.register(userRoutes, { prefix: '/users' })
  app.register(catalogRoutes, { prefix: '/catalog' })
  app.register(imageRoutes, { prefix: '/img' })

  return app
}

export type App = ReturnType<typeof createApp>
