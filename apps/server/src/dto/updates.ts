import { z } from 'zod'

export const releaseInfo = z
  .object({
    version: z.string(),
    publishedAt: z.string().optional(),
    url: z.string(),
    // Главное из release notes простым текстом, без разметки
    notes: z.array(z.string()),
    prerelease: z.boolean(),
  })
  .meta({ id: 'releaseInfo' })

export const updateStatusResponse = z
  .object({
    current: z.object({
      version: z.string(),
      commit: z.string().optional(),
    }),
    docsUrl: z.string(),
    enabled: z.boolean(),
    channel: z.enum(['stable', 'beta']),
    // `dev` — сборка без версии релиза, `unsupported` — исходники не на GitHub
    state: z.enum([
      'off',
      'dev',
      'unsupported',
      'unknown',
      'checking',
      'current',
      'available',
      'error',
    ]),
    latest: releaseInfo.optional(),
    checkedAt: z.string().optional(),
    error: z
      .object({
        kind: z.enum(['unavailable', 'rate_limited', 'invalid', 'not_found']),
        at: z.string(),
      })
      .optional(),
  })
  .meta({ id: 'updateStatusResponse' })

export const updateSettingsBody = z
  .object({
    enabled: z.boolean(),
    channel: z.enum(['stable', 'beta']),
  })
  .meta({ id: 'updateSettingsBody' })

export const dismissUpdateBody = z
  .object({ version: z.string().min(1).max(64) })
  .meta({ id: 'dismissUpdateBody' })

// Карточка «Доступна версия» на «Обзоре»
export const overviewUpdate = z
  .object({
    version: z.string(),
    publishedAt: z.string().optional(),
    url: z.string(),
    notes: z.array(z.string()),
    channel: z.enum(['stable', 'beta']),
    docsUrl: z.string(),
  })
  .meta({ id: 'overviewUpdate' })
