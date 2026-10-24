import { Buffer } from 'node:buffer'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import {
  appliedImport,
  applyProfileImport,
  createProfileImport,
  importFormatErrorResponse,
  importJob,
  importOverview,
  matchImportRow,
  profileImportParams,
  profileImportRowParams,
  undoneImport,
  unmatchedImportQuery,
  unmatchedImportRows,
} from '../dto/imports.ts'
import { profileIdParams } from '../dto/profiles.ts'
import { requireOwner } from '../middleware/auth.ts'
import { cardOf, summariesOf } from '../services/mine/cards.ts'
import { getProfile } from '../services/profiles/index.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'
import {
  ImportFormatError,
  MAX_IMPORT_BYTES,
} from '../services/transfer/formats.ts'
import {
  applyImport,
  cancelImport,
  dismissUnmatchedRow,
  getImportJob,
  ImportNotFoundError,
  ImportStateError,
  matchUnmatchedRow,
  importOverview as overviewOf,
  startImport,
  undoImport,
  unmatchedRows,
} from '../services/transfer/imports.ts'

const guardResponses = {
  401: messageResponse,
}

const profileNotFound = { message: 'Profile not found' }
const importNotFound = { message: 'Import not found' }

// Файлы приходят base64 в JSON: на треть больше самих файлов
const BODY_LIMIT = Math.ceil(MAX_IMPORT_BYTES / 3) * 4 + 256 * 1024

/**
 * Импорт своих оценок и «Позже» из файлов других сервисов в профиль.
 * Только владелец: файлы загружаются в панели.
 */
export const profileImportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '/:id/imports',
    {
      schema: {
        operationId: 'getProfileImports',
        tags: ['Profiles'],
        params: profileIdParams,
        response: {
          200: importOverview,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!getProfile(request.params.id))
        return reply.code(404).send(profileNotFound)

      const overview = overviewOf(request.params.id)

      return {
        ...overview,
        last: overview.last && {
          ...overview.last,
          appliedAt: overview.last.appliedAt.toISOString(),
        },
      }
    },
  )

  app.post(
    '/:id/imports',
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        operationId: 'postProfileImport',
        tags: ['Profiles'],
        params: profileIdParams,
        body: createProfileImport,
        response: {
          202: importJob,
          400: importFormatErrorResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!getProfile(request.params.id))
        return reply.code(404).send(profileNotFound)

      const files = request.body.files.map(file => ({
        name: file.name,
        data: Buffer.from(file.data, 'base64'),
      }))

      try {
        const job = startImport(request.params.id, files)

        return reply.code(202).send(getImportJob(request.params.id, job.id))
      }
      catch (err) {
        if (err instanceof ImportFormatError) {
          return reply
            .code(400)
            .send({ message: err.message, kind: err.kind, file: err.file })
        }

        throw err
      }
    },
  )

  app.get(
    '/:id/imports/unmatched',
    {
      schema: {
        operationId: 'getProfileImportUnmatched',
        tags: ['Profiles'],
        params: profileIdParams,
        querystring: unmatchedImportQuery,
        response: {
          200: unmatchedImportRows,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!getProfile(request.params.id))
        return reply.code(404).send(profileNotFound)

      const { offset, limit, language } = request.query
      const { items, total } = unmatchedRows(request.params.id, offset, limit)
      const ids = items.flatMap(row =>
        row.suggestion ? [row.suggestion] : [],
      )
      const summaries = await summariesOf(ids, language)
      const cards = new Map(
        summaries.flatMap(summary =>
          summary
            ? [[summary.details.id, cardOf(summary.details)] as const]
            : [],
        ),
      )

      return {
        items: items.map(row => ({
          id: row.id,
          list: row.list,
          status: row.status,
          title: row.title,
          year: row.year,
          kind: row.kind,
          rating: row.rating,
          suggestion: (row.suggestion && cards.get(row.suggestion)) || null,
        })),
        total,
      }
    },
  )

  app.post(
    '/:id/imports/unmatched/:rowId',
    {
      schema: {
        operationId: 'postProfileImportMatch',
        tags: ['Profiles'],
        params: profileImportRowParams,
        body: matchImportRow,
        response: {
          204: z.null(),
          400: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.body.titleId))
        return reply.code(400).send({ message: 'Unknown title id' })

      try {
        matchUnmatchedRow(
          request.params.id,
          request.params.rowId,
          request.body.titleId,
        )
      }
      catch (err) {
        if (err instanceof ImportNotFoundError)
          return reply.code(404).send(importNotFound)

        throw err
      }

      return reply.code(204).send(null)
    },
  )

  app.delete(
    '/:id/imports/unmatched/:rowId',
    {
      schema: {
        operationId: 'deleteProfileImportUnmatched',
        tags: ['Profiles'],
        params: profileImportRowParams,
        response: {
          204: z.null(),
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        dismissUnmatchedRow(request.params.id, request.params.rowId)
      }
      catch (err) {
        if (err instanceof ImportNotFoundError)
          return reply.code(404).send(importNotFound)

        throw err
      }

      return reply.code(204).send(null)
    },
  )

  app.get(
    '/:id/imports/:importId',
    {
      schema: {
        operationId: 'getProfileImport',
        tags: ['Profiles'],
        params: profileImportParams,
        response: { 200: importJob, 404: messageResponse, ...guardResponses },
      },
    },
    async (request, reply) => {
      try {
        return getImportJob(request.params.id, request.params.importId)
      }
      catch (err) {
        if (err instanceof ImportNotFoundError)
          return reply.code(404).send(importNotFound)

        throw err
      }
    },
  )

  app.delete(
    '/:id/imports/:importId',
    {
      schema: {
        operationId: 'deleteProfileImport',
        tags: ['Profiles'],
        params: profileImportParams,
        response: {
          204: z.null(),
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        cancelImport(request.params.id, request.params.importId)
      }
      catch (err) {
        if (err instanceof ImportNotFoundError)
          return reply.code(404).send(importNotFound)

        throw err
      }

      return reply.code(204).send(null)
    },
  )

  app.post(
    '/:id/imports/:importId/apply',
    {
      schema: {
        operationId: 'postProfileImportApply',
        tags: ['Profiles'],
        params: profileImportParams,
        body: applyProfileImport,
        response: {
          200: appliedImport,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return applyImport(
          request.params.id,
          request.params.importId,
          request.body.conflicts,
        )
      }
      catch (err) {
        if (err instanceof ImportNotFoundError)
          return reply.code(404).send(importNotFound)

        if (err instanceof ImportStateError)
          return reply.code(409).send({ message: 'Import is not ready' })

        throw err
      }
    },
  )

  app.post(
    '/:id/imports/:importId/undo',
    {
      schema: {
        operationId: 'postProfileImportUndo',
        tags: ['Profiles'],
        params: profileImportParams,
        response: {
          200: undoneImport,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return undoImport(request.params.id, request.params.importId)
      }
      catch (err) {
        if (err instanceof ImportNotFoundError)
          return reply.code(404).send(importNotFound)

        if (err instanceof ImportStateError) {
          return reply
            .code(409)
            .send({ message: 'Import can no longer be undone' })
        }

        throw err
      }
    },
  )
}
