import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import { appliedImport, profileImportParams } from '../dto/imports.ts'
import {
  jellyfinConnectionBody,
  jellyfinConnection as jellyfinConnectionDto,
  jellyfinImportError,
  jellyfinPreviewBody,
  jellyfinPreview as jellyfinPreviewDto,
  jellyfinPreviewStarted,
} from '../dto/jellyfinImport.ts'
import { profileIdParams } from '../dto/profiles.ts'
import { requireSameOriginRead } from '../middleware/auth.ts'
import {
  applyJellyfinPreview,
  cancelJellyfinPreview,
  jellyfinConnection,
  jellyfinPreview,
  startJellyfinPreview,
  stopJellyfinImports,
} from '../services/transfer/jellyfinImport.ts'
import { JellyfinImportError } from '../services/transfer/jellyfinSource.ts'

const errors = {
  400: messageResponse,
  401: messageResponse,
  403: messageResponse,
  404: jellyfinImportError,
  409: jellyfinImportError,
  422: jellyfinImportError,
}

function sendError(reply: FastifyReply, error: unknown) {
  const kind = error instanceof JellyfinImportError ? error.kind : 'response'
  const status = kind === 'expired' ? 404 : kind === 'busy' || kind === 'profileChanged' ? 409 : 422
  return reply.code(status).send({ kind })
}

async function requireHttpsPanel(request: FastifyRequest, reply: FastifyReply) {
  if (request.protocol !== 'https')
    return sendError(reply, new JellyfinImportError('httpsRequired'))
}

export const jellyfinImportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onClose', async () => stopJellyfinImports())
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store')
    return payload
  })

  app.post('/connection', {
    onRequest: requireHttpsPanel,
    bodyLimit: 8 * 1024,
    schema: {
      operationId: 'postProfileJellyfinConnection',
      tags: ['Profiles'],
      params: profileIdParams,
      body: jellyfinConnectionBody,
      response: { 200: jellyfinConnectionDto, ...errors },
    },
  }, async (request, reply) => {
    try {
      return await jellyfinConnection(request.userId!, request.params.id, request.body.url)
    }
    catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/preview', {
    onRequest: requireHttpsPanel,
    bodyLimit: 8 * 1024,
    schema: {
      operationId: 'postProfileJellyfinPreview',
      tags: ['Profiles'],
      params: profileIdParams,
      body: jellyfinPreviewBody,
      response: { 202: jellyfinPreviewStarted, ...errors },
    },
  }, async (request, reply) => {
    try {
      return reply.code(202).send(startJellyfinPreview(request.userId!, request.params.id, request.body))
    }
    catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/preview/:importId', {
    onRequest: requireSameOriginRead,
    schema: {
      operationId: 'getProfileJellyfinPreview',
      tags: ['Profiles'],
      params: profileImportParams,
      response: { 200: jellyfinPreviewDto, ...errors },
    },
  }, async (request, reply) => {
    try {
      return jellyfinPreview(request.userId!, request.params.id, request.params.importId)
    }
    catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/preview/:importId', {
    schema: {
      operationId: 'deleteProfileJellyfinPreview',
      tags: ['Profiles'],
      params: profileImportParams,
      response: { 204: z.undefined(), ...errors },
    },
  }, async (request, reply) => {
    try {
      cancelJellyfinPreview(request.userId!, request.params.id, request.params.importId)
      return reply.code(204).send()
    }
    catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/preview/:importId/apply', {
    schema: {
      operationId: 'postProfileJellyfinApply',
      tags: ['Profiles'],
      params: profileImportParams,
      response: { 200: appliedImport, ...errors },
    },
  }, async (request, reply) => {
    try {
      return applyJellyfinPreview(request.userId!, request.params.id, request.params.importId)
    }
    catch (error) {
      return sendError(reply, error)
    }
  })
}
