import { z } from 'zod'
import { sourceErrorKinds } from './sources.ts'

function number(max: number) {
  return z
    .string()
    .regex(new RegExp(`^[1-9]\\d{0,${String(max).length - 1}}$`))
}

export const voiceTypes = [
  'D',
  'MVO',
  'DVO',
  'VO',
  'AVO',
  'L',
  'Original',
] as const

export const resolutions = [
  '2160p',
  '1440p',
  '1080p',
  '1080i',
  '720p',
  '576p',
  '480p',
  '360p',
] as const

export const sourceReasons = [
  'pinnedVoice',
  'profile',
  'bestQuality',
  'smaller',
  'moreSeeders',
  'originalAudio',
] as const

export const titleParams = z.object({
  id: z.string().min(1).max(100),
})

export const titleSourcesQuery = z.object({
  // Сезон 0 — спецвыпуски: их раздачи не ищем
  season: number(999).optional(),
  episode: number(9999).optional(),
  refresh: z.enum(['1']).optional(),
})

export const voiceRef = z
  .object({
    studio: z.string().optional(),
    type: z.enum(voiceTypes).optional(),
  })
  .meta({ id: 'voiceRef' })

export const audioTrack = z
  .object({
    type: z.enum(voiceTypes).optional(),
    studio: z.string().optional(),
    language: z.string().optional(),
  })
  .meta({ id: 'audioTrack' })

export const sourceCandidate = z
  .object({
    // Непрозрачный ID: ссылка на раздачу остаётся на сервере
    id: z.string(),
    // Исходное имя раздачи
    title: z.string(),
    indexers: z.array(z.string()),
    size: z.number().nullable(),
    // Размер на серию у сериала; у пака без диапазона серий — null
    episodeSize: z.number().nullable(),
    seeders: z.number(),
    peers: z.number().nullable(),
    quality: z.enum(resolutions).nullable(),
    source: z.string().nullable(),
    codec: z.string().nullable(),
    hdr: z.array(z.string()),
    audio: z.array(audioTrack),
    // Основная русская дорожка; null — озвучка не распознана
    voice: audioTrack.nullable(),
    seasons: z.array(z.number()),
    episodes: z
      .object({
        from: z.number(),
        to: z.number(),
        total: z.number().optional(),
      })
      .nullable(),
    isPack: z.boolean(),
    // medium — похоже на этот тайтл, но есть сомнение
    confidence: z.enum(['high', 'medium']),
    // Причина выбора у кандидатов тройки
    pickReason: z.enum(sourceReasons).nullable(),
    publishedAt: z.string().nullable(),
  })
  .meta({ id: 'sourceCandidate' })

export const voiceOption = z
  .object({
    key: z.string(),
    studio: z.string().optional(),
    type: z.enum(voiceTypes).optional(),
    maxQuality: z.enum(resolutions).optional(),
    seeders: z.number(),
    count: z.number(),
    pinned: z.boolean(),
  })
  .meta({ id: 'voiceOption' })

export const titleSources = z
  .object({
    season: z.number().nullable(),
    episode: z.number().nullable(),
    updatedAt: z.string(),
    profile: z.object({
      qualities: z.array(z.enum(resolutions)),
      voiceTypes: z.array(z.enum(voiceTypes)),
    }),
    pinnedVoice: voiceRef.nullable(),
    // ID тройки по порядку показа
    top: z.array(z.string()),
    // Все кандидаты по убыванию счёта
    candidates: z.array(sourceCandidate),
    voices: z.array(voiceOption),
    indexers: z.object({
      total: z.number(),
      failed: z.array(
        z.object({ name: z.string(), kind: z.enum(sourceErrorKinds) }),
      ),
    }),
  })
  .meta({ id: 'titleSources' })

export const pinTitleVoice = z
  .object({
    season: z.number().int().min(0).max(999),
    // null снимает закрепление
    voice: voiceRef.nullable(),
  })
  .meta({ id: 'pinTitleVoice' })

export type TitleSourcesResponse = z.output<typeof titleSources>
export type SourceCandidate = z.output<typeof sourceCandidate>

export const watchTitle = z
  .object({
    season: z.number().int().min(1).max(999).optional(),
    episode: z.number().int().min(1).max(9999).optional(),
    candidateId: z.string().min(1).max(64).optional(),
  })
  .meta({ id: 'watchTitle' })

export const titleWatch = z
  .object({
    // resolving — раздача ждёт метаданные: клиент ждёт её и повторяет с candidateId
    status: z.enum(['ready', 'resolving']),
    torrentId: z.string(),
    fileIndex: z.number().nullable(),
    candidateId: z.string(),
  })
  .meta({ id: 'titleWatch' })

export const watchErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum(['no_sources', 'not_playable', 'candidate_gone']),
  })
  .meta({ id: 'watchErrorResponse' })

export const titleProgress = z
  .object({
    // Последняя начатая серия; у фильма сезон и серия — null
    last: z
      .object({
        season: z.number().nullable(),
        episode: z.number().nullable(),
        position: z.number(),
        duration: z.number().nullable(),
        // Досмотрена: продолжать нечего, дальше — следующая серия
        watched: z.boolean(),
        updatedAt: z.string(),
      })
      .nullable(),
  })
  .meta({ id: 'titleProgress' })

// Контекст тайтла у позиции просмотра: прогресс серии не зависит от раздачи
export const playbackTitle = z
  .object({
    id: z.string().min(1).max(100),
    season: z.number().int().min(1).max(999).optional(),
    episode: z.number().int().min(1).max(9999).optional(),
  })
  .meta({ id: 'playbackTitle' })
