import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply } from 'fastify'
import type { HttpAddonErrorKind } from '../dto/httpAddons.ts'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import {
  createHttpAddon,
  httpAddon,
  httpAddonCapabilities,
  httpAddonError,
  httpAddonErrorKind,
  httpAddonList,
  httpAddonParams,
  httpAddonPreview,
  inspectHttpAddon,
  recheckHttpAddon,
  testHttpAddon,
  updateHttpAddon,
} from '../dto/httpAddons.ts'
import { requireOwner, requireSameOrigin } from '../middleware/auth.ts'
import {
  insertHttpAddon,
  listHttpAddons,
  patchHttpAddon,
  previewHttpAddon,
  recheckStoredHttpAddon,
  removeHttpAddon,
  testHttpAddonManifest,
} from '../services/addons/config.ts'
import { AddonError } from '../services/addons/transport.ts'
import { createRateLimiter } from '../utils/rateLimit.ts'

const ERROR_CODES: Record<HttpAddonErrorKind, number> = {
  invalid_url: 400,
  blocked_address: 422,
  needs_confirmation: 409,
  address_changed: 409,
  unsupported_route: 422,
  timeout: 504,
  unavailable: 502,
  bad_response: 422,
  unsupported_manifest: 422,
  rate_limited: 429,
  busy: 429,
  not_found: 404,
  conflict: 409,
}

const errors = {
  400: messageResponse.extend({ kind: httpAddonErrorKind.optional() }),
  401: messageResponse,
  403: messageResponse,
  404: httpAddonError,
  409: httpAddonError,
  422: httpAddonError,
  429: httpAddonError,
  502: httpAddonError,
  504: httpAddonError,
}
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 })

function ownerRequest<T>(reply: FastifyReply, action: () => T | Promise<T>) {
  return Promise.resolve()
    .then(action)
    .catch((error: unknown) => {
      const kind = error instanceof AddonError ? error.kind : 'unavailable'
      reply.code(ERROR_CODES[kind]).send({ kind, message: kind })
      return undefined
    })
}

export const httpAddonRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '/',
    {
      schema: {
        operationId: 'getHttpAddons',
        tags: ['Sources'],
        response: { 200: httpAddonList, ...errors },
      },
    },
    async () => listHttpAddons(),
  )

  app.post(
    '/preview',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'previewHttpAddon',
        tags: ['Sources'],
        body: inspectHttpAddon,
        response: { 200: httpAddonPreview, ...errors },
      },
    },
    async (request, reply) =>
      ownerRequest(reply, () => {
        if (!limiter.hit(request.userId!))
          throw new AddonError('rate_limited')
        return previewHttpAddon(request.userId!, request.body)
      }),
  )

  app.post(
    '/test',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'testHttpAddon',
        tags: ['Sources'],
        body: testHttpAddon,
        response: { 200: httpAddonCapabilities, ...errors },
      },
    },
    async (request, reply) =>
      ownerRequest(reply, () => {
        if (!limiter.hit(request.userId!))
          throw new AddonError('rate_limited')
        return testHttpAddonManifest(request.userId!, request.body)
      }),
  )

  app.post(
    '/',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'postHttpAddon',
        tags: ['Sources'],
        body: createHttpAddon,
        response: { 201: httpAddon, ...errors },
      },
    },
    async (request, reply) =>
      ownerRequest(reply, async () => {
        if (!limiter.hit(request.userId!))
          throw new AddonError('rate_limited')
        const addon = await insertHttpAddon(request.userId!, request.body)
        return reply.code(201).send(addon)
      }),
  )

  app.patch(
    '/:id',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'patchHttpAddon',
        tags: ['Sources'],
        params: httpAddonParams,
        body: updateHttpAddon,
        response: { 200: httpAddon, ...errors },
      },
    },
    async (request, reply) =>
      ownerRequest(reply, () => {
        if (!limiter.hit(request.userId!))
          throw new AddonError('rate_limited')
        return patchHttpAddon(request.userId!, request.params.id, request.body)
      }),
  )

  app.post(
    '/:id/check',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'recheckHttpAddon',
        tags: ['Sources'],
        params: httpAddonParams,
        body: recheckHttpAddon,
        response: { 200: httpAddon, ...errors },
      },
    },
    async (request, reply) =>
      ownerRequest(reply, () => {
        if (!limiter.hit(request.userId!))
          throw new AddonError('rate_limited')
        return recheckStoredHttpAddon(
          request.userId!,
          request.params.id,
          request.body.approvalId,
        )
      }),
  )

  app.delete(
    '/:id',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'deleteHttpAddon',
        tags: ['Sources'],
        params: httpAddonParams,
        response: { 204: z.undefined(), ...errors },
      },
    },
    async (request, reply) =>
      ownerRequest(reply, () => {
        removeHttpAddon(request.params.id)
        return reply.code(204).send()
      }),
  )
}
