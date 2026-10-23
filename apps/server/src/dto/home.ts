import { z } from 'zod'
import { card, tmdbLanguage } from './catalog.ts'
import { episodeFile } from './titles.ts'

// `library` — раздел «Библиотека»: только свои ряды, без каталога
export const homeModes = ['all', 'movies', 'series', 'library'] as const

export const tmdbHomeRowIds = [
  'trending',
  'trendingMovies',
  'trendingSeries',
  'popularMovies',
  'popularSeries',
  'russianSeries',
  'nowPlaying',
  'onTheAir',
  'topRatedMovies',
  'topRatedSeries',
] as const

// Тематические ряды главной: два в день по очереди
export const themeHomeRowIds = [
  'themeSpace',
  'themeZombies',
  'themeVampires',
  'themeDetectives',
  'themeSpies',
  'themeDisasters',
  'themeWar',
  'themeWesterns',
] as const

// Личные ряды профиля: собираются из его списков и просмотров
export const personalHomeRowIds = [
  'newEpisodes',
  'watchlist',
  'collection',
  // Своя библиотека: на главной и в разделе «Библиотека»
  'library',
  'libraryRecent',
  'libraryMovies',
  'librarySeries',
  // Скачанные раздачи без тайтла: «Указать тайтл» с витрины
  'libraryUnmatched',
  // Файлы без тайтла: домашнее видео и «Без описания»
  'libraryHomeVideo',
  'libraryUntitled',
] as const

export const homeRowIds = [
  ...tmdbHomeRowIds,
  ...themeHomeRowIds,
  ...personalHomeRowIds,
] as const

export const homeQuery = z.object({
  mode: z.enum(homeModes).default('all'),
  language: tmdbLanguage,
})

// Серия в ряду 16:9: «S2E5 · Название», кадр серии или бэкдроп тайтла
export const episodeCard = z
  .object({
    titleId: z.string(),
    title: z.string(),
    season: z.number().int(),
    episode: z.number().int(),
    episodeTitle: z.string().optional(),
    image: z.string().optional(),
    // YYYY-MM-DD выхода последней серии
    airDate: z.string().optional(),
    // Сколько вышедших серий после самой дальней просмотренной, включая эту
    newCount: z.number().int(),
  })
  .meta({ id: 'episodeCard' })

export const catalogRow = z
  .object({
    id: z.enum(homeRowIds),
    // top10 — постеры с крупными цифрами, posters — обычные постеры,
    // episodes — карточки серий 16:9 в `episodes`, `items` пустой
    kind: z.enum(['top10', 'posters', 'episodes']),
    // Ключ строки интерфейса (home.rows.*): текст выбирает клиент по своему
    // языку; у ряда подборки пустой — название в `name`
    title: z.string(),
    // Ряд подборки: её id (уникальность секций ряда) и название как есть
    ref: z.string().optional(),
    name: z.string().optional(),
    items: z.array(card),
    episodes: z.array(episodeCard).optional(),
  })
  .meta({ id: 'catalogRow' })

// Раздача, которую сервер не узнал: тайтл указывают с витрины
export const releaseCard = z
  .object({
    torrentId: z.string(),
    // Имя раздачи как есть
    name: z.string(),
    matchStatus: z.enum(['unsure', 'unmatched']),
    // Подсказка распознавания у `unsure`
    suggestion: card.nullable(),
    // Бэкдроп подсказки
    image: z.string().optional(),
    // Название для поиска тайтла: из имени раздачи, без подзаголовка
    query: z.string(),
    // Что скачано: сезоны, число видео и их размер в байтах
    seasons: z.array(z.number().int()),
    videos: z.number().int(),
    size: z.number(),
  })
  .meta({ id: 'releaseCard' })

export const releasesRow = z
  .object({
    id: z.literal('libraryUnmatched'),
    kind: z.literal('releases'),
    title: z.string(),
    items: z.array(releaseCard),
  })
  .meta({ id: 'releasesRow' })

// Файл библиотеки без тайтла: домашнее видео, «Без описания»
export const fileCard = z
  .object({
    id: z.string(),
    // Имя файла без расширения
    name: z.string(),
    // Папка файла от корня библиотеки: у домашнего видео — альбом, '' — без
    // альбома; у файла без описания — его папка
    album: z.string().nullable(),
    // Дата съёмки «как на часах камеры», показывать в UTC
    capturedAt: z.string().nullable(),
    duration: z.number().nullable(),
    // Доля просмотренного, 0–1
    share: z.number(),
    thumb: z.string(),
  })
  .meta({ id: 'fileCard' })

export const filesRow = z
  .object({
    id: z.enum(['libraryHomeVideo', 'libraryUntitled']),
    kind: z.literal('files'),
    title: z.string(),
    items: z.array(fileCard),
    // Сколько всего: в ряду — только свежие, весь список — в своём разделе
    total: z.number().int(),
  })
  .meta({ id: 'filesRow' })

export const homeAlbum = z
  .object({
    libraryId: z.string(),
    // Путь папки от корня библиотеки, '' — видео в корне («Без альбома»)
    album: z.string(),
    count: z.number().int(),
    // Даты съёмки самого раннего и самого позднего видео
    from: z.string().nullable(),
    to: z.string().nullable(),
    // Обложка — кадр самого позднего видео
    coverId: z.string(),
  })
  .meta({ id: 'homeAlbum' })

export const homeVideoSection = z
  .object({ albums: z.array(homeAlbum) })
  .meta({ id: 'homeVideoSection' })

export const homeVideosQuery = z.object({
  libraryId: z.string().min(1).max(100).optional(),
  album: z.string().max(4096).optional(),
})

export const homeVideoList = z
  .object({ items: z.array(fileCard) })
  .meta({ id: 'homeVideoList' })

export type FileCard = z.infer<typeof fileCard>
export type FilesRow = z.infer<typeof filesRow>
export type ReleaseCard = z.infer<typeof releaseCard>
export type ReleasesRow = z.infer<typeof releasesRow>

/** Тайтл с незаконченным просмотром: что продолжать и с какого места */
export const continueCard = card
  .extend({
    // Кадр серии, у фильма и без кадра — бэкдроп
    image: z.string().optional(),
    // У фильма сезона и серии нет
    season: z.number().nullable(),
    episode: z.number().nullable(),
    episodeTitle: z.string().optional(),
    position: z.number(),
    // Секунды: из прошлого просмотра, иначе из TMDB; null — неизвестно
    duration: z.number().nullable(),
    // Следующая серия после досмотренной, ещё не начатая
    next: z.boolean(),
    // Файл серии в известной раздаче; null — раздачу ещё искать
    file: episodeFile.nullable(),
  })
  .meta({ id: 'continueCard' })

export const continueRow = z
  .object({
    id: z.literal('continue'),
    kind: z.literal('continue'),
    title: z.string(),
    items: z.array(continueCard),
  })
  .meta({ id: 'continueRow' })

export const homeRow = z
  .union([continueRow, releasesRow, filesRow, catalogRow])
  .meta({ id: 'homeRow' })

export const homeResponse = z
  .object({
    rows: z.array(homeRow),
  })
  .meta({ id: 'homeResponse' })

export type HomeMode = (typeof homeModes)[number]
export type HomeRowId = (typeof homeRowIds)[number]
export type TmdbHomeRowId = (typeof tmdbHomeRowIds)[number]
export type ThemeHomeRowId = (typeof themeHomeRowIds)[number]
export type HomeRow = z.output<typeof homeRow>
export type CatalogRow = z.output<typeof catalogRow>
export type EpisodeCard = z.output<typeof episodeCard>
export type ContinueCard = z.output<typeof continueCard>
export type ContinueRow = z.output<typeof continueRow>
