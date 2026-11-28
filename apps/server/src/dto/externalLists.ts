import { z } from 'zod'

export const externalListsErrorCode = z
  .enum([
    'keyRequired',
    'keyRejected',
    'sourceUnavailable',
    'sourceAmbiguous',
    'sourceTooLarge',
    'listLimit',
    'duplicate',
    'retryLater',
    'previewExpired',
    'invalidSource',
    'providerError',
    'notFound',
  ])
  .meta({ id: 'ExternalListsErrorCode' })

export const externalListsErrorResponse = z
  .object({
    message: externalListsErrorCode,
  })
  .meta({ id: 'ExternalListsErrorResponse' })

const id = z.string().min(1).max(128)
const sourceId = z.number().int().positive()
const timestamp = z.number().int().nonnegative().nullable()
const count = z.number().int().nonnegative()
const media = z.enum(['all', 'movie', 'tv'])
const intervalHours = z.union([z.literal(12), z.literal(24), z.literal(48)])
const titleId = z.string().regex(/^tmdb:(?:movie|tv):[1-9]\d*$/)

export const externalListCounts = z
  .object({
    found: count,
    added: count,
    existing: count,
    handled: count,
    excluded: count,
    restricted: count,
    watched: count,
    unmatched: count,
    pending: count,
    deferred: count,
  })
  .meta({ id: 'ExternalListCounts' })

export const externalListLastResult = z
  .object({
    status: z.enum(['complete', 'partial', 'error']),
    counts: externalListCounts.nullable(),
    error: externalListsErrorCode.nullable(),
  })
  .meta({ id: 'ExternalListLastResult' })

export const externalList = z
  .object({
    id,
    sourceId,
    name: z.string(),
    profileId: id,
    media,
    intervalHours,
    paused: z.boolean(),
    running: z.boolean(),
    lastAttemptAt: timestamp,
    lastReadAt: timestamp,
    nextRunAt: timestamp,
    lastResult: externalListLastResult.nullable(),
  })
  .meta({ id: 'ExternalList' })

export const externalListSettings = z
  .object({
    hasKey: z.boolean(),
    keyRejected: z.boolean(),
    lists: z.array(externalList),
  })
  .meta({ id: 'ExternalListSettings' })

export const updateExternalListKey = z
  .object({
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[\x21-\x7E]+$/)
      .nullable(),
  })
  .meta({ id: 'UpdateExternalListKey' })

export const externalListPreviewInput = z
  .object({
    source: z.string().trim().min(1).max(512),
    profileId: id,
    media,
    intervalHours,
    listId: id.optional(),
  })
  .meta({ id: 'ExternalListPreviewInput' })

export const externalListPreviewToken = z.object({ token: id }).meta({
  id: 'ExternalListPreviewToken',
})

export const externalListPreviewJob = z
  .object({
    token: id,
    status: z.enum(['pending', 'ready', 'error']),
    preview: z
      .object({
        name: z.string(),
        sourceId,
        profileId: id,
        counts: externalListCounts,
        items: z.array(z.object({ titleId, title: z.string() })),
      })
      .optional(),
    error: externalListsErrorCode.optional(),
  })
  .meta({ id: 'ExternalListPreviewJob' })

export const externalListParams = z.object({ listId: id })

export const updateExternalList = z
  .object({
    paused: z.boolean(),
  })
  .meta({ id: 'UpdateExternalList' })

export const externalListExclusionsQuery = z.object({
  profileId: id,
  offset: z
    .string()
    .regex(/^\d{1,8}$/)
    .optional(),
})

export const externalListExclusion = z
  .object({
    profileId: id,
    titleId,
  })
  .meta({ id: 'ExternalListExclusion' })

export const externalListExclusions = z
  .object({
    items: z.array(z.object({ titleId, title: z.string().nullable() })),
    nextOffset: count.nullable(),
  })
  .meta({ id: 'ExternalListExclusions' })

export type ExternalListsErrorCode = z.infer<typeof externalListsErrorCode>
export type ExternalListCounts = z.infer<typeof externalListCounts>
export type ExternalListLastResult = z.infer<typeof externalListLastResult>
export type ExternalListWire = z.infer<typeof externalList>
export type ExternalListPreviewInput = z.infer<typeof externalListPreviewInput>
export type ExternalListPreviewJob = z.infer<typeof externalListPreviewJob>
