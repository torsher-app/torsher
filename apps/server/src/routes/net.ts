import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { NetRoute } from '../db/schema.ts'
import type { CheckState } from '../services/net/check.ts'
import { messageResponse } from '../dto/common.ts'
import {
  createNetRoute,
  dnsProviderList,
  netCheckState,
  netRoute,
  netRouteErrorResponse,
  netRouteList,
  netRouteOrder,
  startNetCheck,
  updateNetRoute,
} from '../dto/net.ts'
import { idParams } from '../dto/sources.ts'
import { requireOwner } from '../middleware/auth.ts'
import { checkState, startCheck } from '../services/net/check.ts'
import {
  createRoute,
  DEFAULT_MATCH,
  deleteRoute,
  DOH_PROVIDERS,
  listRoutes,
  NetRouteError,
  reorderRoutes,
  routesChanged,
  updateRoute,
  usesEnvProxy,
} from '../services/net/index.ts'

export function toNetRouteResponse(route: NetRoute) {
  return {
    id: route.id,
    match: route.match,
    isDefault: route.match === DEFAULT_MATCH,
    via: route.via,
    proxy: route.proxyAddress,
    envProxy: usesEnvProxy(route),
    hasUsername: Boolean(route.proxyUsername),
    hasPassword: Boolean(route.proxyPassword),
    dns: route.dns,
    dohUrl: route.dohUrl,
    updatedAt: route.updatedAt.toISOString(),
  }
}

function toCheckResponse(state: CheckState) {
  return {
    running: state.running,
    done: state.done,
    total: state.total,
    finishedAt: state.finishedAt?.toISOString() ?? null,
    hosts: state.hosts.map(host => ({
      id: host.id,
      host: new URL(host.id).host,
      hostname: host.hostname,
      kind: host.kind,
      label: host.label,
      route: {
        id: host.route.id,
        match: host.route.match,
        via: host.route.via,
        dns: host.route.dns,
        envProxy: usesEnvProxy(host.route),
      },
      checking: host.checking,
      status: host.result?.status ?? null,
      httpStatus: host.result?.httpStatus ?? null,
      latencyMs: host.result?.latencyMs ?? null,
      dnsSpoofed: host.result?.dnsSpoofed ?? false,
      checkedAt: host.result?.checkedAt.toISOString() ?? null,
    })),
  }
}

function sendRouteError(reply: FastifyReply, err: unknown) {
  if (!(err instanceof NetRouteError))
    throw err

  return reply
    .code(422)
    .send({ message: err.message, field: err.field, kind: err.kind })
}

const guardResponses = {
  401: messageResponse,
}

/** Сеть — настройка сервера: только сессия аккаунта */
export const netRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '/routes',
    {
      schema: {
        operationId: 'getNetRoutes',
        tags: ['Network'],
        response: { 200: netRouteList, ...guardResponses },
      },
    },
    async () => ({ items: listRoutes().map(toNetRouteResponse) }),
  )

  app.post(
    '/routes',
    {
      schema: {
        operationId: 'postNetRoute',
        tags: ['Network'],
        body: createNetRoute,
        response: {
          201: netRoute,
          400: messageResponse,
          422: netRouteErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const created = createRoute(request.body)

        routesChanged()

        return reply.code(201).send(toNetRouteResponse(created))
      }
      catch (err) {
        return sendRouteError(reply, err)
      }
    },
  )

  app.patch(
    '/routes/:id',
    {
      schema: {
        operationId: 'patchNetRoute',
        tags: ['Network'],
        params: idParams,
        body: updateNetRoute,
        response: {
          200: netRoute,
          400: messageResponse,
          404: messageResponse,
          422: netRouteErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const updated = updateRoute(request.params.id, request.body)

        if (!updated)
          return reply.code(404).send({ message: 'Route not found' })

        routesChanged()

        return toNetRouteResponse(updated)
      }
      catch (err) {
        return sendRouteError(reply, err)
      }
    },
  )

  app.delete(
    '/routes/:id',
    {
      schema: {
        operationId: 'deleteNetRoute',
        tags: ['Network'],
        params: idParams,
        response: {
          200: messageResponse,
          404: messageResponse,
          422: netRouteErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        if (!deleteRoute(request.params.id))
          return reply.code(404).send({ message: 'Route not found' })

        routesChanged()

        return { message: 'Route deleted' }
      }
      catch (err) {
        return sendRouteError(reply, err)
      }
    },
  )

  app.put(
    '/routes/order',
    {
      schema: {
        operationId: 'putNetRouteOrder',
        tags: ['Network'],
        body: netRouteOrder,
        response: {
          200: netRouteList,
          400: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!reorderRoutes(request.body.ids)) {
        return reply
          .code(400)
          .send({ message: 'Order must list every route except the default' })
      }

      routesChanged()

      return { items: listRoutes().map(toNetRouteResponse) }
    },
  )

  app.get(
    '/dns-providers',
    {
      schema: {
        operationId: 'getNetDnsProviders',
        tags: ['Network'],
        response: { 200: dnsProviderList, ...guardResponses },
      },
    },
    async () => ({
      items: Object.entries(DOH_PROVIDERS).map(([id, provider]) => ({
        id: id as keyof typeof DOH_PROVIDERS,
        name: provider.name,
        url: provider.url,
      })),
    }),
  )

  app.get(
    '/check',
    {
      schema: {
        operationId: 'getNetCheck',
        tags: ['Network'],
        response: { 200: netCheckState, ...guardResponses },
      },
    },
    async () => toCheckResponse(checkState()),
  )

  // Проверка идёт после ответа: панель опрашивает `GET /net/check`
  app.post(
    '/check',
    {
      schema: {
        operationId: 'postNetCheck',
        tags: ['Network'],
        body: startNetCheck,
        response: {
          200: netCheckState,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!startCheck(request.body.host))
        return reply.code(404).send({ message: 'Host not found' })

      return toCheckResponse(checkState())
    },
  )
}
