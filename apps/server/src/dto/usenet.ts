import { z } from 'zod'
import { usenetJobStates } from '../db/schema.ts'

const address = z.url({ protocol: /^https?$/ }).max(2000)
const ipAddresses = z.array(z.union([z.ipv4(), z.ipv6()])).max(32)
const path = z.string().trim().min(1).max(4096)

const usenetConfigShape = {
  url: address,
  apiKey: z.string().trim().min(1).max(500).optional(),
  category: z.string().trim().min(1).max(100),
  remoteRoot: path,
  localRoot: path,
  enabled: z.boolean(),
  followEnabled: z.boolean(),
  lanAddresses: ipAddresses.optional(),
}
export const usenetConfigInput = z
  .object(usenetConfigShape)
  .meta({ id: 'configureUsenet' })

export const usenetConfig = z
  .object(usenetConfigShape)
  .omit({ apiKey: true })
  .extend({
    hasApiKey: z.boolean(),
    verified: z.boolean(),
    restoreBlocked: z.boolean().optional(),
    lanAddresses: ipAddresses,
  })
  .meta({ id: 'usenetConfig' })

export const usenetConfigView = z
  .object({ config: usenetConfig.nullable() })
  .meta({ id: 'usenetConfigView' })

export const usenetAddressInput = z
  .object({ url: address })
  .meta({ id: 'previewUsenetAddress' })

export const usenetAddress = z
  .object({
    origin: z.string(),
    lanAddresses: ipAddresses,
  })
  .meta({ id: 'usenetAddress' })

export const usenetCheck = z
  .object({
    connection: z.enum([
      'ok',
      'invalid',
      'auth',
      'unavailable',
      'category',
      'needs_confirmation',
      'address_changed',
      'unsupported_version',
    ]),
    pathReadable: z.boolean(),
    lanAddresses: ipAddresses,
  })
  .meta({ id: 'usenetCheck' })

export const usenetJob = z
  .object({
    id: z.string(),
    titleId: z.string(),
    season: z.number().int().min(0),
    episode: z.number().int().min(0),
    releaseTitle: z.string(),
    origin: z.enum(['manual', 'follow']),
    state: z.enum(usenetJobStates),
    problem: z.string().nullable(),
    progress: z.number().min(0).max(1).nullable(),
    mediaFileId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'usenetJob' })

export const usenetJobList = z
  .object({ items: z.array(usenetJob) })
  .meta({ id: 'usenetJobList' })

export const titleUsenetQuery = z.object({
  season: z
    .string()
    .regex(/^\d{1,3}$/)
    .optional(),
  episode: z
    .string()
    .regex(/^\d{1,4}$/)
    .optional(),
  query: z.string().trim().min(1).max(120).optional(),
})

export const titleUsenetRequest = z
  .object({
    season: z.number().int().min(0).max(999).optional(),
    episode: z.number().int().min(0).max(9999).optional(),
    candidateId: z.uuid(),
  })
  .meta({ id: 'titleUsenetRequest' })

export const titleUsenetSources = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        source: z.string(),
        quality: z.string().nullable(),
        size: z.number().nullable(),
      }),
    ),
    failed: z.boolean(),
  })
  .meta({ id: 'titleUsenetSources' })
