import { z } from 'zod'
import {
  libraryFolderHints,
  libraryFolderStatuses,
  libraryKinds,
} from '../db/schema.ts'

const titleId = z.string().regex(/^tmdb:(?:movie|tv):\d{1,10}$/)
// Путь, как его видит сервер: в образе — внутри контейнера
const folderPath = z.string().min(1).max(4096)
const exclude = z.array(z.string().min(1).max(200)).max(50)

export const libraryFolder = z
  .object({
    id: z.string(),
    path: z.string(),
    hint: z.enum(libraryFolderHints),
    status: z.enum(libraryFolderStatuses),
    // Наблюдатель: on — следит, network — сетевой том (только периодический
    // скан), failed — не поставился, off — выключен; null — ещё не ставили
    watcher: z.enum(['on', 'network', 'failed', 'off']).nullable(),
    error: z.string().nullable(),
    scannedAt: z.string().nullable(),
    // Видео на месте, их объём и пропавшие
    files: z.number().int(),
    size: z.number(),
    missing: z.number().int(),
    // Ждут подтверждения и не распознаны
    unsure: z.number().int(),
    unmatched: z.number().int(),
    // Ещё не сопоставлены с каталогом: очередь идёт
    pending: z.number().int(),
  })
  .meta({ id: 'libraryFolder' })

export const library = z
  .object({
    id: z.string(),
    kind: z.enum(libraryKinds),
    name: z.string(),
    // Своя раскладка: в неё пишет только Torsher, удалить нельзя
    managed: z.boolean(),
    exclude,
    watch: z.boolean(),
    // Профили, от которых библиотека скрыта на витрине
    hiddenProfiles: z.array(z.string()),
    folders: z.array(libraryFolder),
  })
  .meta({ id: 'library' })

export const libraryList = z
  .object({ items: z.array(library) })
  .meta({ id: 'libraryList' })

export const createLibrary = z
  .object({
    kind: z.enum(libraryKinds),
    name: z.string().trim().min(1).max(100),
    path: folderPath,
    // Только для «Фильмов и сериалов»: сужает поиск в каталоге
    hint: z.enum(libraryFolderHints).optional(),
  })
  .meta({ id: 'createLibrary' })

export const updateLibrary = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    exclude: exclude.optional(),
    watch: z.boolean().optional(),
    hiddenProfiles: z.array(z.string()).max(50).optional(),
  })
  .meta({ id: 'updateLibrary' })

export const addLibraryFolder = z
  .object({ path: folderPath, hint: z.enum(libraryFolderHints).optional() })
  .meta({ id: 'addLibraryFolder' })

export const libraryParams = z.object({ id: z.string().min(1).max(100) })
export const folderParams = z.object({ folderId: z.string().min(1).max(100) })

// Почему папку нельзя подключить
export const folderPathErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum([
      'not_absolute',
      'missing',
      'not_directory',
      'denied',
      'inside_data',
      'duplicate',
    ]),
  })
  .meta({ id: 'folderPathErrorResponse' })

export const browseQuery = z.object({ path: z.string().max(4096).optional() })

export const folderBrowse = z
  .object({
    path: z.string(),
    parent: z.string().nullable(),
    entries: z.array(z.object({ name: z.string(), path: z.string() })),
  })
  .meta({ id: 'folderBrowse' })

export const unmatchedGroup = z
  .object({
    folderId: z.string(),
    libraryName: z.string(),
    // Папка-релиз от корня папки библиотеки (у файла в корне — сам файл)
    group: z.string(),
    name: z.string(),
    status: z.enum(['unsure', 'unmatched']),
    suggestion: z.string().nullable(),
    files: z.number().int(),
    size: z.number(),
  })
  .meta({ id: 'unmatchedGroup' })

export const unmatchedGroupList = z
  .object({ items: z.array(unmatchedGroup) })
  .meta({ id: 'unmatchedGroupList' })

export const libraryFileItem = z
  .object({
    id: z.string(),
    folderId: z.string(),
    relPath: z.string(),
    size: z.number(),
    duration: z.number().nullable(),
    state: z.enum(['present', 'missing']),
    titleId: z.string().nullable(),
    matchStatus: z
      .enum(['matched', 'unsure', 'unmatched', 'ignored'])
      .nullable(),
    // Домашнее видео: дата съёмки и откуда она
    capturedAt: z.string().nullable(),
    capturedAtSource: z.enum(['tags', 'name', 'file', 'user']).nullable(),
  })
  .meta({ id: 'libraryFileItem' })

export const libraryFileList = z
  .object({ items: z.array(libraryFileItem), total: z.number().int() })
  .meta({ id: 'libraryFileList' })

export const libraryFilesQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const fileParams = z.object({ fileId: z.string().min(1).max(100) })

export const updateLibraryFile = z
  .object({
    // Дата съёмки «как на часах камеры» (ISO, без пересчёта зоны); null —
    // вернуть автоматическую
    capturedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'updateLibraryFile' })

export const setGroupTitle = z
  .object({
    folderId: z.string().min(1).max(100),
    group: z.string().min(1).max(4096),
    // null — «не фильм и не сериал»
    titleId: titleId.nullable(),
    // Номера серий, исправленные владельцем; `episode: null` — файл не серия
    episodes: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          season: z.number().int().min(0).max(999),
          episode: z.number().int().min(1).max(9999).nullable(),
          episodeTo: z.number().int().min(1).max(9999).nullable().optional(),
        }),
      )
      .max(5000)
      .optional(),
  })
  .meta({ id: 'setGroupTitle' })

export const groupPreviewQuery = z.object({
  folderId: z.string().min(1).max(100),
  group: z.string().min(1).max(4096),
  titleId,
})

export const groupPreview = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        relPath: z.string(),
        // Не видео-серия (сэмпл, доп): не ляжет в библиотеку
        video: z.boolean(),
        season: z.number().int().nullable(),
        episode: z.number().int().nullable(),
        episodeTo: z.number().int().nullable(),
      }),
    ),
  })
  .meta({ id: 'groupPreview' })
