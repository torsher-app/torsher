import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import {
  addLibraryFolder,
  browseQuery,
  createLibrary,
  fileParams,
  folderBrowse,
  folderParams,
  folderPathErrorResponse,
  groupPreviewQuery,
  groupPreview as groupPreviewResponse,
  library,
  libraryFileList,
  libraryFilesQuery,
  libraryList,
  libraryParams,
  setGroupTitle,
  unmatchedGroupList,
  updateLibrary,
  updateLibraryFile,
} from '../dto/libraries.ts'
import { getDb } from '../db/index.ts'
import { mediaFiles } from '../db/schema.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  addFolder,
  browseFolders,
  createLibrary as create,
  FolderPathError,
  libraryFiles,
  LibraryNotFoundError,
  listLibraries,
  removeFolder,
  removeLibrary,
  rescanFolder,
  updateLibrary as update,
} from '../services/library/folders.ts'
import { setCapturedAt } from '../services/library/homeVideo.ts'
import {
  groupPreview,
  setGroupTitle as setTitle,
  unmatchedGroups,
} from '../services/library/match.ts'

function toLibrary(item: ReturnType<typeof listLibraries>[number]) {
  return {
    ...item,
    folders: item.folders.map(folder => ({
      id: folder.id,
      path: folder.path,
      hint: folder.hint,
      status: folder.status,
      watcher: folder.watcher,
      error: folder.error,
      scannedAt: folder.scannedAt?.toISOString() ?? null,
      files: folder.files,
      size: folder.size,
      missing: folder.missing,
      unsure: folder.unsure,
      unmatched: folder.unmatched,
      pending: folder.pending,
    })),
  }
}

function libraryById(id: string) {
  const found = listLibraries().find(item => item.id === id)

  if (!found)
    throw new LibraryNotFoundError()

  return toLibrary(found)
}

function sendLibraryError(reply: FastifyReply, err: unknown) {
  if (err instanceof FolderPathError)
    return reply.code(422).send({ message: err.message, kind: err.kind })

  if (err instanceof LibraryNotFoundError)
    return reply.code(404).send({ message: err.message })

  throw err
}

const guard = { 401: messageResponse }

/** Библиотеки и подключённые папки — настройка сервера: только сессия владельца */
export const librariesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '',
    {
      schema: {
        operationId: 'getLibraries',
        tags: ['Libraries'],
        response: { 200: libraryList, ...guard },
      },
    },
    async () => ({ items: listLibraries().map(toLibrary) }),
  )

  app.post(
    '',
    {
      schema: {
        operationId: 'postLibrary',
        tags: ['Libraries'],
        body: createLibrary,
        response: {
          200: library,
          422: folderPathErrorResponse,
          ...guard,
        },
      },
    },
    async (request, reply) => {
      try {
        return libraryById((await create(request.body)).id)
      }
      catch (err) {
        return sendLibraryError(reply, err)
      }
    },
  )

  app.patch(
    '/:id',
    {
      schema: {
        operationId: 'patchLibrary',
        tags: ['Libraries'],
        params: libraryParams,
        body: updateLibrary,
        response: { 200: library, 404: messageResponse, ...guard },
      },
    },
    async (request, reply) => {
      try {
        update(request.params.id, request.body)

        return libraryById(request.params.id)
      }
      catch (err) {
        return sendLibraryError(reply, err)
      }
    },
  )

  // Библиотека уходит из Torsher; файлы на диске не трогаются
  app.delete(
    '/:id',
    {
      schema: {
        operationId: 'deleteLibrary',
        tags: ['Libraries'],
        params: libraryParams,
        response: { 204: z.null(), 404: messageResponse, ...guard },
      },
    },
    async (request, reply) => {
      try {
        removeLibrary(request.params.id)

        return reply.code(204).send(null)
      }
      catch (err) {
        return sendLibraryError(reply, err)
      }
    },
  )

  app.post(
    '/:id/folders',
    {
      schema: {
        operationId: 'postLibraryFolder',
        tags: ['Libraries'],
        params: libraryParams,
        body: addLibraryFolder,
        response: {
          200: library,
          404: messageResponse,
          422: folderPathErrorResponse,
          ...guard,
        },
      },
    },
    async (request, reply) => {
      try {
        await addFolder(request.params.id, request.body)

        return libraryById(request.params.id)
      }
      catch (err) {
        return sendLibraryError(reply, err)
      }
    },
  )

  // «Отключить папку»: индекс её файлов удаляется, сами файлы остаются
  app.delete(
    '/folders/:folderId',
    {
      schema: {
        operationId: 'deleteLibraryFolder',
        tags: ['Libraries'],
        params: folderParams,
        response: { 204: z.null(), 404: messageResponse, ...guard },
      },
    },
    async (request, reply) => {
      try {
        removeFolder(request.params.folderId)

        return reply.code(204).send(null)
      }
      catch (err) {
        return sendLibraryError(reply, err)
      }
    },
  )

  app.post(
    '/folders/:folderId/scan',
    {
      schema: {
        operationId: 'postLibraryFolderScan',
        tags: ['Libraries'],
        params: folderParams,
        response: { 204: z.null(), 404: messageResponse, ...guard },
      },
    },
    async (request, reply) => {
      try {
        rescanFolder(request.params.folderId)

        return reply.code(204).send(null)
      }
      catch (err) {
        return sendLibraryError(reply, err)
      }
    },
  )

  // Обзор ФС сервера для выбора папки: только каталоги
  app.get(
    '/browse',
    {
      schema: {
        operationId: 'getLibraryBrowse',
        tags: ['Libraries'],
        querystring: browseQuery,
        response: { 200: folderBrowse, 422: messageResponse, ...guard },
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

  app.get(
    '/unmatched',
    {
      schema: {
        operationId: 'getLibraryUnmatched',
        tags: ['Libraries'],
        response: { 200: unmatchedGroupList, ...guard },
      },
    },
    async () => ({ items: unmatchedGroups() }),
  )

  // «Исправить совпадение» для папки-релиза
  app.put(
    '/groups/title',
    {
      schema: {
        operationId: 'putLibraryGroupTitle',
        tags: ['Libraries'],
        body: setGroupTitle,
        response: { 204: z.null(), 404: messageResponse, ...guard },
      },
    },
    async (request, reply) => {
      const { folderId, group, titleId, episodes } = request.body
      const overrides
        = episodes
          && new Map(
            episodes.map(item => [
              item.id,
              item.episode === null
                ? null
                : {
                    season: item.season,
                    episode: item.episode,
                    episodeTo: item.episodeTo ?? null,
                  },
            ]),
          )

      if (!setTitle(folderId, group, titleId, overrides))
        return reply.code(404).send({ message: 'Release not found' })

      return reply.code(204).send(null)
    },
  )

  // Как файлы релиза лягут под выбранный сериал: правка номеров перед сохранением
  app.get(
    '/groups/preview',
    {
      schema: {
        operationId: 'getLibraryGroupPreview',
        tags: ['Libraries'],
        querystring: groupPreviewQuery,
        response: { 200: groupPreviewResponse, ...guard },
      },
    },
    async (request) => {
      const { folderId, group, titleId } = request.query

      return { items: groupPreview(folderId, group, titleId) }
    },
  )

  // Файлы библиотеки для панели: домашнее видео с датой, видео с совпадением
  app.get(
    '/:id/files',
    {
      schema: {
        operationId: 'getLibraryFiles',
        tags: ['Libraries'],
        params: libraryParams,
        querystring: libraryFilesQuery,
        response: { 200: libraryFileList, 404: messageResponse, ...guard },
      },
    },
    async (request, reply) => {
      try {
        const page = libraryFiles(request.params.id, request.query)

        return {
          total: page.total,
          items: page.items.map(file => ({
            id: file.id,
            folderId: file.folderId,
            relPath: file.relPath,
            size: file.size,
            duration: file.duration,
            state: file.state,
            titleId: file.titleId,
            matchStatus: file.matchStatus,
            capturedAt: file.capturedAt?.toISOString() ?? null,
            capturedAtSource: file.capturedAtSource,
          })),
        }
      }
      catch (err) {
        return sendLibraryError(reply, err)
      }
    },
  )

  // Дата съёмки домашнего видео, исправленная владельцем
  app.patch(
    '/files/:fileId',
    {
      schema: {
        operationId: 'patchLibraryFile',
        tags: ['Libraries'],
        params: fileParams,
        body: updateLibraryFile,
        response: { 204: z.null(), 404: messageResponse, ...guard },
      },
    },
    async (request, reply) => {
      const file = getDb()
        .select()
        .from(mediaFiles)
        .where(eq(mediaFiles.id, request.params.fileId))
        .get()

      if (!file)
        return reply.code(404).send({ message: 'File not found' })

      const { capturedAt } = request.body

      setCapturedAt(file, capturedAt ? new Date(capturedAt) : null)

      return reply.code(204).send(null)
    },
  )
}
