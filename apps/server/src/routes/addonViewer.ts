import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import {
  addonCatalogRows,
  addonHomeQuery,
  addonSourcePlayback,
  addonSourceQuery,
  addonSources,
  playHttpAddonSource,
} from '../dto/addonViewer.ts'
import { messageResponse } from '../dto/common.ts'
import { httpAddonError } from '../dto/httpAddons.ts'
import { titleParams } from '../dto/titles.ts'
import { engineUnavailableResponse } from '../dto/torrents.ts'
import {
  requireSameOrigin,
  requireViewer,
  streamSubjectOf,
  viewerStillOnProfile,
} from '../middleware/auth.ts'
import { findAddonCatalogRows } from '../services/addons/catalog.ts'
import { AddonError } from '../services/addons/index.ts'
import {
  findAddonSources,
  hasAddonStreams,
  playAddonSource,
} from '../services/addons/streams.ts'
import {
  ADDON_QUERY_MS,
  addonTarget,
  boundedAddonResult,
} from '../services/addons/target.ts'
import { EngineError } from '../services/engine/index.ts'
import {
  titleAllowed,
  titleAllowedCached,
} from '../services/profiles/access.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'
import { TorrentSessionConflictError } from '../services/torrents/index.ts'
import { createRateLimiter } from '../utils/rateLimit.ts'
import { sendEngineError } from './engineResponses.ts'

const notFound = {
  kind: 'not_found',
  message: 'Source is no longer available',
} as const
const rateLimited = {
  kind: 'rate_limited',
  message: 'Too many source requests',
} as const
const emptySources = { items: [], failed: false }
const lookupLimit = createRateLimiter({ limit: 30, windowMs: 60_000 })
const selectionLimit = createRateLimiter({ limit: 120, windowMs: 60_000 })
const catalogLimit = createRateLimiter({ limit: 20, windowMs: 60_000 })
const guards = {
  400: messageResponse,
  401: messageResponse,
  403: messageResponse,
  404: httpAddonError,
  429: httpAddonError,
}

export const addonViewerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireViewer)
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
  })

  app.get(
    '/titles/:id/addon-sources',
    {
      schema: {
        operationId: 'getTitleAddonSources',
        tags: ['Titles'],
        params: titleParams,
        querystring: addonSourceQuery,
        response: { 200: addonSources, ...guards },
      },
    },
    async (request, reply) => {
      const titleId = request.params.id
      const ref = parseCatalogId(titleId)
      if (!ref)
        return reply.code(404).send(notFound)
      const { season, episode, language } = request.query
      const tv = ref.type === 'tv'
      if (
        !hasAddonStreams(tv ? 'series' : 'movie')
        || (tv && season === undefined)
      ) {
        return emptySources
      }

      const viewer = {
        subject: streamSubjectOf(request)!,
        profileId: request.profileId,
      }
      if (!lookupLimit.hit(viewer.subject))
        return reply.code(429).send(rateLimited)
      const current = () => viewerStillOnProfile(request, viewer.profileId)
      const accessible = () =>
        current() && titleAllowedCached(viewer.profileId, titleId)
      const signal = AbortSignal.timeout(ADDON_QUERY_MS)

      try {
        if (
          !current()
          || !(await boundedAddonResult(
            titleAllowed(viewer.profileId, titleId),
            signal,
          ))
          || !accessible()
        ) {
          return reply.code(404).send(notFound)
        }
        const target = await addonTarget(
          titleId,
          season === undefined
            ? undefined
            : {
                season: Number(season),
                episode: Number(episode),
              },
          language,
          signal,
        )
        if (!accessible())
          return reply.code(404).send(notFound)
        return target
          ? await findAddonSources(target, viewer, accessible, signal)
          : emptySources
      }
      catch (error) {
        if (
          !current()
          || (error instanceof AddonError && error.kind === 'not_found')
        ) {
          return reply.code(404).send(notFound)
        }
        return { items: [], failed: true }
      }
    },
  )

  app.post(
    '/titles/:id/addon-sources/play',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'postTitleAddonSourcePlay',
        tags: ['Titles'],
        params: titleParams,
        body: playHttpAddonSource,
        response: {
          200: addonSourcePlayback,
          ...guards,
          409: httpAddonError,
          422: httpAddonError,
          502: messageResponse,
          503: engineUnavailableResponse,
          504: messageResponse,
        },
      },
    },
    async (request, reply) => {
      const viewer = {
        subject: streamSubjectOf(request)!,
        profileId: request.profileId,
      }
      if (!selectionLimit.hit(viewer.subject))
        return reply.code(429).send(rateLimited)
      try {
        return await playAddonSource(
          request.body.candidateId,
          request.params.id,
          viewer,
          () => viewerStillOnProfile(request, viewer.profileId),
        )
      }
      catch (error) {
        if (error instanceof AddonError) {
          if (error.kind === 'not_found')
            return reply.code(404).send(notFound)
          const status = error.kind === 'conflict' ? 409 : 422
          return reply
            .code(status)
            .send({ kind: error.kind, message: 'Source is unavailable' })
        }
        if (
          error instanceof TorrentSessionConflictError
          || (error instanceof EngineError && error.kind === 'moving')
        ) {
          return reply
            .code(409)
            .send({ kind: 'conflict', message: 'Source is unavailable' })
        }
        if (error instanceof EngineError) {
          return sendEngineError(
            reply,
            new EngineError(error.kind, 'Source is unavailable', {
              status: error.status,
              unavailable: error.unavailable,
            }),
          )
        }
        throw error
      }
    },
  )

  app.get(
    '/home/addon-rows',
    {
      schema: {
        operationId: 'getHomeAddonRows',
        tags: ['Catalog'],
        querystring: addonHomeQuery,
        response: { 200: addonCatalogRows, ...guards },
      },
    },
    async (request, reply) => {
      const { mode, language } = request.query
      const { profileId } = request
      const subject = streamSubjectOf(request)!
      if (!catalogLimit.hit(subject))
        return reply.code(429).send(rateLimited)
      const current = () => viewerStillOnProfile(request, profileId)
      if (!current())
        return reply.code(404).send(notFound)
      try {
        return await findAddonCatalogRows(
          mode,
          language,
          profileId,
          current,
          AbortSignal.timeout(ADDON_QUERY_MS),
        )
      }
      catch (error) {
        if (error instanceof AddonError && error.kind === 'not_found')
          return reply.code(404).send(notFound)
        throw error
      }
    },
  )
}
