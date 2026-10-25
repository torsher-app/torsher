import { z } from 'zod'

export const messageResponse = z
  .object({
    message: z.string(),
  })
  .meta({ id: 'messageResponse' })

export const tooManyAttemptsResponse = z
  .object({
    message: z.literal('too_many_attempts'),
    // Через сколько секунд можно пробовать снова; то же в заголовке Retry-After
    retryAfter: z.number().int(),
  })
  .meta({ id: 'tooManyAttemptsResponse' })
