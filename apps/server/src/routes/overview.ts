import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import { overviewResponse } from '../dto/overview.ts'
import { requireOwner } from '../middleware/auth.ts'
import { getOverview } from '../services/overview/index.ts'

export const overviewRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '',
    {
      schema: {
        operationId: 'getOverview',
        tags: ['Overview'],
        response: { 200: overviewResponse, 401: messageResponse },
      },
    },
    () => getOverview(),
  )
}
