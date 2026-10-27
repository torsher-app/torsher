import { z } from 'zod'
import { newPassword, username } from './auth.ts'

export const meResponse = z
  .object({
    id: z.string(),
    username: z.string(),
    createdAt: z.string(),
  })
  .meta({ id: 'meResponse' })

export const changePassword = z
  .object({
    currentPassword: z.string(),
    newPassword,
  })
  .meta({ id: 'changePassword' })

export const changeUsername = z
  .object({
    username,
    currentPassword: z.string(),
  })
  .meta({ id: 'changeUsername' })

// Неверный текущий пароль: панель подсвечивает поле, а не показывает общую ошибку
export const wrongPasswordResponse = z
  .object({
    message: z.string(),
    field: z.literal('currentPassword'),
  })
  .meta({ id: 'wrongPasswordResponse' })
