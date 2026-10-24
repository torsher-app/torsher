import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { StorageOverview } from '../services/storage/index.ts'
import type { StorageMoveState } from '../services/storage/move.ts'
import { messageResponse } from '../dto/common.ts'
import { browseQuery, folderBrowse } from '../dto/libraries.ts'
import {
  startStorageMove,
  storageOverview,
  storagePathCheck,
  storagePathCheckBody,
  storagePathErrorResponse,
  updateStoragePath,
  updateStoragePolicy,
} from '../dto/storage.ts'
import { engineUnavailableResponse } from '../dto/torrents.ts'
import { requireOwner } from '../middleware/auth.ts'
import { browseFolders } from '../services/library/folders.ts'
import { currentLinkMode } from '../services/library/index.ts'
import {
  checkStoragePath,
  pathProblem,
  StoragePathError,
} from '../services/storage/folders.ts'
import { getStorageOverview, updatePolicy } from '../services/storage/index.ts'
import {
  cancelMove,
  changeStoragePath,
  moveBytesNeeded,
  startMove,
  StorageMoveError,
  storageMoveState,
} from '../services/storage/move.ts'
import { sendEngineError } from './engineResponses.ts'

function toMoveResponse(move: StorageMoveState | null) {
  return (
    move && {
      id: move.id,
      kind: move.kind,
      target: move.target,
      status: move.status,
      bytesTotal: move.bytesTotal,
      bytesDone: Math.min(move.bytesDone, move.bytesTotal),
      itemsTotal: move.itemsTotal,
      itemsDone: move.itemsDone,
      currentName: move.currentName,
      waiting: move.waiting,
      error:
        (move.error as 'no_space' | 'denied' | 'engine' | 'failed') ?? null,
      startedAt: move.startedAt.toISOString(),
      finishedAt: move.finishedAt?.toISOString() ?? null,
    }
  )
}

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
    folders: overview.folders,
    move: toMoveResponse(storageMoveState()),
  }
}

const responses = {
  200: storageOverview,
  401: messageResponse,
  502: messageResponse,
  503: engineUnavailableResponse,
  504: messageResponse,
}

const pathResponses = {
  ...responses,
  409: storagePathErrorResponse,
  422: storagePathErrorResponse,
}

function sendPathError(reply: FastifyReply, err: unknown) {
  if (err instanceof StoragePathError)
    return reply.code(422).send({ message: err.message, kind: err.kind })

  if (err instanceof StorageMoveError) {
    return reply
      .code(err.kind === 'busy' ? 409 : 422)
      .send({ message: err.message, kind: err.kind })
  }

  const code = (err as NodeJS.ErrnoException).code

  // Папку не создать: нет прав или том только на чтение
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return reply
      .code(422)
      .send({ message: 'Folder is not writable', kind: 'denied' })
  }

  if (code === 'ENOTDIR' || code === 'EEXIST') {
    return reply
      .code(422)
      .send({ message: 'Not a folder', kind: 'not_directory' })
  }

  return sendEngineError(reply, err)
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

  // Обзор ФС сервера для выбора папки: только каталоги. Общий у папок
  // хранения и подключённых папок библиотеки
  app.get(
    '/browse',
    {
      schema: {
        operationId: 'getStorageBrowse',
        tags: ['Storage'],
        querystring: browseQuery,
        response: {
          200: folderBrowse,
          401: messageResponse,
          422: messageResponse,
        },
      },
    },
    async (request, reply) => {
      try {
        return await browseFolders(request.query.path)
      }
      catch (err) {
        return reply.code(422).send({ message: (err as Error).message })
      }
    },
  )

  // Проверка папки при выборе: запись, место, хардлинки со второй папкой
  app.post(
    '/check',
    {
      schema: {
        operationId: 'postStorageCheck',
        tags: ['Storage'],
        body: storagePathCheckBody,
        response: { 200: storagePathCheck, 401: messageResponse },
      },
    },
    async (request) => {
      const { kind, path } = request.body
      const check = await checkStoragePath(kind, path)
      const moveBytes
        = check.problem || check.sameVolume
          ? 0
          : await moveBytesNeeded(kind, check.path).catch(() => 0)

      return { ...check, moveBytes }
    },
  )

  app.put(
    '/paths',
    {
      schema: {
        operationId: 'putStoragePath',
        tags: ['Storage'],
        body: updateStoragePath,
        response: pathResponses,
      },
    },
    async (request, reply) => {
      const { kind, path, mode } = request.body

      try {
        if (path) {
          const problem = pathProblem(kind, path)

          if (problem)
            throw new StoragePathError(problem)

          const check = await checkStoragePath(kind, path)

          if (check.problem)
            throw new StoragePathError(check.problem)
        }

        await changeStoragePath(kind, path, mode)

        return toOverviewResponse(await getStorageOverview())
      }
      catch (err) {
        return sendPathError(reply, err)
      }
    },
  )

  // «Перенести сюда»: то, что осталось в прежних папках, — в действующую
  app.post(
    '/move',
    {
      schema: {
        operationId: 'postStorageMove',
        tags: ['Storage'],
        body: startStorageMove,
        response: pathResponses,
      },
    },
    async (request, reply) => {
      try {
        await startMove(request.body.kind)

        return toOverviewResponse(await getStorageOverview())
      }
      catch (err) {
        return sendPathError(reply, err)
      }
    },
  )

  app.post(
    '/move/cancel',
    {
      schema: {
        operationId: 'postStorageMoveCancel',
        tags: ['Storage'],
        response: responses,
      },
    },
    async (_request, reply) => {
      cancelMove()

      try {
        return toOverviewResponse(await getStorageOverview())
      }
      catch (err) {
        return sendEngineError(reply, err)
      }
    },
  )
}
