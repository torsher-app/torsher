import type { z } from 'zod'
import type { RenderedMessage } from '../render.ts'

export const deliveryErrorKinds = [
  'unauthorized',
  'not_found',
  'rate_limited',
  'unavailable',
  'invalid_response',
  'invalid_config',
] as const

export type DeliveryErrorKind = (typeof deliveryErrorKinds)[number]

/**
 * Ошибка доставки по `kind`, без адреса запроса: у Telegram токен бота —
 * часть URL, у вебхука Discord и Slack — сам URL. Поэтому `message` никогда
 * не содержит адреса и пишется в журнал как есть.
 */
export class DeliveryError extends Error {
  readonly kind: DeliveryErrorKind
  readonly status?: number
  readonly retryAfterMs?: number

  constructor(
    kind: DeliveryErrorKind,
    message: string,
    options: { status?: number, retryAfterMs?: number } = {},
  ) {
    super(message)
    this.name = 'DeliveryError'
    this.kind = kind
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
  }
}

export interface ChannelProvider<Config extends Record<string, unknown>> {
  kind: string
  // Настройки в открытом виде, как их присылает панель и видит `send`
  schema: z.ZodType<Config>
  // Поля, которые хранятся шифртекстом и не возвращаются в API
  secretFields: readonly (keyof Config & string)[]
  // Адрес назначения: сменился — сохранённые секреты новому получателю не уходят
  endpointFields: readonly (keyof Config & string)[]
  send: (message: RenderedMessage, config: Config) => Promise<void>
}
