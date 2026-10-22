import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { LogSource } from '../services/logs/index.ts'
import { messageResponse } from '../dto/common.ts'
import {
  logLevelBody,
  logLevelResponse,
  logsQuery,
  logsResponse,
} from '../dto/logs.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  exportLog,
  getLogLevel,
  isLogLevelLocked,
  queryLogs,
  setLogLevel,
} from '../services/logs/index.ts'
import { setSetting } from '../services/settings/index.ts'

export const logRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '',
    {
      schema: {
        operationId: 'getLogs',
        tags: ['Logs'],
        querystring: logsQuery,
        response: { 200: logsResponse, 401: messageResponse },
      },
    },
    (request) => {
      const { source, ...query } = request.query
      const result = queryLogs({
        ...query,
        sources: source?.split(',') as LogSource[] | undefined,
      })

      return {
        ...result,
        level: getLogLevel(),
        levelLocked: isLogLevelLocked(),
      }
    },
  )

  // Текстовый файл генератор клиента не описывает: панель зовёт роут через
  // ядро API-клиента и получает Blob
  app.get('/download', { schema: { hide: true } }, (_request, reply) => {
    const date = new Date().toISOString().slice(0, 10)

    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="torsher-${date}.log"`,
      )
      .header('Cache-Control', 'no-store')
      .send(exportLog())
  })

  app.put(
    '/level',
    {
      schema: {
        operationId: 'putLogLevel',
        tags: ['Logs'],
        body: logLevelBody,
        response: {
          200: logLevelResponse,
          401: messageResponse,
          409: messageResponse,
        },
      },
    },
    async (request, reply) => {
      if (isLogLevelLocked()) {
        return reply
          .code(409)
          .send({ message: 'Log level is set by the LOG_LEVEL variable' })
      }

      setLogLevel(request.body.level)
      setSetting('logLevel', request.body.level)

      return { level: getLogLevel() }
    },
  )
}
