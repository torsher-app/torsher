import type { RenderedMessage } from '../render.ts'
import type { ChannelProvider } from './types.ts'
import { z } from 'zod'
import { channelFetch } from './http.ts'
import { DeliveryError } from './types.ts'

export const TELEGRAM_API_ORIGIN = 'https://api.telegram.org'
// Предел Telegram — 4096 символов после разбора разметки
const TEXT_LIMIT = 4000

const config = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d+:[\w-]+$/),
  chatId: z
    .string()
    .trim()
    .regex(/^-?\d+$|^@\w+$/),
})

export type TelegramConfig = z.infer<typeof config>

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function htmlOf(message: RenderedMessage) {
  const text
    = message.text.length > TEXT_LIMIT
      ? `${message.text.slice(0, TEXT_LIMIT - 1)}…`
      : message.text
  const lines = [`<b>${escapeHtml(message.title)}</b>`, escapeHtml(text)]

  if (message.url) {
    lines.push(
      `<a href="${escapeHtml(message.url)}">${escapeHtml(message.linkLabel)}</a>`,
    )
  }

  return lines.join('\n')
}

interface TelegramReply {
  ok?: boolean
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
  result?: unknown
}

/** У Bot API статус и причина — в теле: 400 бывает и «чат не найден» */
async function call(token: string, method: string, body: unknown) {
  const response = await channelFetch(
    `${TELEGRAM_API_ORIGIN}/bot${token}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  let reply: TelegramReply = {}

  try {
    reply = (await response.json()) as TelegramReply
  }
  catch {}

  if (response.ok && reply.ok)
    return reply.result

  const status = reply.error_code ?? response.status
  const message = `Telegram responded ${status}`

  if (status === 401 || status === 404)
    throw new DeliveryError('unauthorized', message, { status })

  if (status === 429) {
    const after = reply.parameters?.retry_after

    throw new DeliveryError('rate_limited', message, {
      status,
      retryAfterMs: after ? after * 1000 : undefined,
    })
  }

  if (status === 400 || status === 403)
    throw new DeliveryError('not_found', message, { status })

  throw new DeliveryError(
    status >= 500 ? 'unavailable' : 'invalid_response',
    message,
    { status },
  )
}

export const telegram = {
  kind: 'telegram',
  schema: config,
  secretFields: ['token'],
  endpointFields: [],
  async send(message, { token, chatId }) {
    await call(token, 'sendMessage', {
      chat_id: chatId,
      text: htmlOf(message),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    })
  },
} satisfies ChannelProvider<TelegramConfig>

export interface TelegramChat {
  id: string
  title: string
  type: string
}

/**
 * Чаты, которые писали боту: владелец отправляет боту `/start` и выбирает
 * чат из списка, а не ищет числовой ID сам.
 */
export async function findTelegramChats(
  token: string,
): Promise<TelegramChat[]> {
  const updates = (await call(token, 'getUpdates', {
    limit: 100,
  })) as unknown[]
  const chats = new Map<string, TelegramChat>()

  for (const update of Array.isArray(updates) ? updates : []) {
    const item = update as Record<
      string,
      { chat?: Record<string, unknown> } | undefined
    >
    const chat = (item.message ?? item.channel_post ?? item.my_chat_member)
      ?.chat

    if (!chat || (typeof chat.id !== 'number' && typeof chat.id !== 'string'))
      continue

    const name = [chat.title, chat.first_name, chat.last_name]
      .filter(part => typeof part === 'string' && part)
      .join(' ')
    const username
      = typeof chat.username === 'string' ? `@${chat.username}` : ''

    chats.set(String(chat.id), {
      id: String(chat.id),
      title: name || username || String(chat.id),
      type: typeof chat.type === 'string' ? chat.type : 'private',
    })
  }

  return [...chats.values()]
}
