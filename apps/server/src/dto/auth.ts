import { z } from 'zod'

// Одно правило для создания аккаунта, смены и сброса пароля
export const PASSWORD_MIN_LENGTH = 8

export const newPassword = z.string().min(PASSWORD_MIN_LENGTH)

export const signup = z
  .object({
    name: z.string().min(2),
    email: z.email(),
    password: newPassword,
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
