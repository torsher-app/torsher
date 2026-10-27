import * as z from 'zod'

/** Правило как у DTO сервера: 2–64 символа после обрезки, без управляющих */
export function usernameSchema(message: string) {
  return z
    .string()
    .trim()
    .min(2, message)
    .max(64, message)
    .regex(/^\P{Cc}+$/u, message)
}
