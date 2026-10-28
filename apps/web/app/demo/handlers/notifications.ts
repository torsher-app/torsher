import type {
  MarkNotificationsReadBodyInput,
  NotificationChannel,
  NotificationChannelBodyInput,
  NotificationChannelEnabledBodyInput,
  NotificationChannelList,
  NotificationChannelTestBodyInput,
  NotificationChannelTestResult,
  NotificationItem,
  NotificationList,
  NotificationUnreadCount,
  TelegramChatsBodyInput,
} from '@torsher/api-client'
import { releaseName, titleNamed } from '../fixtures/titles'
import {
  del,
  DemoError,
  get,
  NO_CONTENT,
  patch,
  post,
  put,
  unavailable,
} from '../router'
import { ago, DAY, HOUR, isFresh, MINUTE, nextId } from '../state'

// --- Центр уведомлений ---

type Params = NotificationItem['params']

let lastItem = 0

function item(
  kind: NotificationItem['kind'],
  secondsAgo: number,
  params: Params,
  extra: Partial<NotificationItem> = {},
): NotificationItem {
  lastItem += 1

  return {
    id: `notification-${lastItem}`,
    kind,
    severity: 'info',
    params,
    createdAt: ago(secondsAgo),
    // Старше суток — уже прочитаны
    readAt: secondsAgo > DAY ? ago(secondsAgo - 30 * MINUTE) : undefined,
    ...extra,
  }
}

/** Событие «Следить»: тайтл, серии и данные раздачи, как пишет сервер */
function follow(
  kind: NotificationItem['kind'],
  secondsAgo: number,
  name: string,
  episodes: { season: number, episode: number }[],
  params: Params = {},
  extra: Partial<NotificationItem> = {},
) {
  const title = titleNamed(name)

  return item(
    kind,
    secondsAgo,
    {
      titleId: title.id,
      names: { en_US: title.title },
      ...(episodes.length && {
        episodes: episodes
          .map(({ season, episode }) => `S${season}E${episode}`)
          .join(', '),
        count: episodes.length,
      }),
      ...params,
    },
    { section: 'follow', ...extra },
  )
}

function livedItems(): NotificationItem[] {
  const weekly = (
    name: string,
    season: number,
    from: number,
    startDay: number,
  ) =>
    Array.from({ length: from }, (_, index) =>
      follow(
        'follow_downloaded',
        (startDay + index * 7) * DAY + 2 * HOUR,
        name,
        [{ season, episode: from - index }],
        { voiceType: 'Original', quality: '1080p' },
      ))

  return [
    follow(
      'follow_downloaded',
      38 * MINUTE,
      'Glasswing',
      [{ season: 2, episode: 6 }],
      { voiceType: 'Original', quality: '1080p' },
    ),
    follow(
      'follow_ready',
      3 * HOUR,
      'Kites over Mareth',
      [{ season: 1, episode: 8 }],
      { quality: '1080p' },
    ),
    item(
      'download_completed',
      6 * HOUR,
      {
        name: releaseName(titleNamed('Lanterns of Vell'), {
          quality: '2160p.WEB-DL.H.265',
        }),
      },
      { section: 'downloads' },
    ),
    follow(
      'follow_topic_updated',
      9 * HOUR,
      'Ninefold Harbor',
      [],
      { season: 3, episodesTo: 7, episodesTotal: 10 },
      { readAt: ago(8 * HOUR) },
    ),
    follow(
      'follow_waiting',
      DAY + 4 * HOUR,
      'Glasswing',
      [{ season: 2, episode: 5 }],
      { quality: '720p', wait: { quality: '1080p' }, until: ago(-3 * HOUR) },
    ),
    item(
      'problem',
      DAY + 7 * HOUR,
      { name: 'indexer.example' },
      {
        problem: 'host_unreachable',
        severity: 'error',
        section: 'network',
        resolvedAt: ago(DAY + 5 * HOUR),
      },
    ),
    item(
      'device_paired',
      2 * DAY + 3 * HOUR,
      { name: 'Kitchen tablet' },
      { section: 'people' },
    ),
    follow(
      'follow_upgraded',
      2 * DAY + 11 * HOUR,
      'Kites over Mareth',
      [{ season: 1, episode: 7 }],
      { quality: '2160p' },
    ),
    follow(
      'follow_missing',
      4 * DAY,
      'Ninefold Harbor',
      [{ season: 3, episode: 8 }],
      { days: 3 },
      { severity: 'warning' },
    ),
    item(
      'download_completed',
      8 * DAY,
      { name: releaseName(titleNamed('Paper Comets')) },
      { section: 'downloads' },
    ),
    ...weekly('Glasswing', 2, 4, 7),
    ...weekly('Kites over Mareth', 1, 6, 5),
    item(
      'device_paired',
      40 * DAY,
      { name: 'Living room TV' },
      { section: 'people' },
    ),
  ].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

// Свежий сервер ещё ничего не сообщал
const items: NotificationItem[] = isFresh ? [] : livedItems()

function unreadCount() {
  return items.filter(entry => !entry.readAt).length
}

get<NotificationList>('/api/notifications', ({ query }) => {
  const limit = Number(query.get('limit')) || 20
  const before = query.get('before')
  const start = before
    ? items.findIndex(entry => entry.id === before) + 1
    : 0
  const page = items.slice(start, start + limit)

  return {
    items: page,
    nextCursor: start + limit < items.length ? page.at(-1)?.id : undefined,
    unread: unreadCount(),
  }
})

get<NotificationUnreadCount>('/api/notifications/unread', () => ({
  count: unreadCount(),
}))

post<null, MarkNotificationsReadBodyInput>(
  '/api/notifications/read',
  ({ body }) => {
    const ids = 'ids' in body ? new Set(body.ids) : undefined
    const now = ago(0)

    for (const entry of items) {
      if (!entry.readAt && (!ids || ids.has(entry.id)))
        entry.readAt = now
    }

    return NO_CONTENT
  },
)

// --- Каналы ---

type Kind = NotificationChannel['kind']

const KINDS: Kind[] = [
  'telegram',
  'webhook',
  'ntfy',
  'gotify',
  'apprise',
  'email',
]

// Секреты в ответ не попадают: панель видит только, что они сохранены
const SECRET_FIELDS: Record<Kind, string[]> = {
  telegram: ['token'],
  webhook: ['url', 'authorization'],
  ntfy: ['token'],
  gotify: ['token'],
  apprise: ['urls', 'password'],
  email: ['password'],
}

type Config = Record<string, string | number | boolean | null>

interface StoredChannel extends Omit<
  NotificationChannel,
  'config' | 'secrets'
> {
  config: Config
}

const channels: StoredChannel[] = isFresh
  ? []
  : [
      {
        id: 'channel-telegram',
        kind: 'telegram',
        name: 'Telegram',
        enabled: true,
        language: 'en_US',
        panelUrl: 'http://192.168.1.20:8080',
        config: { token: '7000000000:demo-token', chatId: '-1001234567890' },
        events: ['problems', 'updates', 'follow', 'devices'],
        includeWarnings: false,
        notifyResolved: true,
        lastSentAt: ago(38 * MINUTE),
        createdAt: ago(62 * DAY),
      },
      {
        id: 'channel-webhook',
        kind: 'webhook',
        name: 'Home server',
        enabled: true,
        language: 'en_US',
        config: {
          url: 'https://hooks.example/torsher/3f9c2a',
          format: 'json',
        },
        events: ['problems', 'downloads'],
        includeWarnings: true,
        notifyResolved: false,
        lastSentAt: ago(6 * HOUR),
        createdAt: ago(41 * DAY),
      },
    ]

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === ''
}

function toResponse(channel: StoredChannel): NotificationChannel {
  const secretFields = new Set(SECRET_FIELDS[channel.kind])
  const config: Config = {}
  const secrets: string[] = []

  for (const [field, value] of Object.entries(channel.config)) {
    if (!secretFields.has(field))
      config[field] = value
    else if (!isEmpty(value))
      secrets.push(field)
  }

  return { ...channel, config, secrets }
}

/** Пустой секрет — оставить сохранённый, `null` — удалить, как на сервере */
function mergeConfig(kind: Kind, input: Config, stored: Config = {}) {
  const secretFields = new Set(SECRET_FIELDS[kind])
  const merged: Config = {}

  for (const [field, value] of Object.entries(input)) {
    if (!isEmpty(value))
      merged[field] = typeof value === 'string' ? value.trim() : value
  }

  for (const field of secretFields) {
    if (
      isEmpty(merged[field])
      && input[field] !== null
      && !isEmpty(stored[field])
    ) {
      merged[field] = stored[field]!
    }
  }

  return merged
}

/** Обязательные поля тех видов, что чаще всего настраивают */
function invalidFields(kind: Kind, config: Config) {
  const text = (field: string) => String(config[field] ?? '')

  switch (kind) {
    case 'telegram':
      return [
        ...(/^\d+:[\w-]+$/.test(text('token')) ? [] : ['token']),
        ...(/^-?\d+$|^@\w+$/.test(text('chatId')) ? [] : ['chatId']),
      ]
    case 'webhook':
      return /^https?:\/\/\S+$/.test(text('url')) ? [] : ['url']
    default:
      return []
  }
}

function findChannel(id: string) {
  const channel = channels.find(entry => entry.id === id)

  if (!channel)
    throw new DemoError(404, { message: 'Channel not found' })

  return channel
}

function fromBody(body: NotificationChannelBodyInput, stored?: StoredChannel) {
  const config = mergeConfig(body.kind, body.config, stored?.config)
  const fields = invalidFields(body.kind, config)

  if (fields.length)
    throw new DemoError(422, { message: 'Invalid channel config', fields })

  return {
    kind: body.kind,
    name: body.name.trim(),
    enabled: body.enabled,
    language: body.language,
    panelUrl: body.panelUrl || undefined,
    config,
    events: body.events,
    includeWarnings: body.includeWarnings,
    notifyResolved: body.notifyResolved,
  }
}

get<NotificationChannelList>('/api/notifications/channels', () => ({
  kinds: KINDS,
  items: channels.map(toResponse),
}))

// Точные пути раньше шаблонных `/api/notifications/channels/:id`.
// Тестовая отправка и поиск чатов ходят во внешний сервис: в демо их нет
post<NotificationChannelTestResult, NotificationChannelTestBodyInput>(
  '/api/notifications/channels/test',
  () => unavailable(),
)

post<never, TelegramChatsBodyInput>('/api/notifications/telegram/chats', () =>
  unavailable())

post<NotificationChannel, NotificationChannelBodyInput>(
  '/api/notifications/channels',
  ({ body }) => {
    const channel: StoredChannel = {
      id: nextId('channel'),
      ...fromBody(body),
      createdAt: ago(0),
    }

    channels.push(channel)

    return toResponse(channel)
  },
)

put<NotificationChannel, NotificationChannelBodyInput>(
  '/api/notifications/channels/:id',
  ({ params, body }) => {
    const channel = findChannel(params.id!)

    Object.assign(channel, fromBody(body, channel))

    return toResponse(channel)
  },
)

patch<NotificationChannel, NotificationChannelEnabledBodyInput>(
  '/api/notifications/channels/:id',
  ({ params, body }) => {
    const channel = findChannel(params.id!)

    channel.enabled = body.enabled

    return toResponse(channel)
  },
)

del('/api/notifications/channels/:id', ({ params }) => {
  channels.splice(channels.indexOf(findChannel(params.id!)), 1)

  return NO_CONTENT
})

post<NotificationChannelTestResult>(
  '/api/notifications/channels/:id/test',
  () => unavailable(),
)
