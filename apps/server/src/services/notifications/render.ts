import type { Language, MessageParams } from '@torsher/i18n'
import type {
  NotificationParams,
  NotificationSection,
} from '../../dto/notifications.ts'
import type { Notification } from './inbox.ts'
import {
  attentionMessage,
  followNotificationText,
  isFollowNotification,
  messages,
  translate,
} from '@torsher/i18n'

/** Сообщение для внешнего канала: провайдер раскладывает его в свой формат */
export interface RenderedMessage {
  // `problem`, `problem_resolved`, `update_available`, … — для своего JSON
  event: string
  severity: Notification['severity']
  title: string
  text: string
  // Ссылка на раздел панели, если известен её адрес, и подпись к ней
  url?: string
  linkLabel: string
  occurredAt: string
  data: NotificationParams
}

// Пути панели (`apps/web`), где событие разбирают
const sectionPaths: Record<NotificationSection, string> = {
  downloads: '/downloads',
  library: '/library',
  storage: '/settings/storage',
  backups: '/settings/backups',
  sources: '/sources?filter=attention',
  network: '/settings/network',
  metadata: '/settings/metadata',
  playback: '/settings/playback',
  logs: '/logs?source=engine&level=warn',
  about: '/settings/about',
  people: '/people',
  notifications: '/settings/notifications',
  follow: '/follow',
}

const BYTE_UNITS = [
  'byte',
  'kilobyte',
  'megabyte',
  'gigabyte',
  'terabyte',
] as const

function formatBytes(bytes: number, language: Language) {
  let value = bytes
  let index = 0

  while (value >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024
    index++
  }

  return new Intl.NumberFormat(language.replace('_', '-'), {
    style: 'unit',
    unit: BYTE_UNITS[index],
    unitDisplay: 'short',
    maximumFractionDigits: index < 2 ? 0 : 1,
  }).format(value)
}

function t(
  language: Language,
  key: string,
  params?: MessageParams,
  count?: number,
) {
  return translate(messages, language, key, params, count)
}

export function sectionUrl(
  panelUrl: string | null | undefined,
  section?: string | null,
) {
  if (!panelUrl)
    return undefined

  const base = panelUrl.replace(/\/+$/, '')
  const path = section
    ? sectionPaths[section as NotificationSection]
    : undefined

  return path ? `${base}${path}` : `${base}/`
}

/** Текст проблемы — та же строка, что в «Требует внимания» панели */
export function problemText(
  problem: string,
  params: NotificationParams,
  language: Language,
) {
  const message = attentionMessage({ kind: problem, params })
  const values = { ...message.params }

  if (typeof values.free === 'number')
    values.free = formatBytes(values.free, language)

  if (typeof values.minFree === 'number')
    values.minFree = formatBytes(values.minFree, language)

  if (typeof values.need === 'number')
    values.need = formatBytes(values.need, language)

  return t(language, message.key, values, message.count)
}

export function renderNotification(
  row: Notification,
  options: { resolved: boolean, language: Language, panelUrl?: string | null },
): RenderedMessage {
  const { resolved, language } = options
  const params = row.params as NotificationParams
  const base = {
    severity: resolved ? ('info' as const) : row.severity,
    url: sectionUrl(options.panelUrl, row.section),
    linkLabel: openPanelLabel(language),
    occurredAt: (resolved
      ? (row.resolvedAt ?? new Date())
      : row.createdAt
    ).toISOString(),
    data: params,
  }

  if (row.kind === 'problem' && row.problem) {
    const state = resolved
      ? 'resolved'
      : row.severity === 'warning'
        ? 'warning'
        : 'error'

    return {
      ...base,
      event: resolved ? 'problem_resolved' : 'problem',
      title: t(language, `notifications.problem.${state}`),
      text: problemText(row.problem, params, language),
    }
  }

  if (isFollowNotification(row.kind)) {
    const text = followNotificationText(
      (key, values, count) => t(language, key, values, count),
      language,
      row.kind,
      params,
    )

    return { ...base, event: row.kind, ...text }
  }

  const key = `notifications.events.${row.kind}`
  // В строки подставляются только простые значения
  const values: MessageParams = Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === 'string' || typeof entry[1] === 'number',
    ),
  )

  return {
    ...base,
    event: row.kind,
    title: t(language, `${key}.title`, values),
    text: t(language, `${key}.text`, values),
  }
}

export function renderTest(
  language: Language,
  panelUrl?: string | null,
): RenderedMessage {
  return {
    event: 'test',
    severity: 'info',
    title: t(language, 'notifications.events.test.title'),
    text: t(language, 'notifications.events.test.text'),
    url: sectionUrl(panelUrl, 'notifications'),
    linkLabel: openPanelLabel(language),
    occurredAt: new Date().toISOString(),
    data: {},
  }
}

/** Сводка вместо сообщений сверх часового лимита канала */
export function renderOverflow(
  count: number,
  language: Language,
  panelUrl?: string | null,
): RenderedMessage {
  return {
    event: 'overflow',
    severity: 'info',
    title: t(language, 'notifications.overflow.title'),
    text: t(language, 'notifications.overflow.text', {}, count),
    url: sectionUrl(panelUrl),
    linkLabel: openPanelLabel(language),
    occurredAt: new Date().toISOString(),
    data: { count },
  }
}

export function openPanelLabel(language: Language) {
  return t(language, 'notifications.openPanel')
}
