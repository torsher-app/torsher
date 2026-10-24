import type { Component } from 'vue'
import type { ChannelKind } from '~/composables/useNotificationChannels'
import {
  BellRingIcon,
  MailIcon,
  MessageSquareIcon,
  SendIcon,
  ShareIcon,
  WebhookIcon,
} from '@lucide/vue'

export const channelIcons: Record<ChannelKind, Component> = {
  telegram: SendIcon,
  webhook: WebhookIcon,
  ntfy: BellRingIcon,
  gotify: MessageSquareIcon,
  apprise: ShareIcon,
  email: MailIcon,
}

// Порядок в выборе вида: от самого частого
export const channelKindOrder: ChannelKind[] = [
  'telegram',
  'webhook',
  'ntfy',
  'gotify',
  'email',
  'apprise',
]

export const notificationGroupOrder = [
  'problems',
  'updates',
  'downloads',
  'devices',
] as const

/** Поля настроек вида канала; секреты при правке приходят пустыми */
export const channelFields: Record<ChannelKind, readonly string[]> = {
  telegram: ['token', 'chatId'],
  webhook: ['url', 'format', 'authorization'],
  ntfy: ['server', 'topic', 'token'],
  gotify: ['server', 'token'],
  apprise: ['server', 'key', 'urls', 'username', 'password'],
  email: ['host', 'port', 'security', 'username', 'password', 'from', 'to'],
}

export const channelSecrets: Record<ChannelKind, readonly string[]> = {
  telegram: ['token'],
  webhook: ['url', 'authorization'],
  ntfy: ['token'],
  gotify: ['token'],
  apprise: ['urls', 'password'],
  email: ['password'],
}

// Адрес назначения: сменился — сервер не переносит сохранённые секреты
export const channelEndpoints: Record<ChannelKind, readonly string[]> = {
  telegram: [],
  webhook: ['url'],
  ntfy: ['server'],
  gotify: ['server'],
  apprise: ['server'],
  email: ['host'],
}

// Обязательные поля: правила те же, что у схем провайдеров на сервере
export const channelRequired: Record<ChannelKind, readonly string[]> = {
  telegram: ['token', 'chatId'],
  webhook: ['url'],
  ntfy: ['server', 'topic'],
  gotify: ['server', 'token'],
  apprise: ['server'],
  email: ['host', 'port', 'from', 'to'],
}

export const channelDefaults: Record<ChannelKind, Record<string, string>> = {
  telegram: {},
  webhook: { format: 'auto' },
  ntfy: { server: 'https://ntfy.sh' },
  gotify: {},
  apprise: {},
  email: { port: '587', security: 'starttls' },
}
