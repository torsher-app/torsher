import {
  maintenanceConfig,
  maintenanceDefaultPreview,
  maintenanceExecution,
  maintenancePreview,
  maintenanceProtection,
  maintenanceRuleInput,
  maintenanceSave,
  maintenanceStatus,
  maintenanceUnsuppress,
} from '../dto/libraryMaintenance.ts'
import {
  acknowledgeMaintenanceRestore,
  cancelExternalMaintenanceFence,
  retryMaintenanceOperation,
  setMaintenanceExecution,
} from '../services/libraryMaintenance/executor.ts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  DEFAULT_RULE,
  maintenanceConfig as getConfig,
  maintenanceStatus as getStatus,
  inheritMaintenanceConfig,
  previewDefaultMaintenance,
  previewMaintenance,
  protectGroup,
  saveMaintenanceConfig,
  validRule,
} from '../services/libraryMaintenance/index.ts'
import { allowRedownload } from '../services/libraryMaintenance/suppression.ts'

const params = z.object({
  titleId: z.string().regex(/^tmdb:(movie|tv):[1-9]\d*$/),
})
const errors = {
  400: messageResponse,
  401: messageResponse,
  403: messageResponse,
  409: messageResponse,
}
const tags = ['Library maintenance']
export const libraryMaintenanceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)
  app.get(
    '/default',
    {
      schema: {
        operationId: 'getDefaultMaintenanceRule',
        tags,
        response: { 200: maintenanceConfig, ...errors },
      },
    },
    () => getConfig(DEFAULT_RULE),
  )
  app.patch(
    '/default',
    {
      schema: {
        operationId: 'saveDefaultMaintenanceRule',
        tags,
        body: maintenanceSave,
        response: { 200: maintenanceConfig, ...errors },
      },
    },
    async (request, reply) => {
      const { expectedRevision, ...rule } = request.body
      if (!validRule(DEFAULT_RULE, rule))
        return reply.code(400).send({ message: 'invalid_maintenance_rule' })
      return (
        saveMaintenanceConfig(DEFAULT_RULE, rule, expectedRevision)
        ?? reply.code(409).send({ message: 'maintenance_revision_conflict' })
      )
    },
  )
  app.post(
    '/default/preview',
    {
      schema: {
        operationId: 'previewDefaultMaintenanceRule',
        tags,
        body: maintenanceRuleInput,
        response: { 200: maintenanceDefaultPreview, ...errors },
      },
    },
    request => previewDefaultMaintenance(request.body),
  )
  app.post(
    '/titles/:titleId/inherit/preview',
    {
      schema: {
        operationId: 'previewInheritedMaintenanceRule',
        tags,
        params,
        response: { 200: maintenancePreview, ...errors },
      },
    },
    (request) => {
      const titleId = request.params.titleId
      const { rule } = getConfig(DEFAULT_RULE)
      return previewMaintenance(
        titleId,
        {
          ...rule,
          keepLast: titleId.startsWith('tmdb:movie:') ? null : rule.keepLast,
        },
        Date.now(),
        { rosterChanged: rule.rosterChanged },
      )
    },
  )
  app.post(
    '/titles/:titleId/inherit',
    {
      schema: {
        operationId: 'inheritMaintenanceRule',
        tags,
        params,
        body: z.object({
          expectedRevision: z.number().int(),
          defaultRevision: z.number().int(),
        }),
        response: { 200: maintenanceConfig, ...errors },
      },
    },
    async (request, reply) =>
      inheritMaintenanceConfig(
        request.params.titleId,
        request.body.expectedRevision,
        request.body.defaultRevision,
      ) ?? reply.code(409).send({ message: 'maintenance_revision_conflict' }),
  )
  app.get(
    '/titles/:titleId',
    {
      schema: {
        operationId: 'getLibraryMaintenanceConfig',
        tags,
        params,
        response: { 200: maintenanceConfig, ...errors },
      },
    },
    request => getConfig(request.params.titleId),
  )
  app.patch(
    '/titles/:titleId',
    {
      schema: {
        operationId: 'saveLibraryMaintenanceConfig',
        tags,
        params,
        body: maintenanceSave,
        response: { 200: maintenanceConfig, ...errors },
      },
    },
    async (request, reply) => {
      const { expectedRevision, ...rule } = request.body
      if (!validRule(request.params.titleId, rule))
        return reply.code(400).send({ message: 'invalid_maintenance_rule' })
      const saved = saveMaintenanceConfig(
        request.params.titleId,
        rule,
        expectedRevision,
      )
      return (
        saved
        ?? reply.code(409).send({ message: 'maintenance_revision_conflict' })
      )
    },
  )
  app.post(
    '/titles/:titleId/preview',
    {
      schema: {
        operationId: 'previewLibraryMaintenance',
        tags,
        params,
        body: maintenanceRuleInput,
        response: { 200: maintenancePreview, ...errors },
      },
    },
    async (request, reply) => {
      // Отсутствующий профиль остаётся объяснимой причиной для старого правила.
      if (
        request.params.titleId.startsWith('tmdb:movie:')
        && request.body.keepLast !== null
      ) {
        return reply.code(400).send({ message: 'invalid_maintenance_rule' })
      }
      return previewMaintenance(request.params.titleId, request.body)
    },
  )
  app.patch(
    '/groups/:id/protection',
    {
      schema: {
        operationId: 'protectLibraryMaintenanceGroup',
        tags,
        params: z.object({ id: z.uuid() }),
        body: maintenanceProtection,
        response: {
          200: z.object({ id: z.string(), revision: z.number().int() }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      return (
        protectGroup(
          request.params.id,
          request.body.protected,
          request.body.expectedRevision,
        ) ?? reply.code(409).send({ message: 'maintenance_revision_conflict' })
      )
    },
  )
  app.post(
    '/titles/:titleId/unsuppress',
    {
      schema: {
        operationId: 'unsuppressLibraryMaintenance',
        tags,
        params,
        body: maintenanceUnsuppress,
        response: { 200: messageResponse, ...errors },
      },
    },
    async (request, reply) => {
      return allowRedownload(request.params.titleId, request.body.episodes)
        ? { message: 'ok' }
        : reply.code(409).send({ message: 'maintenance_operation_pending' })
    },
  )
  app.get(
    '/status',
    {
      schema: {
        operationId: 'getLibraryMaintenanceStatus',
        tags,
        response: { 200: maintenanceStatus, ...errors },
      },
    },
    () => getStatus(),
  )
  app.patch(
    '/execution',
    {
      schema: {
        operationId: 'setLibraryMaintenanceExecution',
        tags,
        body: maintenanceExecution,
        response: { 200: maintenanceStatus, ...errors },
      },
    },
    async (request, reply) =>
      setMaintenanceExecution(request.body.enabled)
        ? getStatus()
        : reply.code(409).send({ message: 'maintenance_execution_held' }),
  )
  app.post(
    '/operations/:id/retry',
    {
      schema: {
        operationId: 'retryLibraryMaintenanceOperation',
        tags,
        params: z.object({ id: z.uuid() }),
        response: { 200: maintenanceStatus, ...errors },
      },
    },
    async (request) => {
      await retryMaintenanceOperation(request.params.id)
      return getStatus()
    },
  )
  app.post(
    '/restore/acknowledge',
    {
      schema: {
        operationId: 'acknowledgeLibraryMaintenanceRestore',
        tags,
        response: { 200: maintenanceStatus, ...errors },
      },
    },
    async (_request, reply) =>
      (await acknowledgeMaintenanceRestore())
        ? getStatus()
        : reply.code(409).send({ message: 'maintenance_recovery_required' }),
  )
  app.post(
    '/external-fences/:id/cancel',
    {
      schema: {
        operationId: 'cancelLibraryMaintenanceExternalFence',
        tags,
        params: z.object({ id: z.string().regex(/^[a-z0-9-]{1,80}$/i) }),
        response: { 200: maintenanceStatus, ...errors },
      },
    },
    async (request, reply) =>
      (await cancelExternalMaintenanceFence(request.params.id))
        ? getStatus()
        : reply.code(409).send({ message: 'maintenance_filesystem_intent' }),
  )
}
