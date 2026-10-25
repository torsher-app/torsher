import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { CursorChoice, FollowRules } from '../services/follow/index.ts'
import { messageResponse } from '../dto/common.ts'
import {
  followDetails,
  followLanguageQuery,
  followListResponse,
  followParams,
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
import { profileSchedule } from '../services/follow/calendar.ts'
import {
  deleteFollow,
  followTitle,
  unfollowTitle,
  updateFollow,
} from '../services/follow/index.ts'
import {
  followDetailsOf,
  followSummaries,
  titleFollowView,
} from '../services/follow/views.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'
import { sendTmdbError } from './catalog.ts'

const titleNotFound = { message: 'Title not found' }
const followNotFound = { message: 'Follow not found' }

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
}
