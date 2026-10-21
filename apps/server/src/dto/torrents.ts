import { z } from 'zod'
import {
  torrentErrors,
  torrentSources,
  torrentStatuses,
} from '../db/schema.ts'

// `.torrent` больших паков весит единицы мегабайт; base64 длиннее на треть
export const TORRENT_FILE_MAX_BYTES = 8 * 1024 * 1024

export const engineUnavailableKinds = [
  'not_installed',
  'starting',
  'stopped',
] as const

/** Движок недоступен: `kind` клиент переводит в понятный текст */
export const engineUnavailableResponse = z
  .object({
    message: z.string(),
    kind: z.enum(engineUnavailableKinds),
  })
  .meta({ id: 'engineUnavailableResponse' })

export const torrentIdParams = z.object({
  id: z.string().min(1).max(100),
})

export const torrentFile = z
  .object({
    // Индекс файла в раздаче — тот же, что у движка
    index: z.number(),
    path: z.string(),
    size: z.number(),
    isVideo: z.boolean(),
  })
  .meta({ id: 'torrentFile' })

export const torrent = z
  .object({
    id: z.string(),
    infoHash: z.string(),
    name: z.string(),
    source: z.enum(torrentSources),
    status: z.enum(torrentStatuses),
    error: z.enum(torrentErrors).nullable(),
    // Без файлов-выравнивания; пусто, пока не пришли метаданные magnet
    files: z.array(torrentFile),
    totalSize: z.number(),
    addedAt: z.string(),
    lastAccessAt: z.string().nullable(),
  })
  .meta({ id: 'torrent' })

export const torrentList = z
  .object({
    items: z.array(torrent),
    // Список живёт и без движка, но добавить и смотреть без него нельзя
    engine: z.enum(['ready', ...engineUnavailableKinds]),
  })
  .meta({ id: 'torrentList' })

export const createTorrent = z
  .object({
    magnet: z
      .string()
      .trim()
      .max(20_000)
      .regex(/^magnet:\?/i)
      .optional(),
    // Содержимое `.torrent` в base64
    torrentFile: z
      .base64()
      .max(Math.ceil(TORRENT_FILE_MAX_BYTES / 3) * 4)
      .optional(),
  })
  .refine(
    body => (body.magnet === undefined) !== (body.torrentFile === undefined),
    { message: 'Pass either a magnet link or a torrent file' },
  )
  .meta({ id: 'createTorrent' })

export const torrentStatsQuery = z.object({
  fileIndex: z.string().regex(/^\d{1,5}$/),
  // Позиция чтения в байтах от начала файла
  offset: z
    .string()
    .regex(/^\d{1,16}$/)
    .optional(),
})

export const torrentStats = z
  .object({
    // `idle` — раздача ещё не в движке (файл не начинали смотреть)
    activity: z.enum(['idle', 'downloading']),
    // Движок не отличает сидов от пиров: `found` — известные, `connected` — подключённые
    peers: z.object({ connected: z.number(), found: z.number() }),
    // Байт в секунду
    downloadSpeed: z.number(),
    uploadSpeed: z.number(),
    file: z.object({
      size: z.number(),
      downloaded: z.number(),
      // Скачано подряд от позиции чтения, байт
      bufferedAhead: z.number(),
    }),
  })
  .meta({ id: 'torrentStats' })
