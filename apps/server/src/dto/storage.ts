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
  })
  .meta({ id: 'storageOverview' })

export const updateStoragePolicy = z
  .object({
    cacheLimit: z.number().int().min(GIB).max(MAX_BYTES),
    minFree: z.number().int().min(GIB).max(MAX_BYTES),
  })
  .meta({ id: 'updateStoragePolicy' })
