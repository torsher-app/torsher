import { z } from 'zod'

// Одно правило для создания аккаунта, смены и сброса пароля
export const PASSWORD_MIN_LENGTH = 8

export const newPassword = z.string().min(PASSWORD_MIN_LENGTH)

// Логин и имя в панели: любые буквы и пробелы внутри, без управляющих символов
export const username = z
  .string()
  .trim()
  .normalize('NFC')
  .min(2)
  .max(64)
  .regex(/^\P{Cc}+$/u)

export const signup = z
  .object({
    username,
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
    username: z.string(),
    password: z.string(),
  })
  .meta({ id: 'signin' })
