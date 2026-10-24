import { z } from 'zod'
import {
  notificationChannelKinds,
  notificationSeverities,
  profileLanguages,
} from '../db/schema.ts'
import { deliveryErrorKinds } from '../services/notifications/channels/types.ts'
import {
  attentionItem,
  attentionKinds,
  attentionSections,
} from './overview.ts'

export const notificationKinds = [
  'problem',
  'update_available',
  'server_updated',
  'download_completed',
  'device_paired',
  'channel_failing',
] as const

export type NotificationKind = (typeof notificationKinds)[number]

// Что выбирают у внешнего канала; центр в панели получает всё
export const notificationGroups = [
  'problems',
  'updates',
  'downloads',
  'devices',
] as const

export type NotificationGroup = (typeof notificationGroups)[number]

export const notificationSections = [
  ...attentionSections,
  'about',
  'people',
  'notifications',
] as const

export type NotificationSection = (typeof notificationSections)[number]

export const notificationParams = attentionItem.shape.params
  .extend({
    // Версия: доступная или та, до которой обновились; `from` — прежняя
    version: z.string().optional(),
    from: z.string().optional(),
    // Тип подключённого устройства
    type: z.string().optional(),
  })
  .meta({ id: 'notificationParams' })

export type NotificationParams = z.infer<typeof notificationParams>

export const notificationItem = z
  .object({
    id: z.string(),
    kind: z.enum(notificationKinds),
    problem: z.enum(attentionKinds).optional(),
    severity: z.enum(notificationSeverities),
    section: z.enum(notificationSections).optional(),
    params: notificationParams,
    createdAt: z.string(),
    readAt: z.string().optional(),
    // Проблема прошла; у остальных событий его нет
    resolvedAt: z.string().optional(),
  })
  .meta({ id: 'notificationItem' })

export type NotificationItem = z.infer<typeof notificationItem>

export const notificationListQuery = z.object({
  // Курсор — `id` последней показанной строки: лента «свежее сверху»
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const notificationList = z
  .object({
    items: z.array(notificationItem),
    nextCursor: z.string().optional(),
    unread: z.number(),
  })
  .meta({ id: 'notificationList' })

export const unreadCount = z
  .object({ count: z.number() })
  .meta({ id: 'notificationUnreadCount' })

export const markReadBody = z
  .union([
    z.object({ ids: z.array(z.string()).min(1).max(100) }),
    z.object({ all: z.literal(true) }),
  ])
  .meta({ id: 'markNotificationsReadBody' })

export const channelConfig = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .meta({ id: 'notificationChannelConfig' })

const channelFields = {
  kind: z.enum(notificationChannelKinds),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  language: z.enum(profileLanguages),
  // Адрес панели для ссылок; без него сообщения уходят без ссылки
  panelUrl: z.url({ protocol: /^https?$/ }).nullish(),
  // Секретное поле пустое при правке — оставить сохранённое
  config: channelConfig,
  events: z.array(z.enum(notificationGroups)).max(notificationGroups.length),
  includeWarnings: z.boolean(),
  notifyResolved: z.boolean(),
}

export const channelInput = z
  .object(channelFields)
  .meta({ id: 'notificationChannelBody' })

export const channelResponse = z
  .object({
    id: z.string(),
    kind: z.enum(notificationChannelKinds),
    name: z.string(),
    enabled: z.boolean(),
    language: z.enum(profileLanguages),
    panelUrl: z.string().optional(),
    // Открытые поля настроек; секреты — только именами в `secrets`
    config: channelConfig,
    secrets: z.array(z.string()),
    events: z.array(z.enum(notificationGroups)),
    includeWarnings: z.boolean(),
    notifyResolved: z.boolean(),
    lastSentAt: z.string().optional(),
    lastError: z.object({ kind: z.string(), at: z.string() }).optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'notificationChannel' })

export const channelList = z
  .object({
    // Виды каналов этой сборки
    kinds: z.array(z.enum(notificationChannelKinds)),
    items: z.array(channelResponse),
  })
  .meta({ id: 'notificationChannelList' })

export const channelIdParams = z.object({ id: z.string() })

export const channelEnabledBody = z
  .object({ enabled: z.boolean() })
  .meta({ id: 'notificationChannelEnabledBody' })

export const channelConfigError = z
  .object({ message: z.string(), fields: z.array(z.string()) })
  .meta({ id: 'notificationChannelConfigError' })

// Проверка несохранённой формы; `id` — взять сохранённые секреты канала
export const channelTestBody = z
  .object({ ...channelFields, id: z.string().optional() })
  .meta({ id: 'notificationChannelTestBody' })

export const channelTestResult = z
  .object({
    ok: z.boolean(),
    kind: z.enum(deliveryErrorKinds).optional(),
    status: z.number().optional(),
  })
  .meta({ id: 'notificationChannelTestResult' })

export const telegramChatsBody = z
  .object({
    token: z.string().trim().max(200).optional(),
    // Сохранённый канал: токен берётся из него
    id: z.string().optional(),
  })
  .meta({ id: 'telegramChatsBody' })

export const telegramChats = z
  .object({
    ok: z.boolean(),
    kind: z.enum(deliveryErrorKinds).optional(),
    chats: z.array(
      z.object({ id: z.string(), title: z.string(), type: z.string() }),
    ),
  })
  .meta({ id: 'telegramChats' })
