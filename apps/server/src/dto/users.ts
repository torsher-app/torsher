import { z } from 'zod'
import { newPassword } from './auth.ts'

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

export const changePassword = z
  .object({
    currentPassword: z.string(),
    newPassword,
  })
  .meta({ id: 'changePassword' })

export const changeEmail = z
  .object({
    email: z.email(),
    currentPassword: z.string(),
  })
  .meta({ id: 'changeEmail' })

// Неверный текущий пароль: панель подсвечивает поле, а не показывает общую ошибку
export const wrongPasswordResponse = z
  .object({
    message: z.string(),
    field: z.literal('currentPassword'),
  })
  .meta({ id: 'wrongPasswordResponse' })
