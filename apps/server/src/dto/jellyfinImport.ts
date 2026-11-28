import { z } from 'zod'

export const jellyfinImportErrorKinds = [
  'address',
  'addressChanged',
  'httpsRequired',
  'auth',
  'unsupported',
  'response',
  'limit',
  'busy',
  'expired',
  'catalog',
  'profileChanged',
] as const

export const jellyfinImportError = z
  .object({ kind: z.enum(jellyfinImportErrorKinds) })
  .meta({ id: 'jellyfinImportError' })

export const jellyfinConnectionBody = z
  .object({ url: z.string().trim().min(1).max(2048) })
  .meta({ id: 'jellyfinConnectionBody' })

export const jellyfinConnection = z
  .object({
    id: z.uuid(),
    address: z.string(),
    addresses: z.array(z.string()),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'jellyfinConnection' })

export const jellyfinPreviewBody = z
  .object({
    connectionId: z.uuid(),
    username: z.string().min(1).max(256),
    password: z.string().max(1024),
  })
  .meta({ id: 'jellyfinPreviewBody' })

export const jellyfinPreviewStarted = z
  .object({ id: z.uuid() })
  .meta({ id: 'jellyfinPreviewStarted' })

const jellyfinCounts = z.object({
  added: z.int().nonnegative(),
  existing: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
})

export const jellyfinPreview = z
  .object({
    id: z.uuid(),
    state: z.enum(['reading', 'ready', 'failed']),
    source: z.object({ server: z.string(), user: z.string() }).optional(),
    movies: jellyfinCounts.optional(),
    episodes: jellyfinCounts.optional(),
    skipped: z.object({
      invalid: z.int().nonnegative(),
      unmatched: z.int().nonnegative(),
      restricted: z.int().nonnegative(),
      duplicate: z.int().nonnegative(),
    }).optional(),
    lastActivityAt: z.iso.datetime().optional(),
    logoutWarning: z.boolean().optional(),
    error: z.enum(jellyfinImportErrorKinds).optional(),
  })
  .meta({ id: 'jellyfinPreview' })

export type JellyfinImportErrorKind = z.infer<typeof jellyfinImportError>['kind']
export type JellyfinPreviewBody = z.infer<typeof jellyfinPreviewBody>
export type JellyfinPreview = z.infer<typeof jellyfinPreview>
