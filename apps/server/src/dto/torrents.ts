import { z } from 'zod'
import { seedRule } from './torrentSettings.ts'
import {
  torrentErrors,
  torrentMatchStatuses,
  torrentPauseReasons,
  torrentRetentions,
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

export const downloadStates = [
  'idle',
  'partial',
  'queued',
  'downloading',
  'stalled',
  'seeding',
  'complete',
  'paused',
] as const

export const torrentFile = z
  .object({
    // Индекс файла в раздаче — тот же, что у движка
    index: z.number(),
    path: z.string(),
    size: z.number(),
    isVideo: z.boolean(),
    downloaded: z.number(),
    // Качается целиком (выбран для скачивания или его смотрели)
    selected: z.boolean(),
    // Владелец поднял файл вперёд порядка закачки
    first: z.boolean(),
    // Движок качает файл раньше остальных выбранных: по порядку серий или поднятый
    downloadingFirst: z.boolean(),
    // Лежит в своей раскладке библиотеки
    inLibrary: z.boolean(),
  })
  .meta({ id: 'torrentFile' })

const peers = z.object({ connected: z.number(), found: z.number() })

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
    // Каталожный ID тайтла: раздачу выбрали из карточки, её узнали по имени
    // или тайтл выбрал владелец
    titleId: z.string().nullable(),
    // Распознавание по имени; null — тайтл из карточки или ещё распознаётся
    matchStatus: z.enum(torrentMatchStatuses).nullable(),
    // `unsure`: на какой тайтл похоже, подтвердить его — владелец
    matchSuggestion: z.string().nullable(),
    retention: z.enum(torrentRetentions),
    // Файлы раздачи лежат в библиотеке, и выбранное видео — всё
    inLibrary: z.boolean(),
    pauseReason: z.enum(torrentPauseReasons).nullable(),
    state: z.enum(downloadStates),
    // Файл раздачи сейчас смотрят
    streaming: z.boolean(),
    // Выбранные файлы: размер и сколько скачано
    progress: z.object({ downloaded: z.number(), wanted: z.number() }),
    // Занято на диске, включая прочитанное потоком вне выбора
    sizeOnDisk: z.number(),
    // Байт в секунду
    downloadSpeed: z.number(),
    uploadSpeed: z.number(),
    peers,
    seeding: z.object({
      // Своё правило загрузки; null — как в настройках
      rule: seedRule.nullable(),
      // Действующее правило закреплённой загрузки; у кэша — null
      effective: seedRule.nullable(),
      // Отдано за всё время, байт
      uploaded: z.number(),
      ratio: z.number().nullable(),
      // Почему раздача больше не раздаёт
      stopped: z.enum(['ratio', 'time', 'never', 'cache']).nullable(),
    }),
  })
  .meta({ id: 'torrent' })

export const torrentList = z
  .object({
    items: z.array(torrent),
    // Список живёт и без движка, но добавить и смотреть без него нельзя
    engine: z.enum(['ready', ...engineUnavailableKinds]),
    totals: z.object({ downloadSpeed: z.number(), uploadSpeed: z.number() }),
    // Кэш просмотров (раздачи без «Оставить») и его лимит, байт
    cache: z.object({ used: z.number(), limit: z.number() }),
  })
  .meta({ id: 'torrentList' })

export const deleteTorrentQuery = z.object({
  // `delete` удаляет и скачанные файлы
  files: z.enum(['keep', 'delete']).optional(),
})

export const downloadTorrent = z
  .object({
    files: z.array(z.number().int().min(0).max(99_999)).min(1).max(10_000),
  })
  .meta({ id: 'downloadTorrent' })

export const updateTorrentFirst = z
  .object({
    files: z.array(z.number().int().min(0).max(99_999)).max(10_000),
  })
  .meta({ id: 'updateTorrentFirst' })

export const updateTorrentTitle = z
  .object({
    // null — «не фильм и не сериал»: раздача остаётся без тайтла
    titleId: z
      .string()
      .regex(/^tmdb:(?:movie|tv):\d{1,10}$/)
      .nullable(),
  })
  .meta({ id: 'updateTorrentTitle' })

export const updateTorrentSeeding = z
  .object({ rule: seedRule.nullable() })
  .meta({ id: 'updateTorrentSeeding' })

export const updateRetention = z
  .object({ retention: z.enum(torrentRetentions) })
  .meta({ id: 'updateRetention' })

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
    // Куски раздачи с неверным хэшем: плеер мог получить повреждённые байты
    badPieces: z.number(),
  })
  .meta({ id: 'torrentStats' })
