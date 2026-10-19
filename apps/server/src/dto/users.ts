import { z } from 'zod'

export const updateMe = z
  .object({
    name: z.string().min(2).optional(),
  })
  .meta({ id: 'updateMe' })

export const meResponse = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    isActive: z.boolean(),
    createdAt: z.string(),
  })
  .meta({ id: 'meResponse' })
