import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import {
  subtitleProvider,
  subtitleProviderStatus,
  subtitleSettings,
  updateSubtitleSettings,
} from '../dto/subtitles.ts'
import { requireOwner } from '../middleware/auth.ts'
import { testSubtitleConnection } from '../services/subtitles/providers.ts'
import {
  subtitleSettingsView,
  updateSubtitleConfig,
} from '../services/subtitles/settings.ts'

export const subtitleSettingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)
  const errors = { 401: messageResponse, 403: messageResponse }
  app.get(
    '/subtitles',
    {
      schema: {
        operationId: 'getSubtitleSettings',
        tags: ['Settings'],
        response: { 200: subtitleSettings, ...errors },
      },
    },
    async () => subtitleSettingsView(),
  )
  app.put(
    '/subtitles',
    {
      schema: {
        operationId: 'putSubtitleSettings',
        tags: ['Settings'],
        body: updateSubtitleSettings,
        response: { 200: subtitleSettings, ...errors },
      },
    },
    async request => updateSubtitleConfig(request.body),
  )
  app.post(
    '/subtitles/:provider/test',
    {
      schema: {
        operationId: 'testSubtitleProvider',
        tags: ['Settings'],
        params: z.object({ provider: subtitleProvider }),
        response: { 200: subtitleProviderStatus, ...errors },
      },
    },
    async request => testSubtitleConnection(request.params.provider),
  )
}
