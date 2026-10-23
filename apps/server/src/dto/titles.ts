import { z } from 'zod'
import { titleDownloadStates, tmdbLanguage } from './catalog.ts'
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
  // Раздачи всех сезонов сериала (экран «Источники»): сезон и серия не учитываются
  all: z.enum(['1']).optional(),
  // «Уточнить запрос»: искать эту строку вместо названий из TMDB
  query: z.string().trim().min(1).max(200).optional(),
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
    // Размер на серию у сериала; у пака без диапазона серий — по числу серий
    // сезона из TMDB, без него — null
    episodeSize: z.number().nullable(),
    seeders: z.number(),
    peers: z.number().nullable(),
    quality: z.enum(resolutions).nullable(),
    source: z.string().nullable(),
    codec: z.string().nullable(),
    hdr: z.array(z.string()),
    audio: z.array(audioTrack),
    // Каналы звука из тегов: `5.1`, `DDP5.1`; null — не указаны
    channels: z.enum(['2.0', '5.1', '7.1']).nullable(),
    // Языки субтитров, ISO 639-1; `und` — субтитры есть, язык не указан
    subs: z.array(z.string()),
    // Основная русская дорожка; null — озвучка не распознана
    voice: audioTrack.nullable(),
    // Ключи всех русских озвучек раздачи (как `voiceOption.key`): по ним фильтр
    voiceKeys: z.array(z.string()),
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
    // Этой раздачей смотрели тайтл последний раз
    lastWatched: z.boolean(),
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
    // Кандидат, который и есть раздача сезона (по infohash); null — такой нет
    seasonCandidate: z.string().nullable(),
    // ID тройки по порядку показа
    top: z.array(z.string()),
    // Все кандидаты по убыванию счёта
    candidates: z.array(sourceCandidate),
    voices: z.array(voiceOption),
    query: z.object({
      // Строка зрителя, по которой искали; null — автоматический поиск
      current: z.string().nullable(),
      // Готовые строки: русское и оригинальное название, с годом и без
      suggestions: z.array(z.string()),
    }),
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
    // Раздача сезона из прогресса: серия из неё без поиска по индексаторам
    torrentId: z.string().min(1).max(100).optional(),
  })
  .meta({ id: 'watchTitle' })

export const titleWatch = z
  .object({
    // resolving — раздача ждёт метаданные: клиент ждёт её и повторяет с candidateId
    status: z.enum(['ready', 'resolving']),
    torrentId: z.string(),
    fileIndex: z.number().nullable(),
    // Пусто, когда смотрели раздачу сезона по torrentId
    candidateId: z.string(),
  })
  .meta({ id: 'titleWatch' })

export const watchErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum(['no_sources', 'not_playable', 'candidate_gone']),
  })
  .meta({ id: 'watchErrorResponse' })

export const openTitle = z
  .object({
    candidateId: z.string().min(1).max(64),
    // Строка, по которой показан список: кандидат ищется в её поиске
    query: z.string().trim().min(1).max(200).optional(),
  })
  .meta({ id: 'openTitle' })

export const titleOpen = z
  .object({
    // resolving — раздача ждёт метаданные: файлов ещё нет
    status: z.enum(['ready', 'resolving']),
    torrentId: z.string(),
  })
  .meta({ id: 'titleOpen' })

export const titleFilesParams = z.object({
  id: z.string().min(1).max(100),
  torrentId: z.string().min(1).max(100),
})

export const fileDownload = z
  .object({
    state: z.enum(titleDownloadStates),
    // Доля скачанного, 0–1
    progress: z.number(),
  })
  .meta({ id: 'fileDownload' })

export const titleFile = z
  .object({
    fileIndex: z.number(),
    // Имя файла без папок и расширения
    name: z.string(),
    size: z.number(),
    season: z.number().nullable(),
    episode: z.number().nullable(),
    position: z.number(),
    duration: z.number().nullable(),
    watched: z.boolean(),
    // Файл качается целиком, скачан или лежит в библиотеке; null — нет
    download: fileDownload.nullable(),
  })
  .meta({ id: 'titleFile' })

export const downloadTitle = z
  .object({
    season: z.number().int().min(1).max(999).optional(),
    // Раздача, которая ждала метаданные: повтор после `resolving`
    candidateId: z.string().min(1).max(64).optional(),
    // «Скачать выбранное» с экрана «Файлы»
    torrentId: z.string().min(1).max(100).optional(),
    files: z
      .array(z.number().int().min(0).max(99_999))
      .min(1)
      .max(10_000)
      .optional(),
  })
  .refine(body => !body.torrentId === !body.files, {
    message: 'Pass files together with torrentId',
  })
  .meta({ id: 'downloadTitle' })

export const titleDownloadStart = z
  .object({
    // resolving — раздача ждёт метаданные: клиент ждёт её и повторяет с candidateId
    status: z.enum(['started', 'resolving']),
    torrentId: z.string(),
    candidateId: z.string(),
    // Сколько файлов и байт ещё скачается
    files: z.number(),
    bytes: z.number(),
  })
  .meta({ id: 'titleDownloadStart' })

export const libraryFile = z
  .object({
    // `media_files.id`: им запускают воспроизведение
    id: z.string(),
    // У фильма сезона и серии нет
    season: z.number().nullable(),
    episode: z.number().nullable(),
    episodeTo: z.number().nullable(),
    // По размеру кадра из пробы: «1080p»
    quality: z.string().nullable(),
    size: z.number(),
    duration: z.number().nullable(),
  })
  .meta({ id: 'libraryFile' })

export const titleLibrary = z
  .object({ files: z.array(libraryFile) })
  .meta({ id: 'titleLibrary' })

// Отмена одной раздачи; без неё — всех закачек тайтла
export const cancelTitleDownloadQuery = z.object({
  torrentId: z.string().min(1).max(100).optional(),
})

export const titleDownload = z
  .object({
    state: z.enum(titleDownloadStates).nullable(),
    // Доля скачанного выбора, 0–1
    progress: z.number(),
    // Тайтл смотрели из кэша: «Оставить» есть что сохранить
    canKeep: z.boolean(),
    // Какую раздачу качаем или положили в библиотеку: качество и озвучка
    release: z
      .object({ quality: z.string().nullable(), voice: voiceRef.nullable() })
      .nullable(),
    // Пиры и скорость (байт/с) качающихся раздач тайтла
    peers: z.object({ connected: z.number(), found: z.number() }),
    speed: z.number(),
    // Качается, а подключённых пиров нет
    stalled: z.boolean(),
    // Закачки по раздачам: кнопка загрузки показывает ту, что покрывает
    // выбранный сезон; разложенные в библиотеку сюда не попадают
    downloads: z.array(
      z.object({
        torrentId: z.string(),
        // downloading — качается, placing — докачана и ложится в
        // библиотеку, unmatched — докачана, но не разложится (нет номеров серий)
        phase: z.enum(['downloading', 'placing', 'unmatched']),
        // Сезоны выбранных видео; у фильма пусто
        seasons: z.array(z.number().int()),
        progress: z.number(),
        release: z
          .object({
            quality: z.string().nullable(),
            voice: voiceRef.nullable(),
          })
          .nullable(),
        peers: z.object({ connected: z.number(), found: z.number() }),
        speed: z.number(),
        stalled: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'titleDownload' })

export const titleFiles = z
  .object({
    status: z.enum(['ready', 'resolving']),
    name: z.string(),
    // Видео раздачи в естественном порядке; пока нет метаданных — пусто
    files: z.array(titleFile),
  })
  .meta({ id: 'titleFiles' })

export const markWatched = z
  .object({
    season: z.number().int().min(1).max(999).optional(),
    episode: z.number().int().min(1).max(9999).optional(),
    watched: z.boolean(),
  })
  .meta({ id: 'markWatched' })

export const episodeProgress = z
  .object({
    season: z.number(),
    episode: z.number(),
    position: z.number(),
    duration: z.number().nullable(),
    watched: z.boolean(),
  })
  .meta({ id: 'episodeProgress' })

export const seasonRelease = z
  .object({
    season: z.number(),
    torrentId: z.string(),
    quality: z.enum(resolutions).nullable(),
    voice: voiceRef.nullable(),
    // Серии сезона, файлы которых есть в раздаче
    episodes: z.array(z.number()),
  })
  .meta({ id: 'seasonRelease' })

export const episodeFile = z
  .object({
    torrentId: z.string(),
    fileIndex: z.number(),
  })
  .meta({ id: 'episodeFile' })

export const titleProgressQuery = z.object({
  // Язык деталей TMDB: по ним ищется следующая вышедшая серия, кэш общий с карточкой
  language: tmdbLanguage,
})

export const resumeTarget = z
  .object({
    // У фильма сезона и серии нет
    season: z.number().nullable(),
    episode: z.number().nullable(),
    position: z.number(),
    duration: z.number().nullable(),
    // Следующая серия после досмотренной
    next: z.boolean(),
    // Файл серии в известной раздаче; null — раздачу ещё искать
    file: episodeFile.nullable(),
  })
  .meta({ id: 'resumeTarget' })

export const titleProgress = z
  .object({
    // Что продолжать: начатая серия или следующая; null — продолжать нечего
    resume: resumeTarget.nullable(),
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
    // Раздача сезона — чем последний раз смотрели серию сезона
    seasonReleases: z.array(seasonRelease),
    // Прогресс по сериям: полосы и отметки «просмотрено» на карточке
    episodes: z.array(episodeProgress),
  })
  .meta({ id: 'titleProgress' })

export const upNextQuery = z.object({
  season: number(999),
  episode: number(9999),
  // Раздача, которую смотрят: в ней ищется файл следующей серии
  torrentId: z.string().min(1).max(100).optional(),
  language: tmdbLanguage,
})

export const upNext = z
  .object({
    // null — следующей вышедшей серии нет
    next: z
      .object({
        season: z.number(),
        episode: z.number(),
        title: z.string(),
        still: z.string().optional(),
        // Файл серии в той же раздаче; null — её нет в раздаче
        file: episodeFile.nullable(),
      })
      .nullable(),
  })
  .meta({ id: 'upNext' })

// Контекст тайтла у позиции просмотра: прогресс серии не зависит от раздачи
export const playbackTitle = z
  .object({
    id: z.string().min(1).max(100),
    season: z.number().int().min(1).max(999).optional(),
    episode: z.number().int().min(1).max(9999).optional(),
  })
  .meta({ id: 'playbackTitle' })
