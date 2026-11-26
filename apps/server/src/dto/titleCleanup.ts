import { z } from 'zod'

const titleId = z.string().regex(/^tmdb:(movie|tv):[1-9]\d{0,14}$/)
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const title = { id: titleId, name: z.string() }
function selection<T extends z.ZodType>(item: T) {
  return z.array(item).min(1).max(50)
}

export const titleCleanupTitles = z
  .object({
    items: z.array(
      z.object({
        ...title,
        libraryBytes: z.number(),
        downloadBytes: z.number().nullable(),
      }),
    ),
  })
  .meta({ id: 'titleCleanupTitles' })

export const titleCleanupSelection = z.object({ titleIds: selection(titleId) })

export const titleCleanupPreview = z
  .object({
    items: z.array(
      z.object({
        ...title,
        files: z.array(
          z.object({
            path: z.string(),
            size: z.number(),
            kind: z.enum(['library', 'download']),
          }),
        ),
        downloads: z.array(z.object({ id: z.string(), name: z.string() })),
        fingerprint: fingerprint.nullable(),
        reason: z
          .enum(['busy', 'private', 'conflict', 'unavailable', 'missing'])
          .nullable(),
      }),
    ),
    reclaimableBytes: z.number().nullable(),
  })
  .meta({ id: 'titleCleanupPreview' })

export const titleCleanupConfirmation = z.object({
  items: selection(z.object({ id: titleId, fingerprint })),
})

export const titleCleanupResult = z
  .object({
    items: z.array(
      z.object({
        id: titleId,
        status: z.enum(['deleted', 'stale', 'blocked', 'partial']),
        operationIds: z.array(z.string()),
      }),
    ),
  })
  .meta({ id: 'titleCleanupResult' })

export type TitleCleanupTitles = z.infer<typeof titleCleanupTitles>
export type TitleCleanupPreview = z.infer<typeof titleCleanupPreview>
export type TitleCleanupConfirmation = z.infer<typeof titleCleanupConfirmation>
export type TitleCleanupResult = z.infer<typeof titleCleanupResult>
