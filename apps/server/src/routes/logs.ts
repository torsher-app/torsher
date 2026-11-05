import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { LogSource } from '../services/logs/index.ts'
import { messageResponse } from '../dto/common.ts'
import {
  logLevelBody,
  logLevelResponse,
  logsQuery,
  logsResponse,
} from '../dto/logs.ts'
import { ReportBusyError } from '../services/logs/report.ts'
import { z } from 'zod'
import { requireOwner } from '../middleware/auth.ts'
import {
  exportLog,
  exportSupportReport,
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
        reportCapability: { version: 1 as const },
        level: getLogLevel(),
        levelLocked: isLogLevelLocked(),
      }
    },
  )

  // Текстовый файл генератор клиента не описывает: панель зовёт роут через
  // ядро API-клиента и получает Blob
  app.get(
    '/download',
    {
      schema: {
        hide: true,
        querystring: z.object({ format: z.enum(['log', 'report']).optional() }),
      },
    },
    (request, reply) => {
      const date = new Date().toISOString().slice(0, 10)

      if (request.query.format === 'report') {
        try {
          const stream = exportSupportReport()
          const cancel = () => stream.destroy()
          reply.raw.once('close', cancel)
          stream.once('close', () => reply.raw.off('close', cancel))
          return reply
            .header('Content-Type', 'text/plain; charset=utf-8')
            .header(
              'Content-Disposition',
              `attachment; filename="torsher-report-${date}.txt"`,
            )
            .header('Cache-Control', 'no-store')
            .header('X-Torsher-Report-Version', '1')
            .send(stream)
        }
        catch (error) {
          if (error instanceof ReportBusyError) {
            return reply
              .code(429)
              .header('Retry-After', '30')
              .send({ message: error.message })
          }
          throw error
        }
      }
      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="torsher-${date}.log"`,
        )
        .header('Cache-Control', 'no-store')
        .send(exportLog())
    },
  )

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
