import { z } from 'zod'
import { BACKUP_DIR_PROBLEMS } from '../services/backups/dir.ts'
import { BACKUP_ERROR_KINDS } from '../services/backups/errors.ts'
import { BACKUP_REASONS } from '../services/backups/names.ts'
import { newPassword } from './auth.ts'

// Цифры к причине: `need`/`free` у нехватки места, версия у копии новее сервера
const errorParams = z.record(z.string(), z.union([z.string(), z.number()]))

const backupError = z.object({
  kind: z.string(),
  params: errorParams,
})

export const backupItem = z
  .object({
    name: z.string(),
    reason: z.enum(BACKUP_REASONS),
    createdAt: z.string(),
    version: z.string(),
    size: z.number(),
    encrypted: z.boolean(),
    // `fallback` — копия перед обновлением в каталоге по умолчанию: выбранный был недоступен
    dirKind: z.enum(['main', 'fallback']),
  })
  .meta({ id: 'backupItem' })

export const restoreWarning = z
  .object({
    // `secret_mismatch`, `no_secret_key`, `downloads_unavailable`, `torrents_reconciled`
    kind: z.string(),
    params: errorParams.optional(),
  })
  .meta({ id: 'restoreWarning' })

export const restoreStatus = z
  .object({
    state: z.enum(['checking', 'pending', 'done', 'failed']),
    backup: z.string().optional(),
    at: z.string().optional(),
    // Причина отказа: вид ошибки копии или шага подмены на старте
    reason: z.string().optional(),
    params: errorParams.optional(),
    warnings: z.array(restoreWarning),
  })
  .meta({ id: 'restoreStatus' })

export const backupStatus = z
  .object({
    settings: z.object({
      enabled: z.boolean(),
      time: z.string(),
      keepDaily: z.number().int(),
      keepWeekly: z.number().int(),
      mode: z.enum(['key', 'password']),
      // Когда задан пароль: старые копии закрыты прежним
      passwordSetAt: z.string().optional(),
    }),
    dir: z.object({
      path: z.string(),
      source: z.enum(['default', 'panel']),
      available: z.boolean(),
      free: z.number().optional(),
      total: z.number().optional(),
      sameVolumeAsDatabase: z.boolean(),
    }),
    state: z.object({
      running: z
        .object({ reason: z.enum(BACKUP_REASONS), startedAt: z.string() })
        .optional(),
      lastSuccessAt: z.string().optional(),
      // Последняя плановая попытка
      lastAttempt: z
        .object({ at: z.string(), error: backupError.optional() })
        .optional(),
      // Итог последней ручной копии в этом запуске сервера
      manual: z
        .object({ at: z.string(), error: backupError.optional() })
        .optional(),
      nextAt: z.string().optional(),
      // Часовой пояс сервера: время расписания — по нему
      timezone: z.string(),
    }),
    restore: restoreStatus.optional(),
    items: z.array(backupItem),
  })
  .meta({ id: 'backupStatus' })

export const updateBackupSettings = z
  .object({
    enabled: z.boolean(),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    keepDaily: z.number().int().min(1).max(30),
    keepWeekly: z.number().int().min(0).max(12),
    // Без поля — каталог как был; null — каталог по умолчанию
    dir: z.string().min(1).max(4096).nullable().optional(),
  })
  .meta({ id: 'updateBackupSettings' })

export const updateBackupEncryption = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('key') }),
    z.object({ mode: z.literal('password'), password: newPassword.max(1024) }),
  ])
  .meta({ id: 'updateBackupEncryption' })

export const backupDirCheckBody = z
  .object({ path: z.string().min(1).max(4096) })
  .meta({ id: 'backupDirCheckBody' })

export const backupDirCheck = z
  .object({
    path: z.string(),
    // Почему каталог нельзя выбрать; null — можно
    problem: z.enum(BACKUP_DIR_PROBLEMS).nullable(),
    free: z.number(),
    total: z.number(),
    sameVolumeAsDatabase: z.boolean(),
  })
  .meta({ id: 'backupDirCheck' })

export const backupNameParams = z.object({ name: z.string() })

export const backupUploadQuery = z.object({
  // Исходное имя файла: по шаблону копии берутся её время и версия
  name: z.string().max(255).optional(),
})

export const restoreBackupBody = z
  .object({ password: z.string().max(1024).optional() })
  .meta({ id: 'restoreBackupBody' })

export const restoreResponse = z
  .object({ restore: restoreStatus })
  .meta({ id: 'restoreResponse' })

// Состояние восстановления без остального: экран создания аккаунта и опрос после перезапуска
export const restoreStateResponse = z
  .object({ restore: restoreStatus.optional() })
  .meta({ id: 'restoreStateResponse' })

export const backupErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum([...BACKUP_ERROR_KINDS, ...BACKUP_DIR_PROBLEMS]),
    params: errorParams.optional(),
    // Поле формы, к которому относится отказ
    field: z.string().optional(),
  })
  .meta({ id: 'backupErrorResponse' })
