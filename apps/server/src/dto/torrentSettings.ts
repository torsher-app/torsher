import { z } from 'zod'
import { seedModes } from '../db/schema.ts'
import { encryptionModes, restartKeys } from '../services/torrents/settings.ts'

// 10 ГБ/с — больше любого домашнего канала; дальше — опечатка
const MAX_SPEED = 10_000_000_000
// Десять лет в минутах
const MAX_SEED_MINUTES = 5_256_000

export const seedRule = z
  .object({
    mode: z.enum(seedModes),
    ratio: z.number().min(0.1).max(100).optional(),
    minutes: z.number().int().min(1).max(MAX_SEED_MINUTES).optional(),
  })
  .refine(rule => rule.mode !== 'ratio' || rule.ratio !== undefined, {
    message: 'ratio is required',
    path: ['ratio'],
  })
  .refine(rule => rule.mode !== 'time' || rule.minutes !== undefined, {
    message: 'minutes is required',
    path: ['minutes'],
  })
  .meta({ id: 'seedRule' })

const values = z.object({
  // Байт в секунду, 0 — без лимита
  downloadLimit: z.number().int().min(0).max(MAX_SPEED),
  uploadLimit: z.number().int().min(0).max(MAX_SPEED),
  // 0 — без очереди
  activeDownloads: z.number().int().min(0).max(100),
  seedRule,
  seedCache: z.boolean(),
  connsPerTorrent: z.number().int().min(1).max(1000),
  // 0 — без общего предела
  connsTotal: z.number().int().min(0).max(10_000),
  peerPort: z.number().int().min(1024).max(65_535),
  upnp: z.boolean(),
  dht: z.boolean(),
  pex: z.boolean(),
  encryption: z.enum(encryptionModes),
})

export const torrentSettingValues = values.meta({ id: 'torrentSettingValues' })

/** Каждая карточка панели сохраняет только свои поля */
export const updateTorrentSettings = values
  .partial()
  .refine(body => Object.keys(body).length > 0, {
    message: 'Nothing to save',
  })
  .meta({ id: 'updateTorrentSettings' })

export const torrentSettingKeys = z.enum(
  Object.keys(values.shape) as [
    keyof typeof values.shape,
    ...(keyof typeof values.shape)[],
  ],
)

export const torrentSettings = z
  .object({
    values: torrentSettingValues,
    defaults: torrentSettingValues,
    // Поля, которые владелец сохранил сам
    custom: z.array(torrentSettingKeys),
    // Порт пиров из `ENGINE_PEER_PORT`: его публикует compose
    peerPortEnv: z.number().nullable(),
    // Сохранено, но действует только после перезапуска движка
    pendingRestart: z.array(z.enum(restartKeys)),
    // Почему перезапуск сейчас недоступен: движок не запущен или переносит раздачи
    restartBlocked: z.enum(['not_running', 'moving']).nullable(),
    // Сколько раздач сейчас смотрят: перезапуск прервёт просмотр
    activeStreams: z.number(),
  })
  .meta({ id: 'torrentSettings' })

export const restartBlockedResponse = z
  .object({
    message: z.string(),
    reason: z.enum(['not_running', 'moving']),
  })
  .meta({ id: 'restartBlockedResponse' })
