import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { CursorChoice, FollowRules } from '../services/follow/index.ts'
import { messageResponse } from '../dto/common.ts'
import {
  blocklistParams,
  blocklistResponse,
  blockRelease as blockReleaseBody,
  followActivityQuery,
  followActivityResponse,
  followCandidatesQuery,
  followCandidatesResponse,
  followDetails,
  followLanguageQuery,
  followListResponse,
  followParams,
  followQueueResponse,
  followTitle as followTitleBody,
  scheduleResponse,
  titleFollowResponse,
  updateFollow as updateFollowBody,
} from '../dto/follow.ts'
import { titleParams } from '../dto/titles.ts'
import {
  canManageLibrary,
  requireOwner,
  requireViewer,
} from '../middleware/auth.ts'
import { listBlocklist, unblockRelease } from '../services/follow/blocklist.ts'
import { profileSchedule } from '../services/follow/calendar.ts'
import {
  deleteFollow,
  followById,
  followTitle,
  unfollowTitle,
  updateFollow,
} from '../services/follow/index.ts'
import { confirmUnsure } from '../services/follow/feed.ts'
import {
  blockFromSnapshot,
  dismissUnsure,
  followActivity,
  followCandidates,
  followQueue,
} from '../services/follow/panel.ts'
import { requestFollowSearch } from '../services/follow/search.ts'
import {
  followDetailsOf,
  followSummaries,
  titleFollowView,
} from '../services/follow/views.ts'
import { compareEpisodes, parseEpisodeKey } from '../services/follow/wanted.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'
import { sendTmdbError } from './catalog.ts'

const titleNotFound = { message: 'Title not found' }
const followNotFound = { message: 'Follow not found' }

const ownerErrors = {
  401: messageResponse,
  404: messageResponse,
}

const viewerErrors = {
  401: messageResponse,
  403: messageResponse,
  404: messageResponse,
}

const tmdbErrors = {
  502: messageResponse,
  503: messageResponse,
}

type FollowBody = FollowRules & { start?: CursorChoice }

function splitBody({ start, ...rules }: FollowBody) {
  return { start, rules }
}

/** zod отбрасывает лишние поля: всё, что пришло, — правила и курсор */
function changesRules(body: FollowBody) {
  return Object.values(body).some(value => value !== undefined)
}

/**
 * «Следить»: витрина подписывает профиль и показывает расписание, панель
 * правит слежения целиком.
 */
export const followRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/titles/:id/follow',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getTitleFollow',
        tags: ['Follow'],
        params: titleParams,
        querystring: followLanguageQuery,
        response: { 200: titleFollowResponse, ...viewerErrors },
      },
    },
    async (request, reply) => {
      const { id } = request.params

      if (!parseCatalogId(id))
        return reply.code(404).send(titleNotFound)

      return titleFollowView(
        id,
        request.profileId,
        canManageLibrary(request),
        request.query.language,
      )
    },
  )

  app.put(
    '/titles/:id/follow',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'followTitle',
        tags: ['Follow'],
        params: titleParams,
        querystring: followLanguageQuery,
        body: followTitleBody,
        response: { 200: titleFollowResponse, ...viewerErrors, ...tmdbErrors },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { language } = request.query
      const canEdit = canManageLibrary(request)

      if (!parseCatalogId(id))
        return reply.code(404).send(titleNotFound)

      // Правила общие на сервер: профиль с возрастным порогом только подписывается
      if (!canEdit && changesRules(request.body))
        return reply.code(403).send({ message: 'follow_rules_forbidden' })

      try {
        await followTitle(
          id,
          request.profileId,
          splitBody(request.body),
          language,
        )
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }

      return titleFollowView(id, request.profileId, canEdit, language)
    },
  )

  app.delete(
    '/titles/:id/follow',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'unfollowTitle',
        tags: ['Follow'],
        params: titleParams,
        querystring: followLanguageQuery,
        response: { 200: titleFollowResponse, ...viewerErrors },
      },
    },
    async (request, reply) => {
      const { id } = request.params

      if (!parseCatalogId(id))
        return reply.code(404).send(titleNotFound)

      unfollowTitle(id, request.profileId)

      return titleFollowView(
        id,
        request.profileId,
        canManageLibrary(request),
        request.query.language,
      )
    },
  )

  app.get(
    '/schedule',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getSchedule',
        tags: ['Follow'],
        querystring: followLanguageQuery,
        response: { 200: scheduleResponse, ...viewerErrors },
      },
    },
    async request =>
      profileSchedule(request.profileId, request.query.language),
  )

  app.get(
    '/follows',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getFollows',
        tags: ['Follow'],
        querystring: followLanguageQuery,
        response: { 200: followListResponse, 401: messageResponse },
      },
    },
    async request => ({
      items: await followSummaries(request.query.language),
    }),
  )

  app.get(
    '/follows/:id',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getFollow',
        tags: ['Follow'],
        params: followParams,
        querystring: followLanguageQuery,
        response: {
          200: followDetails,
          401: messageResponse,
          404: messageResponse,
        },
      },
    },
    async (request, reply) => {
      const details = await followDetailsOf(
        request.params.id,
        request.query.language,
      )

      return details ?? reply.code(404).send(followNotFound)
    },
  )

  app.patch(
    '/follows/:id',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'updateFollow',
        tags: ['Follow'],
        params: followParams,
        querystring: followLanguageQuery,
        body: updateFollowBody,
        response: {
          200: followDetails,
          401: messageResponse,
          404: messageResponse,
          ...tmdbErrors,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { language } = request.query
      const { state, ...body } = request.body

      try {
        if (!(await updateFollow(id, { ...splitBody(body), state }, language)))
          return reply.code(404).send(followNotFound)
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }

      return (
        (await followDetailsOf(id, language))
        ?? reply.code(404).send(followNotFound)
      )
    },
  )

  app.delete(
    '/follows/:id',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'deleteFollow',
        tags: ['Follow'],
        params: followParams,
        response: {
          200: messageResponse,
          401: messageResponse,
          404: messageResponse,
        },
      },
    },
    async (request, reply) => {
      if (!deleteFollow(request.params.id))
        return reply.code(404).send(followNotFound)

      return { message: 'Follow deleted' }
    },
  )
  app.get(
    '/follows/:id/candidates',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getFollowCandidates',
        tags: ['Follow'],
        params: followParams,
        querystring: followCandidatesQuery,
        response: { 200: followCandidatesResponse, ...ownerErrors },
      },
    },
    async (request, reply) => {
      const { id } = request.params

      if (!followById(id))
        return reply.code(404).send(followNotFound)

      return followCandidates(id, request.query.season, request.query.episode)
    },
  )

  app.post(
    '/follows/:id/search',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'postFollowSearch',
        tags: ['Follow'],
        params: followParams,
        response: {
          200: messageResponse,
          409: messageResponse,
          ...ownerErrors,
        },
      },
    },
    async (request, reply) => {
      const follow = followById(request.params.id)

      if (!follow)
        return reply.code(404).send(followNotFound)

      // На паузе и остановленные планировщик не смотрит: поиск бы не прошёл
      if (follow.state !== 'active')
        return reply.code(409).send({ message: 'follow_not_active' })

      requestFollowSearch(follow.id, 'manual')
      return { message: 'Search requested' }
    },
  )

  app.get(
    '/follow/activity',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getFollowActivity',
        tags: ['Follow'],
        querystring: followActivityQuery,
        response: { 200: followActivityResponse, 401: messageResponse },
      },
    },
    async (request) => {
      const { follow, ...query } = request.query

      return followActivity({ ...query, followId: follow })
    },
  )

  app.post(
    '/follow/unsure/:id/confirm',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'postFollowUnsureConfirm',
        tags: ['Follow'],
        params: followParams,
        response: { 200: messageResponse, ...ownerErrors },
      },
    },
    async (request, reply) => {
      // На паузе алиас запоминается, а решатель подождёт возобновления
      if ((await confirmUnsure(request.params.id)) === 'not_found')
        return reply.code(404).send({ message: 'Entry not found' })

      return { message: 'Release confirmed' }
    },
  )

  app.post(
    '/follow/unsure/:id/dismiss',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'postFollowUnsureDismiss',
        tags: ['Follow'],
        params: followParams,
        response: { 200: messageResponse, ...ownerErrors },
      },
    },
    async (request, reply) => {
      if (!dismissUnsure(request.params.id))
        return reply.code(404).send({ message: 'Entry not found' })

      return { message: 'Release dismissed' }
    },
  )

  app.get(
    '/follow/queue',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getFollowQueue',
        tags: ['Follow'],
        response: { 200: followQueueResponse, 401: messageResponse },
      },
    },
    async () => ({ items: await followQueue() }),
  )

  app.get(
    '/follow/blocklist',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getFollowBlocklist',
        tags: ['Follow'],
        response: { 200: blocklistResponse, 401: messageResponse },
      },
    },
    async () => ({
      items: listBlocklist().map(row => ({
        id: row.id,
        titleId: row.titleId,
        infoHash: row.infoHash,
        releaseTitle: row.releaseTitle,
        reason: row.reason,
        episodes:
          row.episodes?.map(parseEpisodeKey).sort(compareEpisodes) ?? null,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
      })),
    }),
  )

  app.post(
    '/follow/blocklist',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'postFollowBlocklist',
        tags: ['Follow'],
        body: blockReleaseBody,
        response: {
          200: messageResponse,
          409: messageResponse,
          ...ownerErrors,
        },
      },
    },
    async (request, reply) => {
      const { followId, candidateId } = request.body
      const result = blockFromSnapshot(followId, candidateId)

      if (result === 'not_found')
        return reply.code(404).send({ message: 'Release not found' })

      // Снимок прежней версии не знает показов раздачи без infohash
      if (result === 'release_unknown')
        return reply.code(409).send({ message: 'release_unknown' })

      return { message: 'Release blocked' }
    },
  )

  app.delete(
    '/follow/blocklist/:id',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'deleteFollowBlocklist',
        tags: ['Follow'],
        params: blocklistParams,
        response: { 200: messageResponse, ...ownerErrors },
      },
    },
    async (request, reply) => {
      if (!unblockRelease(request.params.id))
        return reply.code(404).send({ message: 'Entry not found' })

      return { message: 'Entry removed' }
    },
  )
}
