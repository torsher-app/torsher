import type { ChannelProvider } from './types.ts'
import { z } from 'zod'
import { baseUrl, postJson } from './http.ts'

const config = z.object({
  server: z.url({ protocol: /^https?$/ }),
  token: z.string().trim().min(1).max(200),
})

export type GotifyConfig = z.infer<typeof config>

const priorities = { error: 8, warning: 5, info: 2 } as const

export const gotify = {
  kind: 'gotify',
  schema: config,
  secretFields: ['token'],
  endpointFields: ['server'],
  async send(message, { server, token }) {
    await postJson(
      `${baseUrl(server)}/message`,
      {
        title: message.title,
        message: message.text,
        priority: priorities[message.severity],
        extras: message.url
          ? { 'client::notification': { click: { url: message.url } } }
          : undefined,
      },
      { 'X-Gotify-Key': token },
    )
  },
} satisfies ChannelProvider<GotifyConfig>
