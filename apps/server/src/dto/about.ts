import { z } from 'zod'

export const aboutResponse = z
  .object({
    version: z.string(),
    // Есть только у собранного образа: в разработке коммит не передаётся
    commit: z.string().optional(),
    license: z.string(),
    sourceUrl: z.url(),
  })
  .meta({ id: 'aboutResponse' })
