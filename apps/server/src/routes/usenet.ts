import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply } from 'fastify'
import { and, eq, or } from 'drizzle-orm'
import { getDb } from '../db/index.ts'
import { mediaFiles, usenetJobs } from '../db/schema.ts'
import { messageResponse } from '../dto/common.ts'
import { idParams } from '../dto/sources.ts'
import { titleParams } from '../dto/titles.ts'
import {
  titleUsenetQuery,
  titleUsenetRequest,
  titleUsenetSources,
  usenetAddress,
  usenetAddressInput,
  usenetCheck,
  usenetConfig,
  usenetConfigInput,
  usenetConfigView,
  usenetJob,
  usenetJobList,
} from '../dto/usenet.ts'
import {
  requireOwner,
  requireSameOrigin,
  requireViewer,
  streamSubjectOf,
  viewerStillOnProfile,
} from '../middleware/auth.ts'
import {
  episodeFacts,
  torrentDownloadingEpisodes,
} from '../services/follow/episodes.ts'
import { followOf } from '../services/follow/index.ts'
import { topicRefreshEpisodes } from '../services/follow/topics.ts'
import { withMaintenanceLease } from '../services/libraryMaintenance/admission.ts'
import { withDownloadAdmission } from '../services/newznab/admission.ts'
import { previewNewznabAddress } from '../services/newznab/client.ts'
import {
  candidateCurrent,
  downloadNewznabCandidate,
  getViewerNewznabCandidate,
  hasNewznabIndexers,
  searchNewznab,
  viewerNewznabResults,
} from '../services/newznab/search.ts'
import {
  requireTitleAccess,
  titleAllowedCached,
} from '../services/profiles/access.ts'
import { asViewerSearch } from '../services/sources/search.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'
import {
  checkUsenetConfig,
  enqueueUsenet,
  getUsenetConfig,
  listUsenetJobs,
  readyUsenet,
  reconcileUsenetJob,
  releaseUsenetJob,
  saveUsenetConfig,
} from '../services/usenet/index.ts'
import { createRateLimiter } from '../utils/rateLimit.ts'

const ownerErrors = {
  400: messageResponse,
  401: messageResponse,
  403: messageResponse,
  404: messageResponse,
  409: messageResponse,
  422: messageResponse,
}
const viewerErrors = { ...ownerErrors, 429: messageResponse }
const lookupLimit = createRateLimiter({ limit: 30, windowMs: 60_000 })
const attemptLimit = createRateLimiter({ limit: 30, windowMs: 60_000 })
const emptySources = { items: [], failed: false }

function ownerFailure(reply: FastifyReply) {
  return reply
    .code(422)
    .send({ message: 'Usenet operation could not be verified' })
}

export const usenetOwnerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
  })

  app.get(
    '',
    {
      schema: {
        operationId: 'getUsenetConfig',
        tags: ['Sources'],
        response: { 200: usenetConfigView, ...ownerErrors },
      },
    },
    async () => ({ config: getUsenetConfig() }),
  )

  app.post(
    '/check',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'postUsenetCheck',
        tags: ['Sources'],
        body: usenetConfigInput,
        response: { 200: usenetCheck, ...ownerErrors },
      },
    },
    async (request, reply) => {
      try {
        return await checkUsenetConfig(request.body)
      }
      catch {
        return ownerFailure(reply)
      }
    },
  )

  app.put(
    '',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'putUsenetConfig',
        tags: ['Sources'],
        body: usenetConfigInput,
        response: { 200: usenetConfig, ...ownerErrors },
      },
    },
    async (request, reply) => {
      try {
        return await saveUsenetConfig(request.body)
      }
      catch {
        return ownerFailure(reply)
      }
    },
  )

  app.post(
    '/address',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'postUsenetAddress',
        tags: ['Sources'],
        body: usenetAddressInput,
        response: { 200: usenetAddress, ...ownerErrors },
      },
    },
    async (request, reply) => {
      try {
        return await previewNewznabAddress(request.body.url)
      }
      catch {
        return ownerFailure(reply)
      }
    },
  )

  app.get(
    '/jobs',
    {
      schema: {
        operationId: 'getUsenetJobs',
        tags: ['Sources'],
        response: { 200: usenetJobList, ...ownerErrors },
      },
    },
    async () => ({ items: listUsenetJobs() }),
  )

  app.post(
    '/jobs/:id/reconcile',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'postUsenetReconcile',
        tags: ['Sources'],
        params: idParams,
        response: { 200: usenetJob, ...ownerErrors },
      },
    },
    async (request, reply) => {
      try {
        return await reconcileUsenetJob(request.params.id)
      }
      catch {
        return ownerFailure(reply)
      }
    },
  )

  app.post(
    '/jobs/:id/release',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'postUsenetRelease',
        tags: ['Sources'],
        params: idParams,
        response: { 200: usenetJob, ...ownerErrors },
      },
    },
    async (request, reply) => {
      try {
        return await releaseUsenetJob(request.params.id)
      }
      catch {
        return ownerFailure(reply)
      }
    },
  )
}

function targetOf(
  titleId: string,
  input: { season?: number | string, episode?: number | string },
) {
  const ref = parseCatalogId(titleId)
  if (!ref)
    return undefined
  const season = Number(input.season ?? 0)
  const episode = Number(input.episode ?? 0)
  if (
    ref.type === 'movie'
      ? season !== 0 || episode !== 0
      : input.season === undefined || episode < 1
  ) {
    return undefined
  }
  return { titleId, season, episode }
}

export function hasUsenetSources(follow = false) {
  return readyUsenet(follow) && hasNewznabIndexers()
}

export const usenetViewerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireViewer)
  app.addHook('preHandler', requireTitleAccess)
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
  })

  app.get(
    '/titles/:id/usenet-sources',
    {
      schema: {
        operationId: 'getTitleUsenetSources',
        tags: ['Titles'],
        params: titleParams,
        querystring: titleUsenetQuery,
        response: { 200: titleUsenetSources, ...viewerErrors },
      },
    },
    async (request, reply) => {
      if (!hasUsenetSources())
        return emptySources
      if (!lookupLimit.hit(streamSubjectOf(request)!))
        return reply.code(429).send({ message: 'Too many source requests' })
      const target = targetOf(request.params.id, request.query)
      if (!target)
        return reply.code(404).send({ message: 'Title or episode not found' })

      const profileId = request.profileId
      try {
        const result = await asViewerSearch(() =>
          searchNewznab(target, { query: request.query.query }),
        )
        if (!result) {
          return reply
            .code(404)
            .send({ message: 'Title or episode not found' })
        }
        if (
          !viewerStillOnProfile(request, profileId)
          || !titleAllowedCached(profileId, target.titleId)
        ) {
          return reply
            .code(404)
            .send({ message: 'Title or episode not found' })
        }
        return {
          items: viewerNewznabResults(result.candidates, profileId),
          failed: result.failed > 0,
        }
      }
      catch {
        return ownerFailure(reply)
      }
    },
  )

  app.get(
    '/titles/:id/usenet-jobs',
    {
      schema: {
        operationId: 'getTitleUsenetJobs',
        tags: ['Titles'],
        params: titleParams,
        response: { 200: usenetJobList, ...viewerErrors },
      },
    },
    async (request, reply) => {
      const titleId = request.params.id
      const profileId = request.profileId
      if (
        !viewerStillOnProfile(request, profileId)
        || !titleAllowedCached(profileId, titleId)
      ) {
        return reply.code(404).send({ message: 'Title or episode not found' })
      }
      const own = getDb()
        .select({ id: usenetJobs.id, mediaFileId: mediaFiles.id })
        .from(usenetJobs)
        .leftJoin(
          mediaFiles,
          and(
            eq(mediaFiles.id, usenetJobs.mediaFileId),
            eq(mediaFiles.state, 'present'),
          ),
        )
        .where(
          and(
            eq(usenetJobs.titleId, titleId),
            or(
              eq(usenetJobs.profileId, profileId),
              eq(usenetJobs.origin, 'follow'),
            ),
          ),
        )
        .all()
      const visible = new Map(own.map(item => [item.id, item.mediaFileId]))
      return {
        items: listUsenetJobs(titleId).flatMap(item =>
          visible.has(item.id)
            ? [{ ...item, mediaFileId: visible.get(item.id) ?? null }]
            : [],
        ),
      }
    },
  )

  app.post(
    '/titles/:id/usenet-jobs',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'postTitleUsenetJob',
        tags: ['Titles'],
        params: titleParams,
        body: titleUsenetRequest,
        response: { 202: usenetJob, ...viewerErrors },
      },
    },
    async (request, reply) => {
      if (!attemptLimit.hit(streamSubjectOf(request)!))
        return reply.code(429).send({ message: 'Too many download requests' })
      const target = targetOf(request.params.id, request.body)
      const profileId = request.profileId
      const current = () =>
        target
        && viewerStillOnProfile(request, profileId)
        && titleAllowedCached(profileId, target.titleId)
      if (!target || !current())
        return reply.code(404).send({ message: 'Title or episode not found' })

      try {
        return await withDownloadAdmission(target.titleId, () =>
          withMaintenanceLease(
            { titleId: target.titleId, producer: true },
            async () => {
              const candidate = getViewerNewznabCandidate(
                request.body.candidateId,
                target,
                profileId,
              )
              if (!current() || !candidate || !readyUsenet()) {
                return reply
                  .code(404)
                  .send({ message: 'Source is no longer available' })
              }
              const torrents = torrentDownloadingEpisodes(
                target.titleId,
                target.episode ? 'series' : 'movie',
              )
              const episodeKey = `${target.season}:${target.episode}`
              const follow = followOf(target.titleId)
              if (
                torrents.has(episodeKey)
                || topicRefreshEpisodes(target.titleId).has(episodeKey)
                || (follow && episodeFacts(follow.id).grabbing.has(episodeKey))
              ) {
                return reply
                  .code(409)
                  .send({ message: 'An active download owns the target' })
              }

              const job = await enqueueUsenet(
                { ...candidate, origin: 'manual', profileId },
                () => downloadNewznabCandidate(candidate, false),
                () => !!current() && candidateCurrent(candidate, false),
              )
              const own = getDb()
                .select({ profileId: usenetJobs.profileId })
                .from(usenetJobs)
                .where(eq(usenetJobs.id, job.id))
                .get()
              if (job.origin === 'manual' && own?.profileId !== profileId) {
                return reply
                  .code(409)
                  .send({ message: 'An active download owns the target' })
              }
              return reply.code(202).send(job)
            },
          ))
      }
      catch {
        return ownerFailure(reply)
      }
    },
  )
}
