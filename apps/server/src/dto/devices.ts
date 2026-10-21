import { z } from 'zod'
import { deviceTypes, profileColors } from '../db/schema.ts'

export const deviceIdParams = z.object({
  id: z.string().min(1).max(100),
})

export const startPairing = z
  .object({
    // Без типа сервер определяет его по `User-Agent`
    type: z.enum(deviceTypes).optional(),
  })
  .meta({ id: 'startPairing' })

export const pairing = z
  .object({
    // Знает только устройство: по нему оно опрашивает статус
    secret: z.string(),
    // Показывается на экране, его вводит владелец в панели
    code: z.string(),
    expiresAt: z.string(),
  })
  .meta({ id: 'pairing' })

export const pairingSecretParams = z.object({
  secret: z.string().regex(/^[0-9a-f]{64}$/),
})

export const pairingStatus = z
  .object({
    status: z.enum(['pending', 'approved', 'expired']),
    expiresAt: z.string(),
    // У `approved`: устройство создано, cookie поставлен в этом ответе
    device: z.object({ id: z.string(), name: z.string() }).nullable(),
  })
  .meta({ id: 'pairingStatus' })

export const deviceName = z.string().trim().min(1).max(60)

export const confirmPairing = z
  .object({
    code: z.string().trim().min(1).max(20),
    name: deviceName,
  })
  .meta({ id: 'confirmPairing' })

export const confirmedPairing = z
  .object({
    name: z.string(),
    type: z.enum(deviceTypes),
  })
  .meta({ id: 'confirmedPairing' })

export const pairingErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum(['invalid', 'expired']),
  })
  .meta({ id: 'pairingErrorResponse' })

export const device = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(deviceTypes),
    // null — профиль на устройстве ещё не выбран
    profile: z
      .object({
        id: z.string(),
        name: z.string(),
        color: z.enum(profileColors),
      })
      .nullable(),
    address: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
    lastSeenAt: z.string().nullable(),
    // Поток с устройства был меньше минуты назад
    watching: z.boolean(),
  })
  .meta({ id: 'device' })

export const deviceList = z
  .object({ items: z.array(device) })
  .meta({ id: 'deviceList' })

export const updateDevice = z
  .object({ name: deviceName })
  .meta({ id: 'updateDevice' })
