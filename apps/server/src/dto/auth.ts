import { z } from 'zod'

export const signup = z
  .object({
    name: z.string().min(2),
    email: z.email(),
    password: z.string().min(8),
  })
  .meta({ id: 'signup' })

export const setupResponse = z
  .object({
    // Аккаунта ещё нет: панель предлагает создать аккаунт владельца
    needsSetup: z.boolean(),
  })
  .meta({ id: 'setupResponse' })

export const signin = z
  .object({
    email: z.email(),
    password: z.string(),
  })
  .meta({ id: 'signin' })
