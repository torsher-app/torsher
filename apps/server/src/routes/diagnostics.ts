import { diagnosticSessionState } from '../services/media/sessions.ts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import { config } from '../config.ts'
import { messageResponse } from '../dto/common.ts'
import {
  diagnosticAck,
  diagnosticBatch,
  diagnosticSettings,
  diagnosticStatus,
} from '../dto/diagnostics.ts'
import {
  requireOwner,
  requireViewer,
  streamSubjectOf,
} from '../middleware/auth.ts'
import {
  createDiagnosticReceiver,
  diagnosticsStatus,
} from '../services/diagnostics/index.ts'
import { setSetting } from '../services/settings/index.ts'

function sameOrigin(request: FastifyRequest) {
  const origin = request.headers.origin
  const site = request.headers['sec-fetch-site']
  // Old TVs omit Fetch Metadata, but send Origin on JSON POST/beacon.
  if (origin) {
    return (
      origin === `${request.protocol}://${request.host}`
      || origin === config.clientUrl
    )
  }
  return site === undefined || site === 'same-origin' || site === 'none'
}

export const diagnosticRoutes: FastifyPluginAsyncZod = async (app) => {
  const receiver = createDiagnosticReceiver()
  app.addHook('onClose', async () => receiver.clear())
  // Never echo schema issues (unknown field names may themselves contain secrets).
  app.setErrorHandler((error, _request, reply) => {
    const failure = error as { statusCode?: number, validation?: unknown }
    const code
      = failure.statusCode === 413
        ? 413
        : failure.validation || failure.statusCode === 400
          ? 400
          : 500
    return reply.code(code).send({
      message: code === 413 ? 'diagnostics_too_large' : 'diagnostics_invalid',
    })
  })
  app.get(
    '',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getDiagnostics',
        tags: ['Diagnostics'],
        response: {
          200: diagnosticStatus,
          401: messageResponse,
          403: messageResponse,
        },
      },
    },
    request => diagnosticsStatus(request),
  )
  app.put(
    '/settings',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'putDiagnosticSettings',
        tags: ['Diagnostics'],
        body: diagnosticSettings,
        response: {
          200: diagnosticSettings,
          400: messageResponse,
          401: messageResponse,
          403: messageResponse,
        },
      },
    },
    (request) => {
      setSetting('userActionDiagnostics', request.body.enabled)
      return request.body
    },
  )
  app.post(
    '/events',
    {
      bodyLimit: 32 * 1024,
      onRequest: async (request, reply) => {
        await requireViewer(request, reply)
        if (!reply.sent && !sameOrigin(request))
          return reply.code(403).send({ message: 'cross_site_request' })
      },
      schema: {
        operationId: 'postDiagnosticEvents',
        tags: ['Diagnostics'],
        body: diagnosticBatch,
        response: {
          200: diagnosticAck,
          400: messageResponse,
          401: messageResponse,
          403: messageResponse,
          409: messageResponse,
          413: messageResponse,
          429: messageResponse,
        },
      },
    },
    async (request, reply) => {
      if (
        request.body.deviceId !== request.deviceId
        || request.body.profileId !== request.profileId
      ) {
        return reply.code(409).send({ message: 'diagnostics_actor_changed' })
      }
      if (
        receiver.limited(
          `${request.userId}:${request.deviceId}:${request.profileId}`,
          request.body.events.length,
        )
      ) {
        return reply
          .header('Retry-After', '5')
          .code(429)
          .send({ message: 'diagnostics_rate_limit' })
      }
      return receiver.receive(request.body, request, id =>
        diagnosticSessionState(id, streamSubjectOf(request)))
    },
  )
}
