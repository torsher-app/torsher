import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import {
  titleCleanupConfirmation,
  titleCleanupPreview,
  titleCleanupResult,
  titleCleanupSelection,
  titleCleanupTitles,
} from '../dto/titleCleanup.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  cleanupTitles,
  executeTitleCleanup,
  previewTitleCleanup,
} from '../services/titleCleanup/index.ts'

const errors = {
  400: messageResponse,
  401: messageResponse,
  403: messageResponse,
}
const tags = ['Torrents']

export const titleCleanupRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)
  app.get(
    '/titles',
    {
      schema: {
        operationId: 'getTitleCleanupTitles',
        tags,
        response: { 200: titleCleanupTitles, ...errors },
      },
    },
    () => cleanupTitles(),
  )
  app.post(
    '/preview',
    {
      schema: {
        operationId: 'postTitleCleanupPreview',
        tags,
        body: titleCleanupSelection,
        response: { 200: titleCleanupPreview, ...errors },
      },
    },
    request => previewTitleCleanup(request.body.titleIds),
  )
  app.post(
    '/execute',
    {
      schema: {
        operationId: 'postTitleCleanupExecute',
        tags,
        body: titleCleanupConfirmation,
        response: { 200: titleCleanupResult, ...errors },
      },
    },
    request => executeTitleCleanup(request.body.items),
  )
}
