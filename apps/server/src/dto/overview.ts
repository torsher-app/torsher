import { z } from 'zod'

export const attentionKinds = [
  'engine_down',
  'storage_low',
  'storage_paused',
  'indexer_error',
  'indexer_missing',
  'dns_spoofing',
  'host_unreachable',
  'tmdb_key_invalid',
] as const

export const attentionSections = [
  'downloads',
  'storage',
  'sources',
  'network',
  'metadata',
] as const

export const attentionItem = z
  .object({
    kind: z.enum(attentionKinds),
    severity: z.enum(['error', 'warning']),
    // Раздел панели, где проблема чинится
    section: z.enum(attentionSections),
    params: z.object({
      // Сколько элементов с этой проблемой; у одного — его имя
      count: z.number().optional(),
      name: z.string().optional(),
      // Причина: вид недоступности движка, состояние ключа TMDB
      reason: z.string().optional(),
      // Байт: свободно на томе и запас
      free: z.number().optional(),
      minFree: z.number().optional(),
    }),
  })
  .meta({ id: 'attentionItem' })

export type AttentionItem = z.infer<typeof attentionItem>

export const overviewResponse = z
  .object({
    startedAt: z.string(),
    version: z.string(),
    // Сначала ошибки, затем предупреждения; пусто — всё в порядке
    attention: z.array(attentionItem),
    downloads: z.object({
      total: z.number(),
      // Качаются сейчас, в том числе без пиров
      active: z.number(),
      downloadSpeed: z.number(),
      uploadSpeed: z.number(),
    }),
    storage: z.object({
      usedByCache: z.number(),
      cacheLimit: z.number(),
      free: z.number(),
      total: z.number(),
      minFree: z.number(),
    }),
    // Включённые индексаторы и из них работающие по последней проверке
    sources: z.object({ ok: z.number(), total: z.number() }),
    devices: z.object({ total: z.number(), watching: z.number() }),
  })
  .meta({ id: 'overviewResponse' })
