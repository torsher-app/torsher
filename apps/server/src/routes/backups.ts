import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { z } from 'zod'
import {
  backupDirCheck,
  backupDirCheckBody,
  backupErrorResponse,
  backupItem,
  backupNameParams,
  backupStatus,
  backupUploadQuery,
  restoreBackupBody,
  restoreResponse,
  restoreStateResponse,
  updateBackupEncryption,
  updateBackupSettings,
} from '../dto/backups.ts'
import { messageResponse } from '../dto/common.ts'
import {
  firstRunExpired,
  requireOwner,
  requireOwnerOrFirstRun,
} from '../middleware/auth.ts'
import {
  BackupError,
  backupPath,
  checkBackupDir,
  clearBackupPassword,
  restoreStatus as currentRestore,
  deleteBackup,
  dismissRestoreResult,
  firstRunUploadPath,
  getBackupStatus,
  inspectBackupDir,
  requestRestore,
  saveBackupSettings,
  setBackupPassword,
  startManualBackup,
  uploadBackup,
  uploadLimits,
} from '../services/backups/index.ts'

const NOT_FOUND = { message: 'Backup not found' }
const UNAUTHORIZED = { message: 'Unauthorized' }

function sendBackupError(reply: FastifyReply, err: unknown) {
  if (!(err instanceof BackupError))
    throw err

  if (err.kind === 'not_found')
    return reply.code(404).send(NOT_FOUND)

  if (err.kind === 'too_large') {
    return reply
      .code(413)
      .send({ message: err.message, kind: err.kind, params: err.params })
  }

  return reply
    .code(422)
    .send({ message: err.message, kind: err.kind, params: err.params })
}

const nameRoute = {
  params: backupNameParams,
}

/** Резервные копии — настройка сервера; загрузка и восстановление — ещё и на пустом сервере */
export const backupRoutes: FastifyPluginAsyncZod = async (app) => {
  // Тело загрузки — поток в файл, а не буфер в памяти. Парсер — только в
  // этом плагине: остальной API octet-stream не принимает
  app.addContentTypeParser(
    'application/octet-stream',
    (_request, payload, done) => done(null, payload),
  )

  app.get(
    '',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getBackups',
        tags: ['Backups'],
        response: { 200: backupStatus, 401: messageResponse },
      },
    },
    () => getBackupStatus(),
  )

  app.put(
    '/settings',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'putBackupSettings',
        tags: ['Backups'],
        body: updateBackupSettings,
        response: {
          200: backupStatus,
          401: messageResponse,
          422: backupErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { dir, ...schedule } = request.body

      if (dir) {
        const problem = await checkBackupDir(dir)

        if (problem) {
          return reply.code(422).send({
            message: `Backup folder rejected: ${problem}`,
            kind: problem,
            field: 'dir',
          })
        }
      }

      saveBackupSettings({ ...schedule, dir })

      return getBackupStatus()
    },
  )

  app.put(
    '/encryption',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'putBackupEncryption',
        tags: ['Backups'],
        body: updateBackupEncryption,
        response: { 200: backupStatus, 401: messageResponse },
      },
    },
    async (request) => {
      if (request.body.mode === 'password')
        await setBackupPassword(request.body.password)
      else clearBackupPassword()

      return getBackupStatus()
    },
  )

  // Проверка каталога в диалоге выбора: на каждом шаге обзора
  app.post(
    '/check',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'postBackupDirCheck',
        tags: ['Backups'],
        body: backupDirCheckBody,
        response: { 200: backupDirCheck, 401: messageResponse },
      },
    },
    request => inspectBackupDir(request.body.path),
  )

  // Ручная копия идёт в фоне: панель опрашивает `GET /backups`, пока `running`
  app.post(
    '',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'postBackup',
        tags: ['Backups'],
        response: { 202: backupStatus, 401: messageResponse },
      },
    },
    async (_request, reply) => {
      startManualBackup()

      return reply.code(202).send(await getBackupStatus())
    },
  )

  app.get(
    '/restore',
    {
      onRequest: requireOwnerOrFirstRun,
      schema: {
        operationId: 'getBackupRestore',
        tags: ['Backups'],
        response: {
          200: restoreStateResponse,
          401: messageResponse,
        },
      },
    },
    async (request, reply) => {
      if (firstRunExpired(request))
        return reply.code(401).send(UNAUTHORIZED)

      return { restore: currentRestore() }
    },
  )

  app.delete(
    '/restore',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'deleteBackupRestore',
        tags: ['Backups'],
        response: { 204: z.null(), 401: messageResponse },
      },
    },
    async (_request, reply) => {
      dismissRestoreResult()

      return reply.code(204).send(null)
    },
  )

  app.post(
    '/upload',
    {
      onRequest: requireOwnerOrFirstRun,
      schema: {
        hide: true,
        querystring: backupUploadQuery,
        response: {
          201: backupItem,
          400: messageResponse,
          401: messageResponse,
          413: backupErrorResponse,
          422: backupErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const declared = Number(request.headers['content-length'])

      // Заведомо большой файл не читаем вовсе
      if (declared > uploadLimits.maxBytes) {
        return reply.code(413).send({
          message: 'Backup is too large',
          kind: 'too_large',
          params: { limit: uploadLimits.maxBytes },
        })
      }

      if (firstRunExpired(request))
        return reply.code(401).send(UNAUTHORIZED)

      const body = request.body as Readable | undefined

      if (!body || typeof body.pipe !== 'function')
        return reply.code(400).send({ message: 'Backup file is required' })

      try {
        const item = await uploadBackup(body, {
          originalName: request.query.name,
          declaredBytes: declared || undefined,
          // Без входа: одна копия, и загрузка обрывается, как только
          // появился аккаунт
          firstRun: request.firstRun === true,
        })

        return reply
          .code(201)
          .send({ ...item, createdAt: item.createdAt.toISOString() })
      }
      catch (err) {
        if (err instanceof BackupError && err.kind === 'account_created')
          return reply.code(401).send(UNAUTHORIZED)

        return sendBackupError(reply, err)
      }
    },
  )

  app.get(
    '/:name/download',
    {
      onRequest: requireOwner,
      schema: { hide: true, ...nameRoute },
    },
    async (request, reply) => {
      let path: string

      try {
        path = await backupPath(request.params.name)
      }
      catch (err) {
        return sendBackupError(reply, err)
      }

      const { size } = await stat(path)

      return reply
        .header(
          'Content-Disposition',
          `attachment; filename="${request.params.name}"`,
        )
        .header('Cache-Control', 'no-store')
        .header('Content-Length', size)
        .type('application/octet-stream')
        .send(createReadStream(path))
    },
  )

  app.delete(
    '/:name',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'deleteBackup',
        tags: ['Backups'],
        ...nameRoute,
        response: {
          204: z.null(),
          401: messageResponse,
          404: messageResponse,
        },
      },
    },
    async (request, reply) => {
      try {
        await deleteBackup(request.params.name)
      }
      catch (err) {
        return sendBackupError(reply, err)
      }

      return reply.code(204).send(null)
    },
  )

  app.post(
    '/:name/restore',
    {
      onRequest: requireOwnerOrFirstRun,
      schema: {
        operationId: 'postBackupRestore',
        tags: ['Backups'],
        ...nameRoute,
        body: restoreBackupBody.nullish(),
        response: {
          202: restoreResponse,
          401: messageResponse,
          404: messageResponse,
          422: backupErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { name } = request.params
      const firstRun = request.firstRun === true

      if (firstRunExpired(request))
        return reply.code(401).send(UNAUTHORIZED)

      // Без входа — только копия, загруженная без входа в этом запуске (она
      // во временном каталоге): каталог копий мог остаться от прежней
      // установки, а смотреть его без входа нельзя
      const uploadedPath = firstRun ? firstRunUploadPath(name) : undefined

      if (firstRun && !uploadedPath)
        return reply.code(404).send(NOT_FOUND)

      try {
        await requestRestore(
          uploadedPath ? { path: uploadedPath, backupName: name } : { name },
          { password: request.body?.password },
          { firstRun },
        )
      }
      catch (err) {
        return sendBackupError(reply, err)
      }

      return reply.code(202).send({ restore: currentRestore()! })
    },
  )
}
