import { z } from 'zod'
import { indexerCheckStatuses, indexerManagerKinds } from '../db/schema.ts'

const httpUrl = z.url({ protocol: /^https?$/ }).max(2000)
const indexerName = z.string().trim().min(1).max(100)
// Ключи только на вход: ни один ответ их не содержит
const apiKey = z.string().trim().min(1).max(500)

export const sourceErrorKinds = [
  'auth',
  'timeout',
  'unreachable',
  'bad_response',
  'remote',
  'unsupported',
] as const

/** Проверка источника не прошла: `kind` клиент переводит в понятный текст */
export const sourceErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum(sourceErrorKinds),
  })
  .meta({ id: 'sourceErrorResponse' })

export const idParams = z.object({
  id: z.string().min(1).max(100),
})

const searchModes = z.object({
  search: z.boolean(),
  tvSearch: z.boolean(),
  movieSearch: z.boolean(),
})

export const indexer = z
  .object({
    id: z.string(),
    name: z.string(),
    // Адрес Torznab без query: ключ в нём не передаётся
    url: z.string(),
    hasApiKey: z.boolean(),
    enabled: z.boolean(),
    managerId: z.string().nullable(),
    managerKind: z.enum(indexerManagerKinds).nullable(),
    // Менеджер больше не отдаёт этот индексатор
    missing: z.boolean(),
    // Верхнеуровневые категории из caps; пусто — ещё не проверялся
    categories: z.array(z.object({ id: z.number(), name: z.string() })),
    searchModes: searchModes.nullable(),
    checkStatus: z.enum(indexerCheckStatuses).nullable(),
    checkedAt: z.string().nullable(),
  })
  .meta({ id: 'indexer' })

export const indexerList = z
  .object({ items: z.array(indexer) })
  .meta({ id: 'indexerList' })

export const createIndexer = z
  .object({
    name: indexerName,
    url: httpUrl,
    apiKey: apiKey.optional(),
  })
  .meta({ id: 'createIndexer' })

export const updateIndexer = z
  .object({
    name: indexerName.optional(),
    enabled: z.boolean().optional(),
    apiKey: apiKey.optional(),
  })
  .meta({ id: 'updateIndexer' })

export const indexerManager = z
  .object({
    id: z.string(),
    kind: z.enum(indexerManagerKinds),
    url: z.string(),
    syncedAt: z.string().nullable(),
    indexerCount: z.number().int(),
    missingCount: z.number().int(),
  })
  .meta({ id: 'indexerManager' })

export const indexerManagerList = z
  .object({ items: z.array(indexerManager) })
  .meta({ id: 'indexerManagerList' })

export const createIndexerManager = z
  .object({
    kind: z.enum(indexerManagerKinds),
    url: httpUrl,
    apiKey,
  })
  .meta({ id: 'createIndexerManager' })

export const indexerManagerSyncResult = z
  .object({
    manager: indexerManager,
    added: z.number().int(),
    updated: z.number().int(),
    missing: z.number().int(),
  })
  .meta({ id: 'indexerManagerSyncResult' })

export const deleteIndexerManagerQuery = z.object({
  // keep — индексаторы остаются ручными, delete — удаляются с менеджером
  indexers: z.enum(['keep', 'delete']).default('keep'),
})
