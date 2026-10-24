import type { ChannelProvider } from './types.ts'
import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { baseUrl, postJson } from './http.ts'

// Ключ конфигурации `apprise-api` или URL сервисов Apprise напрямую
const config = z
  .object({
    server: z.url({ protocol: /^https?$/ }),
    key: z
      .string()
      .trim()
      .regex(/^[\w-]{1,128}$/)
      .optional(),
    urls: z.string().trim().max(4000).optional(),
    username: z.string().trim().max(200).optional(),
    password: z.string().max(200).optional(),
  })
  .refine(value => Boolean(value.key || value.urls), { path: ['key'] })

export type AppriseConfig = z.infer<typeof config>

const types = { error: 'failure', warning: 'warning', info: 'info' } as const

/** Канал для тех, у кого уже стоит `apprise-api`: остальные сервисы — через него */
export const apprise = {
  kind: 'apprise',
  schema: config,
  secretFields: ['urls', 'password'],
  endpointFields: ['server'],
  async send(message, { server, key, urls, username, password }) {
    const body = message.url ? `${message.text}\n${message.url}` : message.text
    const headers: Record<string, string> = username
      ? {
          Authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`,
        }
      : {}

    await postJson(
      key
        ? `${baseUrl(server)}/notify/${encodeURIComponent(key)}`
        : `${baseUrl(server)}/notify`,
      {
        urls: key ? undefined : urls,
        title: message.title,
        body,
        type: types[message.severity],
      },
      headers,
    )
  },
} satisfies ChannelProvider<AppriseConfig>
