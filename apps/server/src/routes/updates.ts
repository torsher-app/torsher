import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import {
  dismissUpdateBody,
  updateSettingsBody,
  updateStatusResponse,
} from '../dto/updates.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  checkForUpdatesNow,
  dismissUpdate,
  saveUpdateSettings,
  updateStatus,
} from '../services/updates/index.ts'

const guardResponses = { 401: messageResponse }

/** Проверка обновлений: только владелец, версию без входа отдаёт `/about` */
export const updateRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '',
    {
      schema: {
        operationId: 'getUpdateStatus',
        tags: ['Updates'],
        response: { 200: updateStatusResponse, ...guardResponses },
      },
    },
    () => updateStatus(),
  )

  app.put(
    '/settings',
    {
      schema: {
        operationId: 'updateUpdateSettings',
        tags: ['Updates'],
        body: updateSettingsBody,
        response: { 200: updateStatusResponse, ...guardResponses },
      },
    },
    (request) => {
      saveUpdateSettings(request.body)

      return updateStatus()
    },
  )

  app.post(
    '/check',
    {
      schema: {
        operationId: 'checkForUpdates',
        tags: ['Updates'],
        response: { 200: updateStatusResponse, ...guardResponses },
      },
    },
    async () => {
      await checkForUpdatesNow()

      return updateStatus()
    },
  )

  app.post(
    '/dismiss',
    {
      schema: {
        operationId: 'dismissUpdate',
        tags: ['Updates'],
        body: dismissUpdateBody,
        response: { 204: z.null(), ...guardResponses },
      },
    },
    async (request, reply) => {
      dismissUpdate(request.body.version)

      return reply.code(204).send(null)
    },
  )
}
