import { z } from 'zod'
import { profileColors, profileLanguages } from '../db/schema.ts'

// Возраст, с которого тайтлы скрываются на витрине; сертификации регионов
// TMDB сводятся к нему (12+, PG-13, FSK 12 → 12, 13, 12)
export const profileAgeLimits = [6, 12, 16, 18] as const

const ageLimit = z.union(profileAgeLimits.map(age => z.literal(age)))

export const profilePin = z.string().regex(/^\d{4}$/)

export const profileIdParams = z.object({
  id: z.string().min(1).max(100),
})

export const profile = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.enum(profileColors),
    // null — язык устройства
    language: z.enum(profileLanguages).nullable(),
    hasPin: z.boolean(),
    ageLimit: ageLimit.nullable(),
  })
  .meta({ id: 'profile' })

export const profileList = z
  .object({
    items: z.array(profile),
    // Профиль этого зрителя: выбранный на устройстве или по умолчанию
    currentId: z.string(),
    // Профиль выбран на этом устройстве (у владельца — в этом браузере);
    // иначе `currentId` — профиль по умолчанию, и витрина предлагает выбор
    selected: z.boolean(),
  })
  .meta({ id: 'profileList' })

const profileName = z.string().trim().min(1).max(40)

export const createProfile = z
  .object({
    name: profileName,
    color: z.enum(profileColors),
    language: z.enum(profileLanguages).nullable().optional(),
    ageLimit: ageLimit.nullable().optional(),
    pin: profilePin.optional(),
  })
  .meta({ id: 'createProfile' })

export const updateProfile = z
  .object({
    name: profileName.optional(),
    color: z.enum(profileColors).optional(),
    language: z.enum(profileLanguages).nullable().optional(),
    ageLimit: ageLimit.nullable().optional(),
  })
  .meta({ id: 'updateProfile' })

export const setProfilePin = z
  .object({ pin: profilePin })
  .meta({ id: 'setProfilePin' })

export const selectProfile = z
  .object({ pin: profilePin.optional() })
  .meta({ id: 'selectProfile' })

export const deleteProfileQuery = z.object({
  // Профиль, в который переходят позиции и прогресс; без него они удаляются
  moveTo: z.string().min(1).max(100).optional(),
})

export const pinErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum(['wrong_pin', 'locked']),
    // Осталось попыток до блокировки (у `wrong_pin`)
    attemptsLeft: z.number().int().nullable(),
    // Через сколько секунд можно пробовать снова (у `locked`)
    retryAfter: z.number().int().nullable(),
  })
  .meta({ id: 'pinErrorResponse' })
