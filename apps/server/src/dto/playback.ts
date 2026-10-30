import { z } from 'zod'
import { profileLanguages } from '../db/schema.ts'
import { playbackTitle } from './titles.ts'

const fileIndex = z.number().int().min(0).max(99_999)
const seconds = z.number().min(0).max(1_000_000)

const containers = z.enum(['mp4', 'webm', 'mkv', 'avi', 'ts', 'other'])
const codec = z.string().min(1).max(20)

/** Что умеет плеер: решает, играть файл напрямую или перепаковать */
export const deviceProfile = z
  .object({
    containers: z.array(containers).max(10),
    video: z.array(codec).max(20),
    audio: z.array(codec).max(20),
    // Плеер переключает аудиодорожку файла сам (`audioTracks`)
    audioTracks: z.boolean(),
    // Плеер сам показывает встроенные текстовые субтитры файла
    embeddedSubtitles: z.boolean(),
    // hls.js на MSE или нативный HLS
    hls: z.boolean(),
  })
  .meta({ id: 'deviceProfile' })

// Дорожка субтитров: `s<поток>` — встроенная, `f<файл раздачи>` — внешняя
const subtitleId = z.string().regex(/^[sf]\d{1,5}$/)

// Источник — файл раздачи (`torrentId` и `fileIndex`) или файл библиотеки
function oneSource(body: {
  torrentId?: string
  fileIndex?: number
  mediaFileId?: string
}) {
  const torrent = body.torrentId !== undefined && body.fileIndex !== undefined
  const library = body.mediaFileId !== undefined

  return torrent !== library
}

const sourceMessage = {
  message: 'Pass either torrentId with fileIndex or mediaFileId',
}

export const createPlayback = z
  .object({
    torrentId: z.string().min(1).max(100).optional(),
    fileIndex: fileIndex.optional(),
    // Файл библиотеки: играется с диска, без движка
    mediaFileId: z.string().min(1).max(100).optional(),
    // Смотрим из карточки: позиция для продолжения — по серии, а не по файлу
    title: playbackTitle.optional(),
    // Без профиля — прямое воспроизведение, как у старых клиентов
    device: deviceProfile.optional(),
    // Язык витрины: озвучка по умолчанию на нём
    language: z.enum(profileLanguages).optional(),
    // Смена озвучки или субтитров перезапуском: поток с этой дорожкой и позиции
    audioStream: z.number().int().min(0).max(9999).optional(),
    subtitle: subtitleId.optional(),
    startPosition: seconds.optional(),
    // Студия, которую слушали в прошлой раздаче: при смене раздачи — её дорожка
    voiceStudio: z.string().min(1).max(200).optional(),
  })
  .refine(oneSource, sourceMessage)
  .meta({ id: 'createPlayback' })

const audioTrack = z
  .object({
    // Номер потока в файле: его передают в `audioStream`
    index: z.number(),
    // ISO 639-2 из файла (`rus`, `eng`)
    language: z.string().nullable(),
    title: z.string().nullable(),
    codec: z.string(),
    channels: z.number().nullable(),
    bitrate: z.number().nullable(),
    default: z.boolean(),
    // Озвучка, распознанная в названии дорожки
    studio: z.string().nullable(),
    voiceType: z.string().nullable(),
  })
  .meta({ id: 'mediaAudioTrack' })

const subtitleTrack = z
  .object({
    id: subtitleId,
    language: z.string().nullable(),
    title: z.string().nullable(),
    codec: z.string(),
    external: z.boolean(),
    forced: z.boolean(),
    default: z.boolean(),
    // Графические (PGS, VobSub): выбор перезапускает поток с прожигом в кадр
    burnIn: z.boolean(),
  })
  .meta({ id: 'mediaSubtitleTrack' })

const mediaInfo = z
  .object({
    container: containers,
    video: z
      .object({
        codec: z.string(),
        width: z.number().nullable(),
        height: z.number().nullable(),
        hdr: z.boolean(),
      })
      .nullable(),
    audio: z.array(audioTrack),
    // Текстовые — слоем плеера, графические — прожигом в кадр
    subtitles: z.array(subtitleTrack),
  })
  .meta({ id: 'mediaInfo' })

export const playback = z
  .object({
    sessionId: z.string(),
    // `probing` — сервер ещё читает файл: клиент спрашивает `GET /playback/:id`
    status: z.enum(['probing', 'ready']),
    mode: z.enum(['direct', 'hls']).nullable(),
    // Адрес для `<video>` или hls.js с токеном потока: плеер сессию не обновляет
    streamUrl: z.string().nullable(),
    // Прямой поток файла с токеном (12 ч) для VLC и Infuse, в любом режиме
    externalUrl: z.string(),
    title: z.string(),
    fileName: z.string(),
    size: z.number(),
    // Длительность из файла или из прошлого просмотра
    duration: z.number().nullable(),
    // С какой секунды продолжить просмотр; null — с начала
    startPosition: z.number().nullable(),
    // null — сервер не смог прочитать файл: дорожки отдаёт сам плеер
    media: mediaInfo.nullable(),
    audioStream: z.number().nullable(),
    subtitle: subtitleId.nullable(),
    // `platform` — озвучку меняет плеер, `restart` — новый `POST /playback`
    audioSwitch: z.enum(['platform', 'restart']),
    // Почему не напрямую; пусто — играем напрямую
    reasons: z.array(z.string()),
    transcode: z
      .object({
        audio: z.enum(['copy', 'aac']),
        // Перекодирование видео; null — видео копией
        video: z
          .object({
            encoder: z.enum(['software', 'vaapi', 'nvenc']),
            width: z.number(),
            height: z.number(),
            toneMapping: z.enum(['gpu', 'software']).nullable(),
          })
          .nullable(),
      })
      .nullable(),
  })
  .meta({ id: 'playback' })

export const playbackParams = z.object({
  id: z.string().min(1).max(100),
})

/**
 * Чем кончилось воспроизведение на клиенте — для журнала сервера: вид ошибки
 * экрана и код `MediaError` плеера
 */
export const playbackError = z
  .object({
    error: z.enum(['unsupported', 'corrupt', 'unknown']),
    // `MediaError.code`: 2 — сеть, 3 — декодирование, 4 — формат или источник
    mediaError: z.number().int().min(1).max(4).optional(),
    // Подробности плеера: `MediaError.message` или вид ошибки hls.js
    detail: z.string().max(300).optional(),
    position: seconds.optional(),
  })
  .meta({ id: 'playbackError' })

export const subtitleParams = z.object({
  id: z.string().min(1).max(100),
  trackId: subtitleId,
})

export const subtitleQuery = z.object({
  from: z
    .string()
    .regex(/^\d{1,7}(?:\.\d+)?$/)
    .optional(),
})

export const subtitleCues = z
  .object({
    cues: z.array(
      z.object({ start: z.number(), end: z.number(), text: z.string() }),
    ),
    // Реплик больше не будет: внешний файл или дорожка прочитана до конца
    done: z.boolean(),
  })
  .meta({ id: 'subtitleCues' })

export const hlsParams = z.object({
  id: z.string().min(1).max(100),
})

export const hlsSegmentParams = z.object({
  id: z.string().min(1).max(100),
  segment: z.string().regex(/^\d{1,6}\.ts$/),
})

/** Просмотр не начнётся: места не хватит даже после вытеснения кэша */
export const insufficientStorageResponse = z
  .object({
    message: z.string(),
    // `no_space` — на диске меньше запаса, `cache_limit` — файл не влезает в лимит кэша
    kind: z.enum(['no_space', 'cache_limit']),
    // Байт: сколько ещё скачает просмотр и сколько можно
    needed: z.number(),
    available: z.number(),
    // Байт: свободно на томе после вытеснения кэша, запас и лимит кэша —
    // чтобы клиент объяснил нехватку словами настроек хранилища
    free: z.number(),
    minFree: z.number(),
    cacheLimit: z.number(),
  })
  .meta({ id: 'insufficientStorageResponse' })

export const updateWatchState = z
  .object({
    torrentId: z.string().min(1).max(100).optional(),
    fileIndex: fileIndex.optional(),
    mediaFileId: z.string().min(1).max(100).optional(),
    position: seconds,
    duration: seconds.optional(),
    title: playbackTitle.optional(),
  })
  .refine(oneSource, sourceMessage)
  .meta({ id: 'updateWatchState' })

export const watchState = z
  .object({
    // У файла библиотеки раздачи нет: позиция — только по серии тайтла
    torrentId: z.string().nullable(),
    fileIndex: z.number().nullable(),
    mediaFileId: z.string().nullable(),
    position: z.number(),
    duration: z.number().nullable(),
    updatedAt: z.string(),
  })
  .meta({ id: 'watchState' })

export const streamParams = z.object({
  torrentId: z.string().min(1).max(100),
  fileIndex: z.string().regex(/^\d{1,5}$/),
})

export const libraryStreamParams = z.object({
  id: z.string().min(1).max(100),
})

export const streamQuery = z.object({
  token: z.string().max(2000).optional(),
})
