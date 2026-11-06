import { z } from 'zod'

export const aboutResponse = z
  .object({
    version: z.string(),
    // Есть только у собранного образа: в разработке коммит не передаётся
    commit: z.string().optional(),
    devStand: z
      .object({
        name: z.string(),
        branch: z.string().optional(),
        snapshot: z.string().optional(),
        builtAt: z.string().optional(),
        dirty: z.boolean(),
      })
      .optional(),
    license: z.string(),
    sourceUrl: z.url(),
    // Оценки IMDb включены: их условия требуют указать источник
    imdbAttribution: z.boolean(),
  })
  .meta({ id: 'aboutResponse' })
