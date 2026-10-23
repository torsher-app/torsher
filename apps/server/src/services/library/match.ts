import type { LibraryFolder, MediaFile } from '../../db/schema.ts'
import type { KindHint } from './recognize.ts'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { matchFiles, parseRelease, titleKey } from '@torsher/release-parser'
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { libraries, libraryFolders, mediaFiles } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { getTitleIdentity, TmdbError } from '../tmdb/index.ts'
import { tmdbGet } from '../tmdb/client.ts'
import { recognizeRelease, rememberUserAlias } from './recognize.ts'

// Папки сезонов внутри папки сериала — часть того же релиза
const SEASON_DIR
  = /^(?:season|сезон|series|s)[\s._-]*\d{1,3}$|^specials?$|^спецвыпуски$/i
const NAME_TMDB = /[[({]tmdb(?:id)?[-=](\d{1,10})[\])}]/i
const NAME_IMDB = /[[({]imdb(?:id)?[-=](tt\d{5,10})[\])}]/i
const NAME_TVDB = /[[({]tvdb(?:id)?[-=](\d{1,10})[\])}]/i

type Found
  = | { status: 'matched', titleId: string, source: 'name_id' | 'nfo' | 'parser' }
    | { status: 'unsure', suggestion: string }
    | { status: 'unmatched' }

function dirsOf(relPath: string) {
  const parts = relPath.split('/')

  parts.pop()

  while (parts.length && SEASON_DIR.test(parts.at(-1)!)) parts.pop()

  return parts.join('/')
}

function fileName(relPath: string) {
  return relPath.slice(relPath.lastIndexOf('/') + 1)
}

/** Ключ названия файла: разные ключи в одной папке — это разные фильмы */
function nameKey(relPath: string) {
  const { ru, orig, translit } = parseRelease(fileName(relPath)).titles

  return titleKey(orig ?? ru ?? translit ?? '')
}

/**
 * Папки-релизы: папка фильма или сериала (папки сезонов — её часть), файл в
 * корне — сам себе релиз. Папка, где лежат разные фильмы россыпью
 * («Фильмы/Матрица.1999.mkv»), делится на релизы по файлу.
 */
export function releaseGroups(relPaths: string[]) {
  const byDir = new Map<string, string[]>()

  for (const relPath of relPaths) {
    const dir = dirsOf(relPath)
    const list = byDir.get(dir) ?? []

    list.push(relPath)
    byDir.set(dir, list)
  }

  const groups = new Map<string, string[]>()

  for (const [dir, files] of byDir) {
    const keys = new Set(files.map(nameKey).filter(Boolean))
    const loose
      = !dir
        || (files.length > 1
          && keys.size > 1
          && !files.some(file =>
            /s\d{1,3}e\d{1,4}|\d{1,2}x\d{2}/i.test(fileName(file)),
          ))

    if (loose) {
      for (const file of files) groups.set(file, [file])
    }
    else {
      groups.set(dir, files)
    }
  }

  return groups
}

function kindOfHint(hint: LibraryFolder['hint']): KindHint | undefined {
  return hint === 'movies' ? 'movie' : hint === 'shows' ? 'series' : undefined
}

/** Есть ли тайтл в каталоге: неверный ID в имени не должен дать пустую карточку */
async function exists(titleId: string) {
  try {
    return !!(await getTitleIdentity(titleId))
  }
  catch (err) {
    if (err instanceof TmdbError && err.kind === 'not_found')
      return false

    throw err
  }
}

/** TMDB ID: вид из подсказки или имени, иначе пробуем фильм, потом сериал */
async function titleFromTmdbId(tmdbId: string, kind: KindHint | undefined) {
  const order: KindHint[] = kind ? [kind] : ['movie', 'series']

  for (const item of order) {
    const id = `tmdb:${item === 'movie' ? 'movie' : 'tv'}:${tmdbId}`

    if (await exists(id))
      return id
  }

  return undefined
}

interface FindResponse {
  movie_results?: Array<{ id: number }>
  tv_results?: Array<{ id: number }>
}

/** IMDb и TVDB ID → тайтл каталога через `/find` */
async function titleFromExternal(id: string, source: 'imdb_id' | 'tvdb_id') {
  const found = await tmdbGet<FindResponse>(`/find/${id}`, {
    external_source: source,
  })
  const movie = found.movie_results?.[0]
  const tv = found.tv_results?.[0]

  if (movie)
    return `tmdb:movie:${movie.id}`

  return tv ? `tmdb:tv:${tv.id}` : undefined
}

async function fromNames(names: string[], kind: KindHint | undefined) {
  for (const name of names) {
    const tmdb = NAME_TMDB.exec(name)?.[1]

    if (tmdb) {
      const id = await titleFromTmdbId(tmdb, kind)

      if (id)
        return id
    }

    const imdb = NAME_IMDB.exec(name)?.[1]

    if (imdb) {
      const id = await titleFromExternal(imdb, 'imdb_id')

      if (id)
        return id
    }

    const tvdb = NAME_TVDB.exec(name)?.[1]

    if (tvdb) {
      const id = await titleFromExternal(tvdb, 'tvdb_id')

      if (id)
        return id
    }
  }

  return undefined
}

/** NFO рядом с релизом (`tvshow.nfo`, `movie.nfo`, `<файл>.nfo`): только ID */
async function fromNfo(dir: string, files: string[]) {
  const entries = await readdir(dir).catch(() => [] as string[])
  const bases = new Set(
    files.map(file => fileName(file).replace(/\.[^.]+$/, '')),
  )
  const nfos = entries.filter(
    name =>
      /^(?:tvshow|movie)\.nfo$/i.test(name)
      || (name.toLowerCase().endsWith('.nfo') && bases.has(name.slice(0, -4))),
  )

  for (const name of nfos) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '')
    const kind: KindHint = /^tvshow\.nfo$/i.test(name) ? 'series' : 'movie'
    const tmdb
      = /<uniqueid[^>]*type="tmdb"[^>]*>\s*(\d+)\s*</i.exec(text)?.[1]
        ?? /<tmdbid>\s*(\d+)\s*</i.exec(text)?.[1]

    if (tmdb) {
      const id = await titleFromTmdbId(tmdb, kind)

      if (id)
        return id
    }

    const imdb
      = /<uniqueid[^>]*type="imdb"[^>]*>\s*(tt\d+)\s*</i.exec(text)?.[1]
        ?? /<imdbid>\s*(tt\d+)\s*</i.exec(text)?.[1]

    if (imdb) {
      const id = await titleFromExternal(imdb, 'imdb_id')

      if (id)
        return id
    }
  }

  return undefined
}

/**
 * Тайтл папки-релиза по сигналам, от сильного к слабому: ID в имени, NFO,
 * разбор имени с поиском по каталогу (там же — выбор владельца для такого же
 * названия, алиас `user`).
 */
async function findTitle(
  folder: LibraryFolder,
  group: string,
  files: string[],
): Promise<Found> {
  // Подсказка папки, иначе вид по файлам: серии и папки сезонов — сериал,
  // хотя в имени папки сериала может стоять год, как у фильма
  const kind
    = kindOfHint(folder.hint)
      ?? (files.some(file =>
        /s\d{1,3}e\d{1,4}|\d{1,2}x\d{2}|(?:^|\/)(?:season|сезон)[\s._-]*\d/i.test(
          file,
        ),
      )
        ? 'series'
        : undefined)
  const groupName = fileName(group)
  const names = [groupName, ...files.map(fileName)]
  const byName = await fromNames(names, kind)

  if (byName)
    return { status: 'matched', titleId: byName, source: 'name_id' }

  const dir
    = files.length === 1 && files[0] === group
      ? join(folder.path, ...dirsOf(group).split('/').filter(Boolean))
      : join(folder.path, ...group.split('/'))
  const byNfo = await fromNfo(dir, files)

  if (byNfo)
    return { status: 'matched', titleId: byNfo, source: 'nfo' }

  // Имя папки без названия («Сезон 1», «Video») — разбираем имя файла
  const releaseName
    = parseRelease(groupName).titles.ru || parseRelease(groupName).titles.orig
      ? groupName
      : fileName(files[0]!)
  const result = await recognizeRelease(releaseName, kind)

  return result.status === 'matched'
    ? { status: 'matched', titleId: result.titleId, source: 'parser' }
    : result
}

export interface PlannedEpisode {
  season: number
  episode: number
  episodeTo: number | null
}

/**
 * Раскладка файлов релиза по тайтлу: фильм — его видео (сезон и серия 0),
 * сериал — серии по `matchFiles` (сезон из папки или имени). `null` — файл не
 * серия этого тайтла: сэмпл, доп или видео без номера
 */
export function planFiles(rows: MediaFile[], group: string, series: boolean) {
  const base
    = rows.length === 1 && rows[0]!.relPath === group ? '' : `${group}/`
  const parsed = parseRelease(fileName(group))
  const matches = matchFiles(
    rows.map(row => ({
      path: row.relPath.slice(base.length),
      size: row.size,
    })),
    parsed,
  )
  const onlySeason
    = parsed.seasons.length === 1 ? parsed.seasons[0] : undefined

  return rows.map(
    (
      row,
      index,
    ): { row: MediaFile, video: boolean, episode: PlannedEpisode | null } => {
      const match = matches[index]
      const video = match?.kind === 'video'

      if (!video)
        return { row, video, episode: null }

      if (!series) {
        return {
          row,
          video,
          episode: { season: 0, episode: 0, episodeTo: null },
        }
      }

      const season = match.season ?? onlySeason

      return {
        row,
        video,
        episode:
          season !== undefined && match.episode !== undefined
            ? {
                season,
                episode: match.episode,
                episodeTo: match.episodeTo ?? null,
              }
            : null,
      }
    },
  )
}

/**
 * Файлы релиза по тайтлу (`planFiles`); `overrides` — номера, исправленные
 * владельцем: `null` — файл не серия. Видео без серии остаются без тайтла и
 * видны в «Без описания»
 */
export function assignFiles(
  rows: MediaFile[],
  group: string,
  titleId: string,
  source: NonNullable<MediaFile['matchSource']>,
  overrides?: Map<string, PlannedEpisode | null>,
) {
  const db = getDb()
  const series = titleId.startsWith('tmdb:tv:')

  for (const { row, video, episode: planned } of planFiles(
    rows,
    group,
    series,
  )) {
    const episode = overrides?.has(row.id) ? overrides.get(row.id)! : planned

    if (!episode) {
      db.update(mediaFiles)
        .set({
          titleId: null,
          season: null,
          episode: null,
          episodeTo: null,
          matchStatus: video ? 'unmatched' : 'ignored',
          matchSuggestion: null,
          matchSource: source,
          matchGroup: group,
        })
        .where(eq(mediaFiles.id, row.id))
        .run()

      continue
    }

    db.update(mediaFiles)
      .set({
        titleId,
        season: episode.season,
        episode: episode.episode,
        episodeTo: episode.episodeTo,
        matchStatus: 'matched',
        matchSuggestion: null,
        matchSource: source,
        matchGroup: group,
      })
      .where(eq(mediaFiles.id, row.id))
      .run()
  }
}

function groupRows(folderId: string, group: string) {
  return getDb()
    .select()
    .from(mediaFiles)
    .where(
      and(eq(mediaFiles.folderId, folderId), eq(mediaFiles.matchGroup, group)),
    )
    .orderBy(mediaFiles.relPath)
    .all()
}

export interface GroupPreviewFile {
  id: string
  relPath: string
  // Не видео-серия (сэмпл, доп): в библиотеку не ляжет, правке не подлежит
  video: boolean
  season: number | null
  episode: number | null
  episodeTo: number | null
}

/** Как файлы релиза лягут под тайтл сериала: для правки номеров в панели */
export function groupPreview(folderId: string, group: string, titleId: string) {
  const rows = groupRows(folderId, group)

  return planFiles(rows, group, titleId.startsWith('tmdb:tv:')).map(
    ({ row, video, episode }): GroupPreviewFile => ({
      id: row.id,
      relPath: row.relPath,
      video,
      season: episode?.season ?? null,
      episode: episode?.episode ?? null,
      episodeTo: episode?.episodeTo ?? null,
    }),
  )
}

function markGroup(
  rows: MediaFile[],
  group: string,
  values: Pick<MediaFile, 'matchStatus' | 'matchSuggestion'>,
) {
  getDb()
    .update(mediaFiles)
    .set({
      ...values,
      titleId: null,
      season: null,
      episode: null,
      episodeTo: null,
      matchSource: 'parser',
      matchGroup: group,
    })
    .where(
      inArray(
        mediaFiles.id,
        rows.map(row => row.id),
      ),
    )
    .run()
}

/** Сопоставляет один релиз; уже решённый (ID, NFO, владелец) — новым файлам тот же тайтл */
async function matchGroup(folder: LibraryFolder, group: string, ids: string[]) {
  const db = getDb()
  const rows = db
    .select()
    .from(mediaFiles)
    .where(and(eq(mediaFiles.folderId, folder.id), inArray(mediaFiles.id, ids)))
    .all()

  if (!rows.length)
    return

  const decided = db
    .select({
      titleId: mediaFiles.titleId,
      source: mediaFiles.matchSource,
      status: mediaFiles.matchStatus,
    })
    .from(mediaFiles)
    .where(
      and(
        eq(mediaFiles.folderId, folder.id),
        eq(mediaFiles.matchGroup, group),
        inArray(mediaFiles.matchSource, ['name_id', 'nfo', 'user']),
      ),
    )
    .get()

  if (decided?.status === 'ignored' && decided.source === 'user') {
    markGroup(rows, group, { matchStatus: 'ignored', matchSuggestion: null })
    return
  }

  if (decided?.titleId && decided.source) {
    assignFiles(rows, group, decided.titleId, decided.source)
    return
  }

  const found = await findTitle(
    folder,
    group,
    rows.map(row => row.relPath),
  )

  if (found.status === 'matched') {
    assignFiles(rows, group, found.titleId, found.source)
  }
  else if (found.status === 'unsure') {
    markGroup(rows, group, {
      matchStatus: 'unsure',
      matchSuggestion: found.suggestion,
    })
  }
  else {
    markGroup(rows, group, { matchStatus: 'unmatched', matchSuggestion: null })
  }
}

const queue = new Map<
  string,
  { folderId: string, group: string, ids: Set<string> }
>()
let draining: Promise<void> | undefined

async function drain() {
  for (const [key, task] of queue) {
    queue.delete(key)

    const folder = getDb()
      .select()
      .from(libraryFolders)
      .where(eq(libraryFolders.id, task.folderId))
      .get()

    if (!folder)
      continue

    try {
      await matchGroup(folder, task.group, [...task.ids])
    }
    catch (err) {
      // Каталог недоступен — файл останется «распознаётся» до следующего скана
      logFor('catalog').warn(
        { err, folderId: folder.id, group: task.group },
        'Library match failed',
      )
    }
  }
}

/**
 * Файлы подключённой папки «Фильмы и сериалы» — в очередь сопоставления по
 * релизам: по одному, запросы к каталогу не толпятся.
 */
export function queueMatch(folderId: string, ids: string[]) {
  if (!ids.length)
    return draining ?? Promise.resolve()

  const rows = getDb()
    .select({
      id: mediaFiles.id,
      relPath: mediaFiles.relPath,
      group: mediaFiles.matchGroup,
    })
    .from(mediaFiles)
    .where(inArray(mediaFiles.id, ids))
    .all()
  const known = rows.filter(row => row.group)
  const fresh = rows.filter(row => !row.group)

  for (const row of known) add(folderId, row.group!, row.id)

  for (const [group, paths] of releaseGroups(fresh.map(row => row.relPath))) {
    for (const path of paths)
      add(folderId, group, fresh.find(row => row.relPath === path)!.id)
  }

  draining ??= drain().finally(() => {
    draining = undefined

    if (queue.size)
      void queueMatch(folderId, [])
  })

  return draining
}

function add(folderId: string, group: string, id: string) {
  const key = `${folderId}\u0000${group}`
  const task = queue.get(key) ?? { folderId, group, ids: new Set<string>() }

  task.ids.add(id)
  queue.set(key, task)
}

/** Только для тестов: дождаться очереди */
export function matchIdle() {
  return draining ?? Promise.resolve()
}

/** Файлы видео-библиотек, которые ещё не сопоставляли: после старта и сбоя каталога */
export function queueUnmatched() {
  const rows = getDb()
    .select({ id: mediaFiles.id, folderId: mediaFiles.folderId })
    .from(mediaFiles)
    .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(
      and(
        eq(libraries.kind, 'video'),
        eq(libraries.managed, false),
        eq(mediaFiles.state, 'present'),
        isNull(mediaFiles.matchStatus),
      ),
    )
    .all()
  const byFolder = new Map<string, string[]>()

  for (const row of rows)
    byFolder.set(row.folderId, [...(byFolder.get(row.folderId) ?? []), row.id])

  for (const [folderId, ids] of byFolder) void queueMatch(folderId, ids)
}

/**
 * «Исправить совпадение» в панели: тайтл всему релизу, название запоминается
 * алиасом `user` — такое же имя в другой папке узнаётся само. `null` — «не
 * фильм и не сериал»: файлы остаются в «Без описания».
 */
export function setGroupTitle(
  folderId: string,
  group: string,
  titleId: string | null,
  overrides?: Map<string, PlannedEpisode | null>,
) {
  const rows = groupRows(folderId, group)

  if (!rows.length)
    return 0

  if (titleId) {
    assignFiles(rows, group, titleId, 'user', overrides)
    rememberUserAlias(titleId, fileName(group))
  }
  else {
    getDb()
      .update(mediaFiles)
      .set({
        titleId: null,
        season: null,
        episode: null,
        episodeTo: null,
        matchStatus: 'ignored',
        matchSuggestion: null,
        matchSource: 'user',
      })
      .where(
        inArray(
          mediaFiles.id,
          rows.map(row => row.id),
        ),
      )
      .run()
  }

  return rows.length
}

export interface UnmatchedGroup {
  folderId: string
  libraryName: string
  group: string
  name: string
  status: 'unsure' | 'unmatched'
  suggestion: string | null
  files: number
  size: number
}

/** «Нераспознанное» панели: релизы подключённых папок без тайтла, «похоже» первыми */
export function unmatchedGroups(): UnmatchedGroup[] {
  const rows = getDb()
    .select({
      folderId: mediaFiles.folderId,
      libraryName: libraries.name,
      group: mediaFiles.matchGroup,
      status: mediaFiles.matchStatus,
      suggestion: mediaFiles.matchSuggestion,
      size: mediaFiles.size,
    })
    .from(mediaFiles)
    .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(
      and(
        eq(libraries.kind, 'video'),
        eq(libraries.managed, false),
        eq(mediaFiles.state, 'present'),
        inArray(mediaFiles.matchStatus, ['unsure', 'unmatched']),
        // Владелец уже решил: файл не серия этого тайтла — вопроса больше нет
        or(isNull(mediaFiles.matchSource), ne(mediaFiles.matchSource, 'user')),
      ),
    )
    .all()
  const groups = new Map<string, UnmatchedGroup>()

  for (const row of rows) {
    if (!row.group)
      continue

    const key = `${row.folderId}\u0000${row.group}`
    const found = groups.get(key)

    if (found) {
      found.files++
      found.size += row.size
      continue
    }

    groups.set(key, {
      folderId: row.folderId,
      libraryName: row.libraryName,
      group: row.group,
      name: fileName(row.group),
      status: row.status as UnmatchedGroup['status'],
      suggestion: row.suggestion,
      files: 1,
      size: row.size,
    })
  }

  return [...groups.values()].sort(
    (a, b) =>
      Number(b.status === 'unsure') - Number(a.status === 'unsure')
      || a.name.localeCompare(b.name),
  )
}
