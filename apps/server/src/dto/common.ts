import { z } from 'zod'

export const messageResponse = z
  .object({
    message: z.string(),
  })
  .meta({ id: 'messageResponse' })
