import { z } from 'zod'

export const httpAddonResource = z.enum(['stream', 'catalog', 'subtitles'])
export const httpAddonType = z.enum(['movie', 'series'])

export type HttpAddonResource = z.infer<typeof httpAddonResource>
export type HttpAddonType = z.infer<typeof httpAddonType>

const addonId = z.uuid()
const catalogKey = z.string().regex(/^[0-9a-f]{64}$/)
const manifestUrl = z.string().trim().min(1).max(8192)
const approvalId = z.uuid()

export const httpAddonSelections = z
  .object({
    stream: z.boolean(),
    subtitles: z.boolean(),
    catalogs: z.array(catalogKey).max(100),
  })
  .meta({ id: 'httpAddonSelections' })

export type HttpAddonSelections = z.infer<typeof httpAddonSelections>

export const httpAddonErrorKind = z.enum([
  'invalid_url',
  'blocked_address',
  'needs_confirmation',
  'address_changed',
  'unsupported_route',
  'timeout',
  'unavailable',
  'bad_response',
  'unsupported_manifest',
  'rate_limited',
  'busy',
  'not_found',
  'conflict',
])

export type HttpAddonErrorKind = z.infer<typeof httpAddonErrorKind>

export const httpAddonError = z
  .object({
    kind: httpAddonErrorKind,
    message: z.string(),
  })
  .meta({ id: 'httpAddonError' })

export const httpAddonCapabilities = z
  .object({
    name: z.string(),
    stream: z.boolean(),
    subtitles: z.boolean(),
    catalogs: z.array(
      z.object({
        key: catalogKey,
        type: httpAddonType,
        name: z.string(),
      }),
    ),
  })
  .meta({ id: 'httpAddonCapabilities' })

export const httpAddon = z
  .object({
    id: addonId,
    origin: z.string(),
    enabled: z.boolean(),
    selections: httpAddonSelections,
    capabilities: httpAddonCapabilities,
    lanAddresses: z.array(z.string()),
    checkedAt: z.string(),
    checkError: httpAddonErrorKind.nullable(),
  })
  .meta({ id: 'httpAddon' })

export const httpAddonList = z
  .object({
    items: z.array(httpAddon),
  })
  .meta({ id: 'httpAddonList' })

export const httpAddonParams = z.object({ id: addonId })

export const inspectHttpAddon = z
  .object({
    url: manifestUrl.optional(),
    id: addonId.optional(),
  })
  .refine(input => input.url !== undefined || input.id !== undefined)
  .meta({ id: 'inspectHttpAddon' })

export const httpAddonPreview = z
  .object({
    origin: z.string(),
    addresses: z.array(z.string()),
    approvalId: approvalId.optional(),
  })
  .meta({ id: 'httpAddonPreview' })

export const testHttpAddon = inspectHttpAddon
  .safeExtend({
    approvalId: approvalId.optional(),
  })
  .meta({ id: 'testHttpAddon' })

export const createHttpAddon = z
  .object({
    url: manifestUrl,
    approvalId: approvalId.optional(),
    selections: httpAddonSelections.optional(),
  })
  .meta({ id: 'createHttpAddon' })

export const updateHttpAddon = z
  .object({
    url: manifestUrl.optional(),
    approvalId: approvalId.optional(),
    enabled: z.boolean().optional(),
    selections: httpAddonSelections.optional(),
  })
  .meta({ id: 'updateHttpAddon' })

export const recheckHttpAddon = z
  .object({
    approvalId: approvalId.optional(),
  })
  .meta({ id: 'recheckHttpAddon' })
