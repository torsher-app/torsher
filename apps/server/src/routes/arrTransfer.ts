import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  arrApplyBody,
  arrApplyResult,
  arrConnection,
  arrConnectionBody,
  arrErrorResponse,
  arrId,
  arrPreview,
  arrPreviewBody,
  arrPreviewStarted,
} from '../dto/arrTransfer.ts'
import { messageResponse } from '../dto/common.ts'
import { requireSameOriginRead } from '../middleware/auth.ts'
import { createArrImportService } from '../services/transfer/arrImport.ts'
import { ArrImportError } from '../services/transfer/arrSource.ts'

const errors = {
  400: messageResponse,
  401: messageResponse,
  403: messageResponse,
  404: arrErrorResponse,
  409: arrErrorResponse,
  422: arrErrorResponse,
}

function sendArrError(reply: FastifyReply, error: unknown) {
  const kind = error instanceof ArrImportError ? error.kind : 'request'
  const status = kind === 'expired' ? 404 : kind === 'busy' ? 409 : 422
  return reply.code(status).send({ message: kind, kind })
}

export const arrTransferRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createArrImportService()
  app.addHook('onClose', async () => service.close())
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store')
    return payload
  })

  app.post(
    '/connection',
    {
      bodyLimit: 8 * 1024,
      schema: {
        operationId: 'postArrConnection',
        tags: ['Transfer'],
        body: arrConnectionBody,
        response: { 200: arrConnection, ...errors },
      },
    },
    async (request, reply) => {
      try {
        return await service.connection(request.userId!, request.body)
      }
      catch (error) {
        return sendArrError(reply, error)
      }
    },
  )

  app.post(
    '/preview',
    {
      bodyLimit: 8 * 1024,
      schema: {
        operationId: 'postArrPreview',
        tags: ['Transfer'],
        body: arrPreviewBody,
        response: { 202: arrPreviewStarted, ...errors },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(202)
          .send(service.start(request.userId!, request.body))
      }
      catch (error) {
        return sendArrError(reply, error)
      }
    },
  )

  app.get(
    '/preview/:id',
    {
      onRequest: requireSameOriginRead,
      schema: {
        operationId: 'getArrPreview',
        tags: ['Transfer'],
        params: arrId,
        response: { 200: arrPreview, ...errors },
      },
    },
    async (request, reply) => {
      try {
        return service.preview(request.userId!, request.params.id)
      }
      catch (error) {
        return sendArrError(reply, error)
      }
    },
  )

  app.delete(
    '/preview/:id',
    {
      schema: {
        operationId: 'deleteArrPreview',
        tags: ['Transfer'],
        params: arrId,
        response: { 204: z.undefined(), ...errors },
      },
    },
    async (request, reply) => {
      try {
        service.cancel(request.userId!, request.params.id)
        return reply.code(204).send()
      }
      catch (error) {
        return sendArrError(reply, error)
      }
    },
  )

  app.post(
    '/apply',
    {
      bodyLimit: 64 * 1024,
      schema: {
        operationId: 'postArrApply',
        tags: ['Transfer'],
        body: arrApplyBody,
        response: { 200: arrApplyResult, ...errors },
      },
    },
    async (request, reply) => {
      try {
        return service.apply(request.userId!, request.body)
      }
      catch (error) {
        return sendArrError(reply, error)
      }
    },
  )
}
