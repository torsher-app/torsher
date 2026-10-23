import type {
  CatalogRow,
  FileCard,
  FilesRow,
  HomeMode,
  ReleasesRow,
} from '../../dto/home.ts'
import type { MediaFile } from '../../db/schema.ts'
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  max,
} from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mediaFiles, titleProgress } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { cardsOf } from '../mine/cards.ts'
import { fileProgressId } from './files.ts'
import { albumOf } from './homeVideo.ts'
import { visibleFolderIds, visibleFolderLibraries } from './folders.ts'
import { unmatchedReleases } from './unmatched.ts'

const ROW_LIMIT = 20
// «Недавно добавлено» — за последний месяц
const RECENT_MS = 30 * 24 * 60 * 60 * 1000

interface TitleQuery {
  type?: 'movie' | 'tv'
  since?: Date
  limit: number
  // Папки библиотек, которые видит профиль
  folders?: string[]
}

/** Тайтлы с файлами в библиотеке — по последнему добавлению, свежие первыми */
export function libraryTitles(query: TitleQuery) {
  const latest = max(mediaFiles.addedAt)

  return getDb()
    .select({ titleId: mediaFiles.titleId, latest })
    .from(mediaFiles)
    .where(
      and(
        eq(mediaFiles.state, 'present'),
        isNotNull(mediaFiles.titleId),
        query.type
          ? like(mediaFiles.titleId, `tmdb:${query.type}:%`)
          : undefined,
        query.since ? gte(mediaFiles.addedAt, query.since) : undefined,
        query.folders ? inArray(mediaFiles.folderId, query.folders) : undefined,
      ),
    )
    .groupBy(mediaFiles.titleId)
    .orderBy(desc(latest))
    .limit(query.limit)
    .all()
    .map(row => row.titleId!)
}

/** Есть ли у тайтлов файлы в библиотеке: «Продолжить» раздела «Библиотека» */
export function libraryTitleSet(profileId: string) {
  return new Set(
    libraryTitles({ limit: 10_000, folders: visibleFolderIds(profileId) }),
  )
}

/** Имя файла для карточки: без папок и расширения */
export function fileTitleOf(relPath: string) {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')

  return dot > 0 ? name.slice(0, dot) : name
}

/** Карточки файлов без тайтла: кадр, имя, длительность и доля просмотренного */
export function fileCardsOf(rows: MediaFile[], profileId: string): FileCard[] {
  const progress = rows.length
    ? getDb()
        .select({
          titleId: titleProgress.titleId,
          position: titleProgress.position,
          duration: titleProgress.duration,
        })
        .from(titleProgress)
        .where(
          and(
            eq(titleProgress.profileId, profileId),
            inArray(
              titleProgress.titleId,
              rows.map(row => fileProgressId(row.id)),
            ),
          ),
        )
        .all()
    : []
  const byId = new Map(progress.map(row => [row.titleId, row]))

  return rows.map((row) => {
    const seen = byId.get(fileProgressId(row.id))
    const duration = row.duration ?? seen?.duration ?? null

    return {
      id: row.id,
      name: fileTitleOf(row.relPath),
      // У видео без альбома — папка файла: «clip01» из «Concert Live» узнаваем по ней
      album: row.album ?? albumOf(row.relPath),
      capturedAt: row.capturedAt?.toISOString() ?? null,
      duration,
      share: seen && duration ? Math.min(1, seen.position / duration) : 0,
      thumb: `/api/library/files/${row.id}/thumb`,
    }
  })
}

function untitledWhere(profileId: string) {
  const folders = visibleFolderIds(profileId, 'video')

  return folders.length
    ? and(
        inArray(mediaFiles.folderId, folders),
        eq(mediaFiles.state, 'present'),
        isNull(mediaFiles.titleId),
      )
    : undefined
}

function homeWhere(
  profileId: string,
  query: { album?: string, libraryId?: string } = {},
) {
  const folders = visibleFolderIds(profileId, 'home', query.libraryId)

  return folders.length
    ? and(
        inArray(mediaFiles.folderId, folders),
        eq(mediaFiles.state, 'present'),
        query.album === undefined
          ? undefined
          : eq(mediaFiles.album, query.album),
      )
    : undefined
}

function countWhere(where: ReturnType<typeof and>) {
  if (!where)
    return 0

  return (
    getDb().select({ n: count() }).from(mediaFiles).where(where).get()?.n ?? 0
  )
}

/** Файлы без описания: видео без тайтла в библиотеках «Фильмы и сериалы», свежие первыми */
export function untitledFiles(profileId: string, limit = ROW_LIMIT) {
  const where = untitledWhere(profileId)

  if (!where)
    return []

  return getDb()
    .select()
    .from(mediaFiles)
    .where(where)
    .orderBy(desc(mediaFiles.addedAt))
    .limit(limit)
    .all()
}

/** Домашнее видео профиля: по дате съёмки, новые сверху; `album` — только альбом */
export function homeVideos(
  profileId: string,
  query: { album?: string, libraryId?: string, limit?: number } = {},
) {
  const where = homeWhere(profileId, query)

  if (!where)
    return []

  return getDb()
    .select()
    .from(mediaFiles)
    .where(where)
    .orderBy(desc(mediaFiles.capturedAt), mediaFiles.relPath)
    .limit(query.limit ?? 2000)
    .all()
}

export interface HomeAlbum {
  libraryId: string
  album: string
  count: number
  from: string | null
  to: string | null
  coverId: string
}

/** Альбомы — папки домашнего видео: по самой поздней дате внутри, обложка — первое видео */
export function homeAlbums(profileId: string): HomeAlbum[] {
  const rows = homeVideos(profileId)
  const folders = new Map(
    visibleFolderLibraries(profileId).map(row => [row.id, row.libraryId]),
  )
  const albums = new Map<string, HomeAlbum>()

  for (const row of rows) {
    const libraryId = folders.get(row.folderId)!
    const key = `${libraryId}\u0000${row.album ?? ''}`
    const at = row.capturedAt?.toISOString() ?? null
    const found = albums.get(key)

    if (found) {
      found.count++
      if (at && (!found.from || at < found.from))
        found.from = at
      continue
    }

    // Строки идут от новых к старым: первая — самая поздняя дата и обложка
    albums.set(key, {
      libraryId,
      album: row.album ?? '',
      count: 1,
      from: at,
      to: at,
      coverId: row.id,
    })
  }

  return [...albums.values()]
}

const SECTION: Array<{ id: CatalogRow['id'], query: () => TitleQuery }> = [
  {
    id: 'libraryRecent',
    query: () => ({
      since: new Date(Date.now() - RECENT_MS),
      limit: ROW_LIMIT,
    }),
  },
  { id: 'libraryMovies', query: () => ({ type: 'movie', limit: ROW_LIMIT }) },
  { id: 'librarySeries', query: () => ({ type: 'tv', limit: ROW_LIMIT }) },
]

/**
 * Ряды файлов раздела «Библиотека»: «Домашнее видео» (свежие по дате съёмки) и
 * «Без описания» (видео без тайтла — их смотрят, пока владелец не сопоставит)
 */
export function libraryFileRows(mode: HomeMode, profileId: string): FilesRow[] {
  if (mode !== 'library')
    return []

  const rows: FilesRow[] = [
    {
      id: 'libraryHomeVideo',
      kind: 'files',
      title: 'home.rows.libraryHomeVideo',
      items: fileCardsOf(
        homeVideos(profileId, { limit: ROW_LIMIT }),
        profileId,
      ),
      total: countWhere(homeWhere(profileId)),
    },
    {
      id: 'libraryUntitled',
      kind: 'files',
      title: 'home.rows.libraryUntitled',
      items: fileCardsOf(untitledFiles(profileId), profileId),
      total: countWhere(untitledWhere(profileId)),
    },
  ]

  return rows.filter(row => row.items.length > 0)
}

/**
 * «Нужно указать тайтл» — первым рядом раздела «Библиотека», только тем, кто
 * может перекладывать библиотеку: имена раздач не проходят фильтр возраста
 */
export async function unmatchedHomeRow(
  mode: HomeMode,
  language: string,
  canManage: boolean,
): Promise<ReleasesRow[]> {
  if (mode !== 'library' || !canManage)
    return []

  const items = await unmatchedReleases(language)

  return items.length
    ? [
        {
          id: 'libraryUnmatched',
          kind: 'releases',
          title: 'home.rows.libraryUnmatched',
          items,
        },
      ]
    : []
}

/**
 * Ряды библиотеки: на главной — «Моя библиотека», в разделе «Библиотека» —
 * «Недавно добавлено», «Фильмы» и «Сериалы». Пустые не отдаются.
 */
export async function libraryHomeRows(
  mode: HomeMode,
  language: string,
  profileId: string,
): Promise<CatalogRow[]> {
  const folders = visibleFolderIds(profileId)
  const specs
    = mode === 'library'
      ? SECTION
      : mode === 'all'
        ? [{ id: 'library' as const, query: () => ({ limit: ROW_LIMIT }) }]
        : []
  const results = await Promise.allSettled(
    specs.map(async (spec) => {
      const ids = libraryTitles({ ...spec.query(), folders })

      return {
        id: spec.id,
        kind: 'posters' as const,
        title: `home.rows.${spec.id}`,
        items: ids.length ? await cardsOf(ids, language) : [],
      }
    }),
  )

  return results.flatMap((result) => {
    if (result.status === 'rejected') {
      logFor('catalog').warn({ err: result.reason }, 'Library home row failed')
      return []
    }

    return result.value.items.length ? [result.value] : []
  })
}
