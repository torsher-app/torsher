import { z } from 'zod'
import { importConflictPolicies, importRowStatuses } from '../db/schema.ts'
import { importSources } from '../services/transfer/formats.ts'
import { card, tmdbLanguage } from './catalog.ts'

export const profileImportParams = z.object({
  id: z.string().min(1).max(100),
  importId: z.string().min(1).max(100),
})

export const profileImportRowParams = z.object({
  id: z.string().min(1).max(100),
  rowId: z.string().min(1).max(100),
})

export const createProfileImport = z
  .object({
    files: z
      .array(
        z.object({
          name: z.string().min(1).max(255),
          // Содержимое файла в base64: CSV, JSON или zip
          data: z.string().min(1),
        }),
      )
      .min(1)
      .max(20),
  })
  .meta({ id: 'createProfileImport' })

export const importFormatErrorKinds = [
  'unsupported',
  'broken',
  'tooLarge',
  'tooMany',
  'empty',
] as const

export const importFormatErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum(importFormatErrorKinds),
    // Какой файл не подошёл, если дело в одном
    file: z.string().optional(),
  })
  .meta({ id: 'importFormatErrorResponse' })

export const importPreview = z
  .object({
    sources: z.array(z.enum(importSources)),
    ratings: z.object({
      new: z.number().int(),
      same: z.number().int(),
      conflicts: z.number().int(),
    }),
    watchlist: z.object({
      new: z.number().int(),
      same: z.number().int(),
    }),
    unsure: z.number().int(),
    notFound: z.number().int(),
    // Строки, которые не про тайтл: серии, игры, пустые
    skipped: z.number().int(),
    conflictSamples: z.array(
      z.object({
        titleId: z.string(),
        // Название из файла
        title: z.string(),
        current: z.number().int(),
        incoming: z.number().int(),
      }),
    ),
    conflictsDated: z.boolean(),
  })
  .meta({ id: 'importPreview' })

export const importJob = z
  .object({
    id: z.string(),
    state: z.enum(['matching', 'ready', 'failed']),
    progress: z.object({ done: z.number().int(), total: z.number().int() }),
    // Каталог недоступен: сопоставлять нечем
    error: z.enum(['catalog']).optional(),
    preview: importPreview.optional(),
  })
  .meta({ id: 'importJob' })

export const importSummary = z
  .object({
    imported: z.number().int(),
    unchanged: z.number().int(),
    unmatched: z.number().int(),
  })
  .meta({ id: 'importSummary' })

export const importOverview = z
  .object({
    job: importJob.nullable(),
    last: z
      .object({
        id: z.string(),
        appliedAt: z.iso.datetime(),
        summary: importSummary,
        canUndo: z.boolean(),
      })
      .nullable(),
    unmatched: z.number().int(),
  })
  .meta({ id: 'importOverview' })

export const applyProfileImport = z
  .object({
    conflicts: z.enum(importConflictPolicies),
  })
  .meta({ id: 'applyProfileImport' })

export const appliedImport = importSummary
  .extend({ id: z.string() })
  .meta({ id: 'appliedImport' })

export const undoneImport = z
  .object({
    restored: z.number().int(),
    // Тайтлы, которые меняли после импорта: остались как есть
    kept: z.number().int(),
  })
  .meta({ id: 'undoneImport' })

export const unmatchedImportQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(50),
  language: tmdbLanguage,
})

export const unmatchedImportRow = z
  .object({
    id: z.string(),
    list: z.enum(['rating', 'watchlist']),
    status: z.enum(importRowStatuses),
    title: z.string(),
    year: z.number().int().nullable(),
    kind: z.enum(['movie', 'series']).nullable(),
    rating: z.number().int().nullable(),
    // Похожий тайтл каталога; нет деталей — подсказки нет
    suggestion: card.nullable(),
  })
  .meta({ id: 'unmatchedImportRow' })

export const unmatchedImportRows = z
  .object({
    items: z.array(unmatchedImportRow),
    total: z.number().int(),
  })
  .meta({ id: 'unmatchedImportRows' })

export const matchImportRow = z
  .object({
    titleId: z.string().min(1).max(100),
  })
  .meta({ id: 'matchImportRow' })
