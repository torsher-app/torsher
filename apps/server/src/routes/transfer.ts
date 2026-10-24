import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { Buffer } from 'node:buffer'
import { gunzipSync } from 'node:zlib'
import { backupErrorResponse } from '../dto/backups.ts'
import { messageResponse } from '../dto/common.ts'
import {
  applyServerImportBody,
  createExport,
  exportFile,
  previewServerImportBody,
  serverImportPreview,
  serverImportResult,
  transferErrorResponse,
} from '../dto/transfer.ts'
import { requireOwner } from '../middleware/auth.ts'
import { BackupError } from '../services/backups/index.ts'
import {
  DocumentError,
  parseExportDocument,
} from '../services/transfer/document.ts'
import {
  buildExport,
  exportFileName,
  ExportProfileNotFoundError,
} from '../services/transfer/export.ts'
import {
  applyServerImport,
  previewServerImport,
  ServerImportNotFoundError,
} from '../services/transfer/serverImport.ts'

// Экспорт сервера за годы просмотров — несколько мегабайт; base64 — на треть больше
const MAX_EXPORT_BYTES = 50 * 1024 * 1024
const BODY_LIMIT = Math.ceil(MAX_EXPORT_BYTES / 3) * 4 + 64 * 1024

const guardResponses = {
  401: messageResponse,
}

function textOf(data: string) {
  const raw = Buffer.from(data, 'base64')

  if (raw.length > MAX_EXPORT_BYTES)
    throw new DocumentError('broken')

  return (raw[0] === 0x1F && raw[1] === 0x8B ? gunzipSync(raw) : raw).toString(
    'utf8',
  )
}

/** Перенос данных между серверами: экспорт и импорт файла `torsher-export` */
export const transferRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.post(
    '/export',
    {
      schema: {
        operationId: 'postTransferExport',
        tags: ['Transfer'],
        body: createExport,
        response: {
          200: exportFile,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const document = buildExport(request.body)

        return reply
          .header(
            'content-disposition',
            `attachment; filename="${exportFileName()}"`,
          )
          .send(document)
      }
      catch (err) {
        if (err instanceof ExportProfileNotFoundError)
          return reply.code(404).send({ message: 'Profile not found' })

        throw err
      }
    },
  )

  app.post(
    '/import/preview',
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        operationId: 'postTransferImportPreview',
        tags: ['Transfer'],
        body: previewServerImportBody,
        response: {
          200: serverImportPreview,
          400: transferErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const document = parseExportDocument(textOf(request.body.data))

        return await previewServerImport(document, request.body.password)
      }
      catch (err) {
        if (err instanceof DocumentError)
          return reply.code(400).send({ message: err.message, kind: err.kind })

        // Не gzip, хотя начинается как gzip
        if (
          err instanceof Error
          && 'code' in err
          && err.code === 'Z_DATA_ERROR'
        ) {
          return reply.code(400).send({ message: err.message, kind: 'broken' })
        }

        throw err
      }
    },
  )

  app.post(
    '/import/apply',
    {
      schema: {
        operationId: 'postTransferImportApply',
        tags: ['Transfer'],
        body: applyServerImportBody,
        response: {
          200: serverImportResult,
          404: messageResponse,
          422: backupErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await applyServerImport(request.body.token, request.body)
      }
      catch (err) {
        if (err instanceof ServerImportNotFoundError)
          return reply.code(404).send({ message: 'Import preview expired' })

        // Без копии `pre-import` импорт не начинается: отменить его было бы нечем
        if (err instanceof BackupError) {
          return reply
            .code(422)
            .send({ message: err.message, kind: err.kind, params: err.params })
        }

        throw err
      }
    },
  )
}
