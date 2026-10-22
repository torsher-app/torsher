import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import { engineUnavailableResponse } from '../dto/torrents.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  engineState,
  engineUnavailableError,
  restartEngine,
} from '../services/engine/index.ts'
import { sendEngineError } from './engineResponses.ts'

export const engineRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  // Запасной путь для сбоя, который сторожа движка не распознали. Ответ —
  // сразу: новый процесс поднимется сам, панель увидит это в `GET /torrents`
  app.post(
    '/restart',
    {
      schema: {
        operationId: 'restartEngine',
        tags: ['Torrents'],
        response: {
          202: messageResponse,
          401: messageResponse,
          503: engineUnavailableResponse,
        },
      },
    },
    async (_request, reply) => {
      const state = engineState()

      // Без процесса перезапускать нечего; движок, который уже запускается,
      // `restartEngine` не трогает — ответ тот же, перезапуск и так идёт
      if (state === 'not_installed' || state === 'stopped')
        return sendEngineError(reply, engineUnavailableError())

      restartEngine()

      return reply.code(202).send({ message: 'Engine restarting' })
    },
  )
}
