import { z } from 'zod'
import { importConflictPolicies } from '../db/schema.ts'
import { newPassword } from './auth.ts'
import { exportDocument } from '../services/transfer/document.ts'

// Пароль экспорта шифрует только секреты; правила — как у пароля копии
const exportPassword = newPassword.max(1024)

export const createExport = z
  .object({
    scope: z.enum(['server', 'profile']),
    profileId: z.string().min(1).max(100).optional(),
    include: z
      .object({
        collections: z.boolean(),
        libraries: z.boolean(),
        settings: z.boolean(),
      })
      .partial()
      .optional(),
    // Без пароля секретов в файле нет; пароль имеет смысл только с настройками
    password: exportPassword.optional(),
  })
  .meta({ id: 'createExport' })

export const exportFile = exportDocument.meta({ id: 'exportFile' })

export const transferErrorKinds = [
  'notExport',
  'newerVersion',
  'broken',
  'tooLarge',
] as const

export const transferErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum(transferErrorKinds),
  })
  .meta({ id: 'transferErrorResponse' })

export const previewServerImportBody = z
  .object({
    // Файл экспорта в base64: JSON или gzip
    data: z.string().min(1),
    password: z.string().min(1).max(1024).optional(),
  })
  .meta({ id: 'previewServerImport' })

const newSame = z.object({ new: z.number().int(), same: z.number().int() })
const newExisting = z.object({
  new: z.number().int(),
  existing: z.number().int(),
})

export const profileMergeCounts = z
  .object({
    progress: z.object({
      new: z.number().int(),
      updated: z.number().int(),
      same: z.number().int(),
    }),
    ratings: z.object({
      new: z.number().int(),
      same: z.number().int(),
      conflicts: z.number().int(),
    }),
    watchlist: newSame,
    favorites: newSame,
    dropped: newSame,
    skipped: z.number().int(),
    conflictSamples: z.array(
      z.object({
        titleId: z.string(),
        title: z.string(),
        current: z.number().int(),
        incoming: z.number().int(),
      }),
    ),
    conflictsDated: z.boolean(),
  })
  .meta({ id: 'profileMergeCounts' })

export const serverImportPreview = z
  .object({
    token: z.string(),
    exportedAt: z.iso.datetime(),
    // Версия Torsher, снявшая файл
    version: z.string(),
    profiles: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        // Куда по умолчанию: профиль сервера с тем же именем или новый
        target: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('existing'), id: z.string() }),
          z.object({ kind: z.literal('new') }),
          z.object({ kind: z.literal('skip') }),
        ]),
        counts: profileMergeCounts,
      }),
    ),
    collections: z
      .object({ new: z.number().int(), merged: z.number().int() })
      .optional(),
    voices: z.number().int(),
    aliases: z.number().int(),
    libraries: z
      .object({
        folders: newExisting,
        // Пути, которых нет на этом сервере: папки добавятся «недоступными»
        missingFolders: z.array(z.string()),
        decisions: z.number().int(),
      })
      .optional(),
    settings: z
      .object({
        routes: newExisting,
        managers: newExisting,
        indexers: newExisting,
        channels: newExisting,
        tmdbKey: z.boolean(),
      })
      .optional(),
    // `locked` — в файле есть секреты, нужен пароль; `wrong` — не подошёл
    secrets: z.enum(['none', 'locked', 'wrong', 'ok']),
  })
  .meta({ id: 'serverImportPreview' })

export const applyServerImportBody = z
  .object({
    token: z.string().min(1).max(100),
    // Ключ профиля в файле → ID профиля сервера, `new` или `skip`
    mapping: z.record(z.string(), z.string().min(1).max(100)),
    conflicts: z.enum(importConflictPolicies),
  })
  .meta({ id: 'applyServerImport' })

export const serverImportResult = z
  .object({
    backup: z.string().nullable(),
    profiles: z.object({
      created: z.number().int(),
      merged: z.number().int(),
      changed: z.number().int(),
    }),
    collections: z.number().int(),
    settings: z.number().int(),
    folders: z.number().int(),
    decisions: z.number().int(),
    skipped: z.number().int(),
  })
  .meta({ id: 'serverImportResult' })
