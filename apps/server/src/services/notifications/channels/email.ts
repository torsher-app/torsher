import type { ChannelProvider } from './types.ts'
import { createTransport } from 'nodemailer'
import { z } from 'zod'
import { connectThroughRoute, routeForHost } from '../../net/index.ts'
import { DeliveryError } from './types.ts'

export const emailSecurity = ['starttls', 'tls', 'none'] as const

const config = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(emailSecurity),
  username: z.string().trim().max(320).optional(),
  password: z.string().max(500).optional(),
  from: z.email(),
  to: z.email(),
})

export type EmailConfig = z.infer<typeof config>

const TIMEOUT_MS = 10_000

interface SmtpError {
  code?: string
  responseCode?: number
}

/** Ошибка SMTP — в вид для панели; текст ответа сервера наружу не идёт */
function errorOf(err: unknown) {
  const { code, responseCode } = (err ?? {}) as SmtpError
  const status = responseCode

  if (code === 'EAUTH' || responseCode === 535) {
    return new DeliveryError('unauthorized', 'SMTP rejected the credentials', {
      status,
    })
  }

  if (code === 'EENVELOPE') {
    return new DeliveryError('not_found', 'SMTP rejected the address', {
      status,
    })
  }

  if (responseCode && responseCode >= 500) {
    return new DeliveryError(
      'invalid_response',
      `SMTP responded ${responseCode}`,
      { status },
    )
  }

  return new DeliveryError(
    'unavailable',
    code ? `SMTP connection failed (${code})` : 'SMTP connection failed',
    { status },
  )
}

/**
 * Письмо идёт по маршруту хоста SMTP, как HTTP-каналы через `netFetch`:
 * SOCKS5, HTTP CONNECT или DoH маршрута; иначе соединение открывает Nodemailer.
 */
export const email = {
  kind: 'email',
  schema: config,
  secretFields: ['password'],
  endpointFields: ['host'],
  async send(message, { host, port, security, username, password, from, to }) {
    const transport = createTransport({
      host,
      port,
      secure: security === 'tls',
      requireTLS: security === 'starttls',
      ignoreTLS: security === 'none',
      auth: username ? { user: username, pass: password ?? '' } : undefined,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS * 2,
      getSocket(_options, callback) {
        connectThroughRoute(routeForHost(host), host, port).then(
          socket => callback(null, socket ? { connection: socket } : false),
          err => callback(err as Error, false),
        )
      },
    })
    const text = message.url
      ? `${message.text}\n\n${message.linkLabel}: ${message.url}`
      : message.text

    try {
      await transport.sendMail({ from, to, subject: message.title, text })
    }
    catch (err) {
      throw errorOf(err)
    }
    finally {
      transport.close()
    }
  },
} satisfies ChannelProvider<EmailConfig>
