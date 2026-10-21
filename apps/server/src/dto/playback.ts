import { z } from 'zod'
import { playbackTitle } from './titles.ts'

const fileIndex = z.number().int().min(0).max(99_999)
const seconds = z.number().min(0).max(1_000_000)

export const createPlayback = z
  .object({
    torrentId: z.string().min(1).max(100),
    fileIndex,
    // Смотрим из карточки: позиция для продолжения — по серии, а не по файлу
    title: playbackTitle.optional(),
  })
  .meta({ id: 'createPlayback' })

export const playback = z
  .object({
    // Адрес для `<video>` с токеном потока: сам плеер сессию не обновляет
    streamUrl: z.string(),
    // Сейчас только прямое воспроизведение; remux и транскод — позже
    mode: z.literal('direct'),
    title: z.string(),
    fileName: z.string(),
    size: z.number(),
    // Длительность из прошлого просмотра, если он был
    duration: z.number().nullable(),
    // С какой секунды предложить продолжить; null — сначала
    startPosition: z.number().nullable(),
  })
  .meta({ id: 'playback' })

export const updateWatchState = z
  .object({
    torrentId: z.string().min(1).max(100),
    fileIndex,
    position: seconds,
    duration: seconds.optional(),
    title: playbackTitle.optional(),
  })
  .meta({ id: 'updateWatchState' })

export const watchState = z
  .object({
    torrentId: z.string(),
    fileIndex: z.number(),
    position: z.number(),
    duration: z.number().nullable(),
    updatedAt: z.string(),
  })
  .meta({ id: 'watchState' })

export const streamParams = z.object({
  torrentId: z.string().min(1).max(100),
  fileIndex: z.string().regex(/^\d{1,5}$/),
})

export const streamQuery = z.object({
  token: z.string().max(2000).optional(),
})
