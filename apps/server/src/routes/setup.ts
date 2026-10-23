import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { config } from '../config.ts'
import { messageResponse } from '../dto/common.ts'
import {
  discoverManagersResult,
  storageCheck,
  updateWizard,
  wizardState,
} from '../dto/setup.ts'
import { requireOwner } from '../middleware/auth.ts'
import { discoverManagers } from '../services/setup/discover.ts'
import { checkStorage } from '../services/setup/storage.ts'
import {
  getWizard,
  updateWizard as saveWizard,
} from '../services/setup/wizard.ts'

const guardResponses = {
  401: messageResponse,
}

/** Мастер первого запуска после создания аккаунта: только сессия владельца */
export const setupRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '/wizard',
    {
      schema: {
        operationId: 'getSetupWizard',
        tags: ['Setup'],
        response: { 200: wizardState, ...guardResponses },
      },
    },
    async () => getWizard(),
  )

  app.put(
    '/wizard',
    {
      schema: {
        operationId: 'putSetupWizard',
        tags: ['Setup'],
        body: updateWizard,
        response: {
          200: wizardState,
          400: messageResponse,
          ...guardResponses,
        },
      },
    },
    async request => saveWizard(request.body),
  )

  app.get(
    '/storage-check',
    {
      schema: {
        operationId: 'getSetupStorageCheck',
        tags: ['Setup'],
        response: { 200: storageCheck, ...guardResponses },
      },
    },
    async () =>
      checkStorage({
        dataDir: config.dataDir,
        downloadsDir: config.downloadsPath,
        libraryDir: config.libraryPath,
      }),
  )

  // Ключ не нужен: менеджер узнаётся по анонимному роуту, ключ вводит владелец
  app.post(
    '/discover-managers',
    {
      schema: {
        operationId: 'postSetupDiscoverManagers',
        tags: ['Setup'],
        response: { 200: discoverManagersResult, ...guardResponses },
      },
    },
    async () => ({ items: await discoverManagers() }),
  )
}
