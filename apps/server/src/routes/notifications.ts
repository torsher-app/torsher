import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply } from 'fastify'
import type { NotificationChannel } from '../db/schema.ts'
import type { ChannelInput } from '../services/notifications/channels/store.ts'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import {
  channelConfigError,
  channelEnabledBody,
  channelIdParams,
  channelInput,
  channelList,
  channelResponse,
  channelTestBody,
  channelTestResult,
  markReadBody,
  notificationList,
  notificationListQuery,
  telegramChats,
  telegramChatsBody,
  unreadCount,
} from '../dto/notifications.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  listNotifications,
  markNotificationsRead,
  unreadNotifications,
} from '../services/notifications/index.ts'
import {
  channelKinds,
  providerOf,
} from '../services/notifications/channels/index.ts'
import {
  ChannelConfigError,
  createChannel,
  decryptConfig,
  deleteChannel,
  getChannel,
  listChannels,
  recordDelivery,
  resolveConfig,
  setChannelEnabled,
  toChannelResponse,
  UnknownChannelKindError,
  updateChannel,
} from '../services/notifications/channels/store.ts'
import { findTelegramChats } from '../services/notifications/channels/telegram.ts'
import { DeliveryError } from '../services/notifications/channels/types.ts'
import { sendTo } from '../services/notifications/delivery.ts'
import { renderTest } from '../services/notifications/render.ts'

const guard = { 401: messageResponse }
const notFound = { message: 'Channel not found' }

function sendConfigError(reply: FastifyReply, err: unknown) {
  if (err instanceof ChannelConfigError)
    return reply.code(422).send({ message: err.message, fields: err.fields })

  if (err instanceof UnknownChannelKindError)
    return reply.code(422).send({ message: err.message, fields: ['kind'] })

  throw err
}

function testResultOf(err: unknown) {
  if (err instanceof DeliveryError)
    return { ok: false, kind: err.kind, status: err.status }

  throw err
}

/** Центр уведомлений и внешние каналы: только владелец */
export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)

  app.get(
    '',
    {
      schema: {
        operationId: 'getNotifications',
        tags: ['Notifications'],
        querystring: notificationListQuery,
        response: { 200: notificationList, ...guard },
      },
    },
    request => listNotifications(request.query),
  )

  app.get(
    '/unread',
    {
      // Колокол спрашивает каждые 30 с: в журнале это шум
      logLevel: 'warn',
      schema: {
        operationId: 'getUnreadNotifications',
        tags: ['Notifications'],
        response: { 200: unreadCount, ...guard },
      },
    },
    () => ({ count: unreadNotifications() }),
  )

  app.post(
    '/read',
    {
      schema: {
        operationId: 'markNotificationsRead',
        tags: ['Notifications'],
        body: markReadBody,
        response: { 204: z.null(), ...guard },
      },
    },
    async (request, reply) => {
      markNotificationsRead('all' in request.body ? 'all' : request.body.ids)

      return reply.code(204).send(null)
    },
  )

  app.get(
    '/channels',
    {
      schema: {
        operationId: 'getNotificationChannels',
        tags: ['Notifications'],
        response: { 200: channelList, ...guard },
      },
    },
    () => ({
      kinds: channelKinds() as NotificationChannel['kind'][],
      items: listChannels().map(toChannelResponse),
    }),
  )

  app.post(
    '/channels',
    {
      schema: {
        operationId: 'createNotificationChannel',
        tags: ['Notifications'],
        body: channelInput,
        response: { 201: channelResponse, 422: channelConfigError, ...guard },
      },
    },
    async (request, reply) => {
      try {
        const row = createChannel(request.body as ChannelInput)

        return reply.code(201).send(toChannelResponse(row))
      }
      catch (err) {
        return sendConfigError(reply, err)
      }
    },
  )

  app.put(
    '/channels/:id',
    {
      schema: {
        operationId: 'updateNotificationChannel',
        tags: ['Notifications'],
        params: channelIdParams,
        body: channelInput,
        response: {
          200: channelResponse,
          404: messageResponse,
          422: channelConfigError,
          ...guard,
        },
      },
    },
    async (request, reply) => {
      try {
        const row = updateChannel(
          request.params.id,
          request.body as ChannelInput,
        )

        return row ? toChannelResponse(row) : reply.code(404).send(notFound)
      }
      catch (err) {
        return sendConfigError(reply, err)
      }
    },
  )

  app.patch(
    '/channels/:id',
    {
      schema: {
        operationId: 'setNotificationChannelEnabled',
        tags: ['Notifications'],
        params: channelIdParams,
        body: channelEnabledBody,
        response: { 200: channelResponse, 404: messageResponse, ...guard },
      },
    },
    async (request, reply) => {
      const row = setChannelEnabled(request.params.id, request.body.enabled)

      return row ? toChannelResponse(row) : reply.code(404).send(notFound)
    },
  )

  app.delete(
    '/channels/:id',
    {
      schema: {
        operationId: 'deleteNotificationChannel',
        tags: ['Notifications'],
        params: channelIdParams,
        response: { 204: z.null(), 404: messageResponse, ...guard },
      },
    },
    async (request, reply) =>
      deleteChannel(request.params.id)
        ? reply.code(204).send(null)
        : reply.code(404).send(notFound),
  )

  app.post(
    '/channels/:id/test',
    {
      schema: {
        operationId: 'testNotificationChannel',
        tags: ['Notifications'],
        params: channelIdParams,
        response: { 200: channelTestResult, 404: messageResponse, ...guard },
      },
    },
    async (request, reply) => {
      const channel = getChannel(request.params.id)

      if (!channel)
        return reply.code(404).send(notFound)

      try {
        await sendTo(channel, renderTest(channel.language, channel.panelUrl))
        // Удачный тест снимает прежнюю ошибку; неудачный не пишется:
        // тест — не доставка
        recordDelivery(channel.id, { ok: true })

        return { ok: true }
      }
      catch (err) {
        return testResultOf(err)
      }
    },
  )

  // Форма до сохранения: секреты, которых нет в форме, — из сохранённого канала
  app.post(
    '/channels/test',
    {
      schema: {
        operationId: 'testNotificationChannelDraft',
        tags: ['Notifications'],
        body: channelTestBody,
        response: { 200: channelTestResult, 422: channelConfigError, ...guard },
      },
    },
    async (request, reply) => {
      const { id, ...input } = request.body
      const previous = id ? getChannel(id) : undefined
      let resolved: ReturnType<typeof resolveConfig>

      try {
        resolved = resolveConfig(input.kind, input.config, previous)
      }
      catch (err) {
        return sendConfigError(reply, err)
      }

      try {
        await resolved.provider.send(
          renderTest(input.language, input.panelUrl),
          resolved.config,
        )

        return { ok: true }
      }
      catch (err) {
        return testResultOf(err)
      }
    },
  )

  app.post(
    '/telegram/chats',
    {
      schema: {
        operationId: 'findTelegramChats',
        tags: ['Notifications'],
        body: telegramChatsBody,
        response: { 200: telegramChats, ...guard },
      },
    },
    async (request) => {
      let token = request.body.token
      const saved = request.body.id ? getChannel(request.body.id) : undefined

      try {
        if (!token && saved?.kind === 'telegram') {
          token = String(
            decryptConfig(providerOf('telegram')!, saved.config).token ?? '',
          )
        }

        if (!token)
          return { ok: false, kind: 'invalid_config' as const, chats: [] }

        return { ok: true, chats: await findTelegramChats(token) }
      }
      catch (err) {
        return { ...testResultOf(err), chats: [] }
      }
    },
  )
}
