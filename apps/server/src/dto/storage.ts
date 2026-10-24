import { z } from 'zod'
import { libraryLinkModes } from './setup.ts'

const GIB = 1024 ** 3
// 1 ПБ: защита от опечатки в лишние нули, а не реальный предел
const MAX_BYTES = 1024 ** 5

export const storageQueueItem = z
  .object({
    torrentId: z.string(),
    name: z.string(),
    sizeOnDisk: z.number(),
    lastAccessAt: z.string().nullable(),
  })
  .meta({ id: 'storageQueueItem' })

export const storageKinds = ['downloads', 'library'] as const

export const storagePathProblems = [
  'not_absolute',
  'not_directory',
  'denied',
  'inside_data',
  'overlaps_other',
  'library_folder',
] as const

const folderContents = z.object({
  path: z.string(),
  // Раздач в движке или файлов своей раскладки и их объём
  items: z.number().int(),
  bytes: z.number(),
})

export const storageFolder = z
  .object({
    path: z.string(),
    // `env` — путь из окружения (по умолчанию), `panel` — выбран в панели
    source: z.enum(['env', 'panel']),
    envPath: z.string(),
    // Том папки
    total: z.number(),
    free: z.number(),
    // Что лежит в действующей папке
    items: z.number().int(),
    bytes: z.number(),
    // Прежние папки, где ещё остались данные
    leftovers: z.array(folderContents),
  })
  .meta({ id: 'storageFolder' })

export const storageMoveState = z
  .object({
    id: z.string(),
    kind: z.enum(storageKinds),
    target: z.string(),
    status: z.enum(['running', 'done', 'failed', 'cancelled']),
    bytesTotal: z.number(),
    bytesDone: z.number(),
    itemsTotal: z.number().int(),
    itemsDone: z.number().int(),
    // Раздача или файл, который переезжает сейчас
    currentName: z.string().nullable(),
    // Ждём движок или конца просмотра раздачи
    waiting: z.boolean(),
    error: z
      .enum(['no_space', 'denied', 'engine', 'exists', 'failed'])
      .nullable(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .meta({ id: 'storageMoveState' })

export const storagePathCheckBody = z
  .object({
    kind: z.enum(storageKinds),
    path: z.string().min(1).max(4096),
  })
  .meta({ id: 'storagePathCheckBody' })

export const storagePathCheck = z
  .object({
    path: z.string(),
    // Почему папку нельзя выбрать; null — можно
    problem: z.enum(storagePathProblems).nullable(),
    exists: z.boolean(),
    writable: z.boolean(),
    total: z.number(),
    free: z.number(),
    // На одном томе с текущей папкой: перенос не займёт места
    sameVolume: z.boolean(),
    // Как файлы попадут из загрузок в библиотеку с этой папкой
    linkMode: z.enum(libraryLinkModes).nullable(),
    // Сколько займёт «Перенести» на томе этой папки
    moveBytes: z.number(),
  })
  .meta({ id: 'storagePathCheck' })

export const updateStoragePath = z
  .object({
    kind: z.enum(storageKinds),
    // null — «Вернуть по умолчанию»: путь из окружения
    path: z.string().min(1).max(4096).nullable(),
    mode: z.enum(['new_only', 'move']),
  })
  .meta({ id: 'updateStoragePath' })

export const startStorageMove = z
  .object({ kind: z.enum(storageKinds) })
  .meta({ id: 'startStorageMove' })

export const storagePathErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum([...storagePathProblems, 'busy', 'no_space']),
  })
  .meta({ id: 'storagePathErrorResponse' })

export const storageOverview = z
  .object({
    // Каталог загрузок на сервере
    path: z.string(),
    // Байт на томе каталога загрузок
    total: z.number(),
    free: z.number(),
    // Кэш просмотров, закреплённое («Оставить») и всё остальное на томе
    cacheUsed: z.number(),
    keptUsed: z.number(),
    // Своя раскладка библиотеки: `shared` — байты, общие с раздачами
    // (хардлинк, reflink); `linkMode` — как туда кладутся файлы, null — не
    // проверено или каталоги недоступны
    library: z.object({
      path: z.string(),
      used: z.number(),
      shared: z.number(),
      // Сколько библиотека занимает на томе загрузок сверх общего с раздачами
      own: z.number(),
      linkMode: z.enum(libraryLinkModes).nullable(),
    }),
    other: z.number(),
    policy: z.object({
      cacheLimit: z.number(),
      minFree: z.number(),
      // Владелец сохранил свои значения; иначе — по размеру тома
      custom: z.boolean(),
    }),
    // Что удалится само первым: кэш по давности просмотра
    queue: z.array(storageQueueItem),
    // Папки загрузок и своей раскладки и перенос между папками
    folders: z.object({
      downloads: storageFolder,
      library: storageFolder,
    }),
    move: storageMoveState.nullable(),
  })
  .meta({ id: 'storageOverview' })

export const updateStoragePolicy = z
  .object({
    cacheLimit: z.number().int().min(GIB).max(MAX_BYTES),
    minFree: z.number().int().min(GIB).max(MAX_BYTES),
  })
  .meta({ id: 'updateStoragePolicy' })
