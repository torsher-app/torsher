import { z } from 'zod'

export const aboutResponse = z
  .object({
    version: z.string(),
    // Есть только у собранного образа: в разработке коммит не передаётся
    commit: z.string().optional(),
    license: z.string(),
    sourceUrl: z.url(),
    // Оценки IMDb включены: их условия требуют указать источник
    imdbAttribution: z.boolean(),
  })
  .meta({ id: 'aboutResponse' })
