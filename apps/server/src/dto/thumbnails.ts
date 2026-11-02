import { z } from 'zod'

export const thumbnailSettings = z
  .object({
    automatic: z.boolean(),
    running: z.boolean(),
    total: z.number().int(),
    completed: z.number().int(),
    generated: z.number().int(),
  })
  .meta({ id: 'thumbnailSettings' })

export const updateThumbnailSettings = z
  .object({ automatic: z.boolean() })
  .meta({ id: 'updateThumbnailSettings' })
