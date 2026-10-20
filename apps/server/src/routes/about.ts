import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import packageJson from '../../package.json' with { type: 'json' }
import { config } from '../config.ts'
import { aboutResponse } from '../dto/about.ts'

const LICENSE = 'AGPL-3.0-only'

/**
 * Без авторизации: версия, лицензия и ссылка на исходники нужны и до входа,
 * например на экране «О программе» у ТВ без сессии.
 */
export const aboutRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        operationId: 'getAbout',
        tags: ['About'],
        response: {
          200: aboutResponse,
        },
      },
    },
    () => ({
      version: packageJson.version,
      commit: config.commit,
      license: LICENSE,
      sourceUrl: config.sourceUrl,
    }),
  )
}
