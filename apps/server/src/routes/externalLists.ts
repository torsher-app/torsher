import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import {
  externalList,
  externalListExclusion,
  externalListExclusions,
  externalListExclusionsQuery,
  externalListParams,
  externalListPreviewInput,
  externalListPreviewJob,
  externalListPreviewToken,
  externalListsErrorResponse,
  externalListSettings,
  updateExternalList,
  updateExternalListKey,
} from '../dto/externalLists.ts'
import { requireOwner } from '../middleware/auth.ts'
import { ExternalListsError } from '../services/externalLists/errors.ts'
import {
  confirmPreview,
  deleteList,
  getPreview,
  listExclusions,
  listSettings,
  requestRun,
  saveKey,
  setPaused,
  startPreview,
  unsetExclusion,
} from '../services/externalLists/index.ts'

export const externalListRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)
  app.setErrorHandler((error, _request, reply) => {
    if (!(error instanceof ExternalListsError))
      throw error
    return reply.code(error.statusCode).send({ message: error.code })
  })

  const tags = ['ExternalLists']
  const authorization = { 401: messageResponse, 403: messageResponse }
  const errors = {
    ...authorization,
    400: messageResponse,
    404: externalListsErrorResponse,
    409: externalListsErrorResponse,
    422: externalListsErrorResponse,
    429: externalListsErrorResponse,
    502: externalListsErrorResponse,
  }

  app.get(
    '/',
    {
      schema: {
        operationId: 'getExternalLists',
        tags,
        response: { 200: externalListSettings, ...authorization },
      },
    },
    async () => listSettings(),
  )

  app.put(
    '/key',
    {
      bodyLimit: 4_096,
      schema: {
        operationId: 'putExternalListKey',
        tags,
        body: updateExternalListKey,
        response: { 200: externalListSettings, ...errors },
      },
    },
    async request => saveKey(request.body.apiKey),
  )

  app.post(
    '/preview',
    {
      bodyLimit: 4_096,
      schema: {
        operationId: 'startExternalListPreview',
        tags,
        body: externalListPreviewInput,
        response: { 202: externalListPreviewJob, ...errors },
      },
    },
    async (request, reply) =>
      reply.code(202).send(startPreview(request.userId, request.body)),
  )

  app.get(
    '/preview/:token',
    {
      schema: {
        operationId: 'getExternalListPreview',
        tags,
        params: z.object({ token: z.string().min(1).max(128) }),
        response: { 200: externalListPreviewJob, ...errors },
      },
    },
    async request => getPreview(request.userId, request.params.token),
  )

  app.post(
    '/confirm',
    {
      schema: {
        operationId: 'confirmExternalList',
        tags,
        body: externalListPreviewToken,
        response: { 200: externalList, ...errors },
      },
    },
    async request => confirmPreview(request.userId, request.body.token),
  )

  app.patch(
    '/:listId',
    {
      schema: {
        operationId: 'patchExternalList',
        tags,
        params: externalListParams,
        body: updateExternalList,
        response: { 200: externalList, ...errors },
      },
    },
    async request => setPaused(request.params.listId, request.body.paused),
  )

  app.delete(
    '/:listId',
    {
      schema: {
        operationId: 'deleteExternalList',
        tags,
        params: externalListParams,
        response: { 204: z.undefined(), ...errors },
      },
    },
    async (request, reply) => {
      deleteList(request.params.listId)
      return reply.code(204).send()
    },
  )

  app.post(
    '/:listId/run',
    {
      schema: {
        operationId: 'runExternalList',
        tags,
        params: externalListParams,
        response: { 202: externalList, ...errors },
      },
    },
    async (request, reply) =>
      reply.code(202).send(requestRun(request.params.listId)),
  )

  app.get(
    '/exclusions',
    {
      schema: {
        operationId: 'getExternalListExclusions',
        tags,
        querystring: externalListExclusionsQuery,
        response: { 200: externalListExclusions, ...errors },
      },
    },
    async request =>
      listExclusions(
        request.query.profileId,
        Number(request.query.offset ?? 0),
      ),
  )

  app.delete(
    '/exclusions',
    {
      schema: {
        operationId: 'deleteExternalListExclusion',
        tags,
        body: externalListExclusion,
        response: { 204: z.undefined(), ...errors },
      },
    },
    async (request, reply) => {
      unsetExclusion(request.body.profileId, request.body.titleId)
      return reply.code(204).send()
    },
  )
}
