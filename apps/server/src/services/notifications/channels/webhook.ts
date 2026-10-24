import type { RenderedMessage } from '../render.ts'
import type { ChannelProvider } from './types.ts'
import { z } from 'zod'
import { config as serverConfig } from '../../../config.ts'
import { postJson } from './http.ts'

export const webhookFormats = ['auto', 'discord', 'slack', 'json'] as const

const config = z.object({
  url: z.url({ protocol: /^https?$/ }),
  format: z.enum(webhookFormats).default('auto'),
  // Необязательный заголовок `Authorization` для своего приёмника
  authorization: z.string().trim().max(1000).optional(),
})

export type WebhookConfig = z.infer<typeof config>

// Предел Discord — 2000 символов в `content`
const DISCORD_LIMIT = 1900

/** `auto` различает Discord и Slack по хосту вебхука, остальным — свой JSON */
export function webhookFormatOf(url: string, format: WebhookConfig['format']) {
  if (format !== 'auto')
    return format

  const host = new URL(url).hostname

  if (
    host === 'discord.com'
    || host === 'discordapp.com'
    || host.endsWith('.discord.com')
  ) {
    return 'discord'
  }

  return host === 'hooks.slack.com' ? 'slack' : 'json'
}

function discordBody(message: RenderedMessage) {
  const lines = [`**${message.title}**`, message.text]

  if (message.url)
    lines.push(`[${message.linkLabel}](${message.url})`)

  const content = lines.join('\n')

  return {
    content:
      content.length > DISCORD_LIMIT
        ? `${content.slice(0, DISCORD_LIMIT - 1)}…`
        : content,
    // Упоминания из имён раздач не должны никого звать
    allowed_mentions: { parse: [] },
  }
}

function slackBody(message: RenderedMessage) {
  const escape = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
  const lines = [`*${escape(message.title)}*`, escape(message.text)]

  if (message.url)
    lines.push(`<${message.url}|${escape(message.linkLabel)}>`)

  return { text: lines.join('\n') }
}

/** Свой формат: стабильная схема для приёмников владельца (Home Assistant, n8n…) */
export function torsherBody(message: RenderedMessage) {
  return {
    version: 1,
    event: message.event,
    severity: message.severity,
    title: message.title,
    message: message.text,
    url: message.url,
    occurredAt: message.occurredAt,
    server: { version: serverConfig.version },
    data: message.data,
  }
}

export const webhook = {
  kind: 'webhook',
  schema: config,
  // Адрес вебхука Discord и Slack — сам по себе ключ
  secretFields: ['url', 'authorization'],
  endpointFields: ['url'],
  async send(message, { url, format, authorization }) {
    const kind = webhookFormatOf(url, format)
    const body
      = kind === 'discord'
        ? discordBody(message)
        : kind === 'slack'
          ? slackBody(message)
          : torsherBody(message)

    await postJson(
      url,
      body,
      authorization ? { Authorization: authorization } : {},
    )
  },
} satisfies ChannelProvider<WebhookConfig>
