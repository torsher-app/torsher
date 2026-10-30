import { z } from 'zod'
import {
  blocklistReasons,
  followHistoryKinds,
  followModes,
  followQualityPresets,
  followStates,
  profileColors,
} from '../db/schema.ts'
import {
  followCursor,
  followEpisodeStates,
  followWait,
  titleNextEpisode,
  tmdbLanguage,
} from './catalog.ts'
import { voiceTypes } from './titles.ts'

export const followParams = z.object({
  id: z.string().min(1).max(100),
})

export const followLanguageQuery = z.object({
  // Язык деталей TMDB: по ним считаются сезоны и курсор, кэш общий с карточкой
  language: tmdbLanguage,
})

const rules = {
  // Студия, если за сезоном не закреплена своя; null — без студии
  voiceStudio: z.string().trim().min(1).max(100).nullable().optional(),
  // Другую студию не брать совсем
  voiceStrict: z.boolean().optional(),
  requireRussian: z.boolean().optional(),
  // Ждать свою озвучку и верхнюю ступень качества, часов
  waitHours: z.number().int().min(0).max(168).optional(),
  qualityPreset: z.enum(followQualityPresets).optional(),
  // Новая серия: качать в библиотеку или только уведомить и смотреть стримом
  mode: z.enum(followModes).optional(),
}

// Курсора в правилах нет: слежение всегда с первой невышедшей серии
export const followTitle = z.object(rules).meta({ id: 'followTitle' })

// Серия, выбор которой стримит «Смотреть»; у фильма 0/0
export const openFollowPick = z
  .object({
    season: z.number().int().min(0).max(999),
    episode: z.number().int().min(0).max(9999),
  })
  .meta({ id: 'openFollowPick' })

export const updateFollow = z
  .object({
    ...rules,
    state: z.enum(['active', 'paused']).optional(),
  })
  .meta({ id: 'updateFollow' })

const followView = {
  id: z.string(),
  kind: z.enum(['movie', 'series']),
  state: z.enum(followStates),
  start: followCursor,
  voiceStudio: z.string().nullable(),
  voiceStrict: z.boolean(),
  requireRussian: z.boolean(),
  waitHours: z.number().int(),
  qualityPreset: z.enum(followQualityPresets),
  mode: z.enum(followModes),
  // Ближайшая невышедшая серия с курсора; у фильма и без анонса — null
  next: titleNextEpisode.nullable(),
}

// Первая по порядку серия в состоянии: статус называет её кодом S2E6.
// Состояний без серий в объекте нет
export const followFirstEpisodes = z
  .object({
    searching: followCursor.optional(),
    missing: followCursor.optional(),
    downloading: followCursor.optional(),
    noSpace: followCursor.optional(),
  })
  .meta({ id: 'followFirstEpisodes' })

export const titleFollow = z
  .object({
    ...followView,
    subscribed: z.boolean(),
    profileCount: z.number().int(),
    // Сезон, о котором говорит статус: первой нужной серии, иначе следующей
    // анонсированной, иначе курсора; у фильма 0
    season: z.number().int(),
    // Своя студия этого сезона; `pinned` — закреплена за ним самим, а не
    // перешла из прошлого сезона или правил
    voice: z
      .object({
        studio: z.string().optional(),
        type: z.enum(voiceTypes).optional(),
        pinned: z.boolean(),
      })
      .nullable(),
    // Ступень cutoff по качеству в этом сезоне; `lowered` — верхняя ступень
    // не выходила, и cutoff опущен до лучшей увиденной
    quality: z.object({ value: z.string(), lowered: z.boolean() }),
    // Ближайшая отложенная серия
    waiting: followWait
      .extend({
        season: z.number().int(),
        episode: z.number().int(),
      })
      .nullable(),
    // Серии с курсора по состояниям
    counts: z.object({
      downloading: z.number().int(),
      noSpace: z.number().int(),
      missing: z.number().int(),
      searching: z.number().int(),
      ready: z.number().int(),
    }),
    first: followFirstEpisodes,
    // Первая готовая серия, которую профиль не досмотрел: её «Смотреть»
    // открывает сразу, без источников
    ready: followCursor.nullable(),
  })
  .meta({ id: 'titleFollow' })

export const titleFollowResponse = z
  .object({
    follow: titleFollow.nullable(),
    // Профиль может менять правила: без возрастного порога или владелец
    canEdit: z.boolean(),
  })
  .meta({ id: 'titleFollowResponse' })

export const followProfile = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.enum(profileColors),
  })
  .meta({ id: 'followProfile' })

export const followEpisode = z
  .object({
    season: z.number().int(),
    episode: z.number().int(),
    // YYYY-MM-DD; у серий из числа вышедших и без анонса даты нет
    airDate: z.string().optional(),
    state: z.enum(followEpisodeStates),
    // До какого момента ждём лучший кандидат, ISO; только у `waiting`
    waitUntil: z.string().optional(),
    // Кандидатов в снимке последнего прогона: 0 — снимка нет
    candidates: z.number().int(),
  })
  .meta({ id: 'followEpisode' })

// Серий с курсора в каждом состоянии: группы списка и причина в строке
export const followEpisodeCounts = z
  .object({
    upcoming: z.number().int(),
    searching: z.number().int(),
    waiting: z.number().int(),
    downloading: z.number().int(),
    noSpace: z.number().int(),
    missing: z.number().int(),
    inLibrary: z.number().int(),
    ready: z.number().int(),
  })
  .meta({ id: 'followEpisodeCounts' })

export const followSummary = z
  .object({
    ...followView,
    titleId: z.string(),
    // Детали TMDB не загрузились — тайтл без названия и постера
    title: z.string().nullable(),
    poster: z.string().optional(),
    year: z.number().int().optional(),
    profiles: z.array(followProfile),
    // Вышедших серий с курсора, которых нет в библиотеке, которые не качаются
    // и не выбраны
    wanted: z.number().int(),
    counts: followEpisodeCounts,
    first: followFirstEpisodes,
    // Раздач «похоже, не уверены» без ответа владельца
    unsure: z.number().int(),
    // Ближайший конец окна ожидания среди `waiting`, ISO
    waitUntil: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'followSummary' })

export const followListResponse = z
  .object({ items: z.array(followSummary) })
  .meta({ id: 'followListResponse' })

export const followDetails = followSummary
  .extend({
    episodes: z.array(followEpisode),
    // Целевой поиск: последний, когда тик посмотрит слежение снова, ISO
    lastSearchAt: z.string().nullable(),
    nextSearchAt: z.string().nullable(),
    // «Искать сейчас» нажали, поиск ещё не прошёл
    searchRequested: z.boolean(),
  })
  .meta({ id: 'followDetails' })

export const followCandidatesQuery = z.object({
  season: z.coerce.number().int().min(0).max(999),
  episode: z.coerce.number().int().min(0).max(9999),
})

const rejection = z.object({
  code: z.string(),
  type: z.enum(['permanent', 'temporary']),
  // Для текста: студия, качество, размер, срок
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})

export const followCandidate = z
  .object({
    id: z.string(),
    title: z.string(),
    infoHash: z.string().optional(),
    indexers: z.array(z.string()),
    size: z.number().optional(),
    seeders: z.number().int(),
    quality: z.string().optional(),
    studio: z.string().optional(),
    voiceType: z.string().optional(),
    verdict: z.enum(['grab', 'pending', 'rejected']),
    rejections: z.array(rejection),
    // Раздача сейчас в чёрном списке
    blocked: z.boolean(),
  })
  .meta({ id: 'followCandidate' })

export const followCandidatesResponse = z
  .object({
    // Первое появление серии у нас, ISO; null — снимка нет
    firstSeenAt: z.string().nullable(),
    items: z.array(followCandidate),
  })
  .meta({ id: 'followCandidatesResponse' })

export const followActivityQuery = z.object({
  follow: z.string().min(1).max(100).optional(),
  kind: z.enum(followHistoryKinds).optional(),
  // id последней показанной строки: следующая порция старше неё
  before: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const followActivityItem = z
  .object({
    id: z.string(),
    at: z.string(),
    kind: z.enum(followHistoryKinds),
    followId: z.string().nullable(),
    // У пробела ленты тайтла нет
    titleId: z.string().nullable(),
    season: z.number().int().nullable(),
    episodes: z.array(z.number().int()),
    releaseTitle: z.string().nullable(),
    // Имя индексатора, если он ещё есть
    indexer: z.string().nullable(),
    torrentId: z.string().nullable(),
    // Для текста события: студия, качество, срок, сколько нашли, причина;
    // у `unsure` — `confirmedAt` или `dismissedAt`, когда владелец ответил
    params: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'followActivityItem' })

export const followActivityResponse = z
  .object({
    items: z.array(followActivityItem),
    hasMore: z.boolean(),
  })
  .meta({ id: 'followActivityResponse' })

export const followQueueItem = z
  .object({
    // `pending` — отложен до конца окна, `downloading` — закачка автоматики,
    // `no_space` — захват ждёт места
    kind: z.enum(['pending', 'downloading', 'no_space']),
    followId: z.string(),
    titleId: z.string(),
    followState: z.enum(followStates),
    season: z.number().int(),
    episodes: z.array(z.number().int()),
    releaseTitle: z.string(),
    // Конец окна ожидания, ISO; у `pending`
    until: z.string().optional(),
    // Чего ждём: своя студия, тип озвучки, ступень качества
    waitFor: z
      .object({
        studio: z.string().optional(),
        voiceType: z.string().optional(),
        quality: z.string().optional(),
      })
      .optional(),
    size: z.number().optional(),
    torrentId: z.string().optional(),
    // Доля скачанного в файлах серий; null — движок не знает раздачу
    progress: z.number().nullable().optional(),
    // magnet ждёт метаданные
    resolving: z.boolean().optional(),
  })
  .meta({ id: 'followQueueItem' })

export const followQueueResponse = z
  .object({ items: z.array(followQueueItem) })
  .meta({ id: 'followQueueResponse' })

export const blocklistParams = z.object({
  id: z.string().min(1).max(100),
})

export const blocklistItem = z
  .object({
    id: z.string(),
    titleId: z.string(),
    // null — раздачу без infohash запретили по её показам у индексаторов
    infoHash: z.string().nullable(),
    releaseTitle: z.string(),
    reason: z.enum(blocklistReasons),
    // Только эти серии; null — раздача целиком
    episodes: z
      .array(z.object({ season: z.number().int(), episode: z.number().int() }))
      .nullable(),
    createdAt: z.string(),
    // null — навсегда
    expiresAt: z.string().nullable(),
  })
  .meta({ id: 'blocklistItem' })

export const blocklistResponse = z
  .object({ items: z.array(blocklistItem) })
  .meta({ id: 'blocklistResponse' })

export const blockRelease = z
  .object({
    followId: z.string().min(1).max(100),
    // `id` кандидата в снимке серии
    candidateId: z.string().min(1).max(500),
  })
  .meta({ id: 'blockRelease' })

const followDefaults = z.object({
  waitHours: z.number().int().min(0).max(168),
  movieWaitHours: z.number().int().min(0).max(168),
  qualityPreset: z.enum(followQualityPresets),
  // `auto` — у тайтлов с нерусским оригиналом
  requireRussian: z.enum(['auto', 'always', 'never']),
  mode: z.enum(followModes),
})

// Лента реже 10 мин нагружает индексаторы, 0 — не читать
const rssInterval = z
  .number()
  .int()
  .refine(value => value === 0 || (value >= 10 && value <= 120))

export const followSettingsResponse = z
  .object({
    rssIntervalMin: z.number().int(),
    searchesPerHour: z.number().int(),
    defaults: followDefaults,
  })
  .meta({ id: 'followSettings' })

export const updateFollowSettings = z
  .object({
    rssIntervalMin: rssInterval.optional(),
    searchesPerHour: z.number().int().min(1).max(60).optional(),
    defaults: followDefaults.partial().optional(),
  })
  .meta({ id: 'updateFollowSettings' })

export const scheduleItem = z
  .object({
    titleId: z.string(),
    title: z.string(),
    season: z.number().int(),
    episode: z.number().int(),
    episodeTitle: z.string().optional(),
    // YYYY-MM-DD
    airDate: z.string(),
    // Кадр серии, без него — бэкдроп тайтла
    image: z.string().optional(),
    // Профиль следит за тайтлом
    followed: z.boolean(),
    // Состояние серии «Следить»; null — серия до курсора или тайтл не в слежении
    state: z.enum(followEpisodeStates).nullable(),
    // Своя студия сезона у слежения
    studio: z.string().optional(),
    // Файл серии в библиотеке: витрина играет его с диска
    mediaFileId: z.string().optional(),
  })
  .meta({ id: 'scheduleItem' })

export const scheduleResponse = z
  .object({
    // Ближайшие по дате выхода, раньше — первыми
    upcoming: z.array(scheduleItem),
    // Вышедшие за 14 дней, свежие — первыми
    recent: z.array(scheduleItem),
  })
  .meta({ id: 'scheduleResponse' })

export type TitleFollowResponse = z.output<typeof titleFollowResponse>
export type FollowSummary = z.output<typeof followSummary>
export type FollowDetails = z.output<typeof followDetails>
export type FollowCandidate = z.output<typeof followCandidate>
export type FollowActivityItem = z.output<typeof followActivityItem>
export type FollowQueueItem = z.output<typeof followQueueItem>
export type ScheduleItem = z.output<typeof scheduleItem>
