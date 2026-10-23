import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { StorageOverview } from '../services/storage/index.ts'
import { messageResponse } from '../dto/common.ts'
import { storageOverview, updateStoragePolicy } from '../dto/storage.ts'
import { engineUnavailableResponse } from '../dto/torrents.ts'
import { requireOwner } from '../middleware/auth.ts'
import { currentLinkMode } from '../services/library/index.ts'
import { getStorageOverview, updatePolicy } from '../services/storage/index.ts'
import { sendEngineError } from './engineResponses.ts'

function toOverviewResponse(overview: StorageOverview) {
  return {
    path: overview.path,
    total: overview.total,
    free: overview.free,
    cacheUsed: overview.cacheUsed,
    keptUsed: overview.keptUsed,
    library: { ...overview.library, linkMode: currentLinkMode() ?? null },
    other: overview.other,
    policy: overview.policy,
    queue: overview.queue.map(({ torrent, size }) => ({
      torrentId: torrent.id,
      name: torrent.name,
      sizeOnDisk: size,
      lastAccessAt: torrent.lastAccessAt?.toISOString() ?? null,
    })),
  }
}

const responses = {
  200: storageOverview,
  401: messageResponse,
  502: messageResponse,
  503: engineUnavailableResponse,
  504: messageResponse,
}

/** Хранилище — настройка сервера: только сессия аккаунта */
export const storageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '',
    {
      schema: {
        operationId: 'getStorage',
        tags: ['Storage'],
        response: responses,
      },
    },
    async (_request, reply) => {
      try {
        return toOverviewResponse(await getStorageOverview())
      }
      catch (err) {
        return sendEngineError(reply, err)
      }
    },
  )

  app.put(
    '/policy',
    {
      schema: {
        operationId: 'putStoragePolicy',
        tags: ['Storage'],
        body: updateStoragePolicy,
        response: { ...responses, 400: messageResponse },
      },
    },
    async (request, reply) => {
      try {
        return toOverviewResponse(await updatePolicy(request.body))
      }
      catch (err) {
        return sendEngineError(reply, err)
      }
    },
  )
}
