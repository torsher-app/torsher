import type { ChannelProvider } from './types.ts'
import { z } from 'zod'
import { baseUrl, postJson } from './http.ts'

export const NTFY_DEFAULT_SERVER = 'https://ntfy.sh'

const config = z.object({
  server: z.url({ protocol: /^https?$/ }).default(NTFY_DEFAULT_SERVER),
  topic: z
    .string()
    .trim()
    .regex(/^[\w-]{1,64}$/),
  token: z.string().trim().max(200).optional(),
})

export type NtfyConfig = z.infer<typeof config>

const priorities = { error: 4, warning: 3, info: 2 } as const

/**
 * JSON на корень сервера, а не заголовки `Title` и `Click`: заголовки HTTP
 * не несут кириллицу без перекодировки.
 */
export const ntfy = {
  kind: 'ntfy',
  schema: config,
  secretFields: ['token'],
  endpointFields: ['server'],
  async send(message, { server, topic, token }) {
    await postJson(
      `${baseUrl(server)}/`,
      {
        topic,
        title: message.title,
        message: message.text,
        priority: priorities[message.severity],
        click: message.url,
      },
      token ? { Authorization: `Bearer ${token}` } : {},
    )
  },
} satisfies ChannelProvider<NtfyConfig>
