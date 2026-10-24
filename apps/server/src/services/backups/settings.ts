import type { KeyMaterial } from './crypto.ts'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { decryptSecret, encryptSecret } from '../secrets/index.ts'
import { getSetting, setSetting } from '../settings/index.ts'
import { logFor } from '../logs/index.ts'
import { deriveKeyMaterial } from './crypto.ts'
import { BackupError } from './errors.ts'
import { updateBackupState } from './state.ts'

export const BACKUP_SETTINGS_KEY = 'backups'

export const backupTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)

const encryptionSchema = z.object({
  mode: z.enum(['key', 'password']),
  // Ключ, выведенный из пароля, — шифртекстом ключа секретов: пароль сервер не хранит
  keyMaterial: z.string().optional(),
  setAt: z.string().optional(),
})

export const backupSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  time: backupTime.default('04:00'),
  keepDaily: z.number().int().min(1).max(30).default(7),
  keepWeekly: z.number().int().min(0).max(12).default(4),
  dir: z
    .string()
    .refine(value => isAbsolute(value))
    .optional(),
  encryption: encryptionSchema.default({ mode: 'key' }),
})

export type BackupSettings = z.infer<typeof backupSettingsSchema>

export const defaultBackupSettings = backupSettingsSchema.parse({})

/** Нет записи — значения по умолчанию: обновлённый сервер копирует без настройки */
export function parseBackupSettings(raw: unknown): BackupSettings {
  if (raw === undefined || raw === null)
    return defaultBackupSettings

  const parsed = backupSettingsSchema.safeParse(raw)

  if (parsed.success)
    return parsed.data

  logFor('backups').warn(
    { issues: parsed.error.issues.length },
    'Backup settings are invalid, using defaults',
  )

  return defaultBackupSettings
}

export function getBackupSettings() {
  return parseBackupSettings(getSetting(BACKUP_SETTINGS_KEY))
}

export interface BackupSettingsPatch {
  enabled?: boolean
  time?: string
  keepDaily?: number
  keepWeekly?: number
  /** `null` — вернуть каталог по умолчанию */
  dir?: string | null
}

/** Каталог проверяет вызывающий (`checkBackupDir`): здесь только запись */
export function saveBackupSettings(patch: BackupSettingsPatch) {
  const current = getBackupSettings()
  const { dir, ...rest } = patch
  const next = backupSettingsSchema.parse({
    ...current,
    ...rest,
    dir: dir === null ? undefined : (dir ?? current.dir),
  })

  setSetting(BACKUP_SETTINGS_KEY, next)

  // Только что включённые копии не тревожат давностью прежней копии
  if (!current.enabled && next.enabled)
    updateBackupState({ watchSince: new Date().toISOString() })

  return next
}

export async function setBackupPassword(password: string, now = new Date()) {
  const material = await deriveKeyMaterial(password)
  const current = getBackupSettings()
  const next: BackupSettings = {
    ...current,
    encryption: {
      mode: 'password',
      keyMaterial: encryptSecret(JSON.stringify(material)),
      setAt: now.toISOString(),
    },
  }

  setSetting(BACKUP_SETTINGS_KEY, next)

  return next
}

export function clearBackupPassword() {
  const next: BackupSettings = {
    ...getBackupSettings(),
    encryption: { mode: 'key' },
  }

  setSetting(BACKUP_SETTINGS_KEY, next)

  return next
}

/**
 * Ключ для плановых копий под паролем. `decrypt` — расшифровка ключом
 * секретов: в процессе сервера своя, в команде и перед миграциями — ключом
 * из файла каталога данных.
 */
export function keyMaterialOf(
  settings: BackupSettings,
  decrypt: (ciphertext: string) => string = decryptSecret,
): KeyMaterial | undefined {
  const { mode, keyMaterial } = settings.encryption

  if (mode !== 'password' || !keyMaterial)
    return undefined

  // Ключ секретов сменился: копию под паролем без него не зашифровать
  try {
    return JSON.parse(decrypt(keyMaterial)) as KeyMaterial
  }
  catch (err) {
    throw new BackupError('key_unavailable', {}, { cause: err })
  }
}
