import { z } from 'zod'
import { playbackSettings } from './media.ts'
import { overviewUpdate } from './updates.ts'

export const attentionKinds = [
  'maintenance_failed',
  'maintenance_restore_hold',
  'engine_down',
  'engine_crashed',
  'storage_low',
  'storage_paused',
  'library_copies',
  'library_offline',
  'library_unmatched',
  'library_watcher',
  'indexer_error',
  'indexer_missing',
  'dns_spoofing',
  'host_unreachable',
  'tmdb_key_invalid',
  'media_accel_failed',
  'backup_failed',
  'backup_dir_unavailable',
  'follow_no_space',
  'follow_feed_limited',
] as const

export const attentionSections = [
  'downloads',
  'library',
  'storage',
  'backups',
  'sources',
  'network',
  'metadata',
  'playback',
  'logs',
  'follow',
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
      // Причина: вид недоступности движка, состояние ключа TMDB, сбой копии
      reason: z.string().optional(),
      // Байт: свободно на томе и запас; `need` — сколько нужно копии
      free: z.number().optional(),
      minFree: z.number().optional(),
      need: z.number().optional(),
    }),
  })
  .meta({ id: 'attentionItem' })

export type AttentionItem = z.infer<typeof attentionItem>

export const historyRange = z.enum(['1m', '15m', '1h', '24h', '7d', '14d'])
export type HistoryRange = z.infer<typeof historyRange>

export const loadPoint = z.object({
  time: z.number(),
  cpuPeak: z.number().nullable().optional(),
  cpuCores: z.number().nullable(),
  memoryBytes: z.number().nullable(),
  receiveBps: z.number().nullable(),
  sendBps: z.number().nullable(),
})
export type LoadPoint = z.infer<typeof loadPoint>

export const overviewResponse = z
  .object({
    startedAt: z.string(),
    version: z.string(),
    // Сначала ошибки, затем предупреждения; пусто — всё в порядке
    attention: z.array(attentionItem),
    // Новая версия, пока владелец её не скрыл
    update: overviewUpdate.optional(),
    load: z.object({
      cpuCores: z.number().nullable(),
      cpuCapacity: z.number().nullable(),
      memoryBytes: z.number().nullable(),
      memoryCacheBytes: z.number().nullable(),
      memoryLimit: z.number().nullable(),
      receiveBps: z.number().nullable(),
      sendBps: z.number().nullable(),
      history: z.array(loadPoint),
      historyRange,
      historyStepMs: z.number(),
      historyEnd: z.number(),
      playbackActive: z.boolean(),
      analysis: z
        .object({
          stage: z.enum([
            'credits',
            'fingerprint',
            'matching',
            'waiting',
            'paused',
          ]),
          checked: z.number(),
          total: z.number(),
        })
        .nullable(),
      thumbnails: z
        .object({ checked: z.number(), total: z.number() })
        .nullable(),
    }),
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
    // Ускорение перекодирования; null — первая проверка после старта ещё идёт
    playback: playbackSettings.nullable(),
    // Резервные копии: последняя удачная и есть ли сбой в «Требует внимания»
    backups: z.object({
      enabled: z.boolean(),
      lastSuccessAt: z.string().optional(),
      failing: z.boolean(),
    }),
  })
  .meta({ id: 'overviewResponse' })
