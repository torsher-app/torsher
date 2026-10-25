import type { LibraryFolder, MediaLinkMode, Torrent } from '../../db/schema.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import type { TitleIdentity } from '../tmdb/index.ts'
import type { LayoutEpisode, LayoutTitle } from './layout.ts'
import { stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mediaFiles, profiles, torrents } from '../../db/schema.ts'
import { isEngineReady } from '../engine/index.ts'
import { logFor } from '../logs/index.ts'
import { findSidecars } from '../media/subtitles.ts'
import { torrentDir } from '../storage/paths.ts'
import { getTitleIdentity } from '../tmdb/index.ts'
import { liveTorrents, setRetention } from '../torrents/index.ts'
import {
  existingTitleFolder,
  managedFolder,
  managedFolders,
  torrentLibraryFiles,
} from './files.ts'
import { extensionOf, otherPath, sidecarPath, videoPath } from './layout.ts'
import { placeFile } from './link.ts'
import { queueProbe } from './probe.ts'

/** Видеофайл раздачи, который ляжет в раскладку, и его серия */
export interface PlannedVideo {
  fileIndex: number
  episode?: LayoutEpisode
}

/**
 * Что из раздачи пойдёт в библиотеку. Фильм — крупнейшее видео (как при
 * просмотре), сериал — видео с номером серии по `matchFiles`; сезон без
 * номера в файле — сезон раздачи, а у сериала из одного сезона — он.
 * Сэмплы, допы и видео без номера серии остаются в загрузках.
 */
export function planVideos(
  torrent: Pick<Torrent, 'name' | 'files'>,
  kind: 'movie' | 'series',
  seasonCount?: number[],
): PlannedVideo[] {
  const entries = (torrent.files ?? [])
    .map((file, index) => ({ ...file, index }))
    .filter(file => !file.padding)
  const parsed = parseRelease(torrent.name)
  const matches = matchFiles(
    entries.map(({ path, size }) => ({ path, size })),
    parsed,
  )
  const videos = entries.filter((_, i) => matches[i]?.kind === 'video')

  if (kind === 'movie') {
    const largest = videos.reduce<(typeof videos)[number] | undefined>(
      (best, file) => (!best || file.size > best.size ? file : best),
      undefined,
    )

    return largest ? [{ fileIndex: largest.index }] : []
  }

  const onlySeason
    = parsed.seasons.length === 1
      ? parsed.seasons[0]
      : seasonCount?.length === 1
        ? seasonCount[0]
        : undefined

  return entries.flatMap((file, i) => {
    const match = matches[i]

    if (match?.kind !== 'video' || match.episode === undefined)
      return []

    const season = match.season ?? onlySeason

    if (season === undefined)
      return []

    return [
      {
        fileIndex: file.index,
        episode: {
          season,
          episode: match.episode,
          episodeTo: match.episodeTo,
        },
      },
    ]
  })
}

/** Название папки — на языке первого профиля, иначе английское или оригинальное */
export function layoutTitleOf(
  identity: TitleIdentity,
  language: string | null,
): LayoutTitle {
  const lang = language?.slice(0, 2)
  const names = identity.names
  const name
    = names.find(item => item.kind === 'official' && item.lang === lang)
      ?? names.find(item => item.kind === 'official' && item.lang === 'en')
      ?? names.find(item => item.kind === 'original')
      ?? names[0]

  return {
    kind: identity.kind,
    name: name?.value ?? String(identity.tmdbId),
    year: identity.year,
    tmdbId: identity.tmdbId,
  }
}

function metadataLanguage() {
  return (
    getDb()
      .select({ language: profiles.language })
      .from(profiles)
      .orderBy(profiles.position)
      .get()
      ?.language ?? null
  )
}

export function isInside(base: string, path: string) {
  const rel = relative(base, path)

  return (
    rel !== ''
    && rel !== '..'
    && !rel.startsWith(`..${sep}`)
    && !isAbsolute(rel)
  )
}

/** Путь в папке библиотеки; имя из раздачи не выводит запись за её пределы */
export function libraryPath(folder: LibraryFolder, relPath: string) {
  const absolute = join(folder.path, ...relPath.split('/'))

  if (!isInside(folder.path, absolute))
    throw new Error('Library path is outside the folder')

  return absolute
}

/**
 * Где файл раздачи лежит в загрузках: движок кладёт его в каталог с именем
 * раздачи, а раздачу из одного файла — прямо в каталог раздачи. Путь из
 * чужого `.torrent` за пределы загрузок не выходит.
 */
export async function sourcePathOf(torrent: Torrent, fileIndex: number) {
  const file = torrent.files?.[fileIndex]

  if (!file)
    return undefined

  const base = resolve(torrentDir(torrent))
  const parts = file.path.split('/')
  const candidates = [
    resolve(base, torrent.name, ...parts),
    resolve(base, ...parts),
  ]

  for (const candidate of candidates) {
    if (!isInside(base, candidate))
      continue

    const found = await stat(candidate).catch(() => undefined)

    if (found?.isFile() && found.size === file.size)
      return candidate
  }

  return undefined
}

function isComplete(
  torrent: Torrent,
  state: EngineTorrentState,
  fileIndex: number,
) {
  const size = torrent.files?.[fileIndex]?.size ?? 0

  return size > 0 && (state.fileProgress[fileIndex] ?? 0) >= size
}

async function exists(path: string) {
  return stat(path).then(
    found => found,
    () => undefined,
  )
}

/**
 * Свободное имя для видео: занятое другим файлом — вторая версия
 * (`… - 2160p`), затем `… - 2`, `… - 3`.
 */
async function freeVideoPath(
  folder: LibraryFolder,
  make: (version?: string) => string,
  source: string,
  quality: string | undefined,
) {
  const sourceInode = (await stat(source)).ino
  const versions = [undefined, quality, '2', '3', '4', '5']

  for (const version of versions) {
    const relPath = make(version)
    const found = await exists(libraryPath(folder, relPath))

    // Тот же файл уже лежит (база потеряла запись) — регистрируем его
    if (!found || found.ino === sourceInode)
      return { relPath, version, adopt: !!found }
  }

  return undefined
}

async function placeVideo(
  folder: LibraryFolder,
  torrent: Torrent,
  title: LayoutTitle,
  planned: PlannedVideo,
) {
  const source = await sourcePathOf(torrent, planned.fileIndex)

  if (!source)
    return

  const file = torrent.files![planned.fileIndex]!
  const existingFolder = existingTitleFolder(folder.id, torrent.titleId!)
  const quality = parseRelease(torrent.name).quality
  const notPlaced = (err: unknown) =>
    logFor('storage').error(
      { err, torrentId: torrent.id, fileIndex: planned.fileIndex },
      'Library file was not placed',
    )
  let target: Awaited<ReturnType<typeof freeVideoPath>>

  try {
    target = await freeVideoPath(
      folder,
      (version) => {
        const path = videoPath(
          title,
          extensionOf(file.path),
          planned.episode,
          version,
        )

        // Новые файлы тайтла — в его уже существующую папку
        return existingFolder
          ? [existingFolder, ...path.split('/').slice(2)].join('/')
          : path
      },
      source,
      quality,
    )
  }
  catch (err) {
    notPlaced(err)
    return
  }

  if (!target)
    return

  let absolute: string
  let linkMode: MediaLinkMode

  try {
    absolute = libraryPath(folder, target.relPath)
    linkMode = target.adopt ? 'hardlink' : await placeFile(source, absolute)
  }
  catch (err) {
    notPlaced(err)
    return
  }

  const placed = await stat(absolute)
  const row = getDb()
    .insert(mediaFiles)
    .values({
      folderId: folder.id,
      relPath: target.relPath,
      size: placed.size,
      mtime: placed.mtime,
      inode: placed.ino,
      torrentId: torrent.id,
      fileIndex: planned.fileIndex,
      linkMode,
      titleId: torrent.titleId,
      season: planned.episode?.season ?? 0,
      episode: planned.episode?.episode ?? 0,
      episodeTo: planned.episode?.episodeTo ?? null,
      version: target.version ?? null,
      matchStatus: 'matched',
      matchSource: 'torrent',
    })
    .onConflictDoNothing()
    .returning()
    .get()

  if (!row)
    return

  logFor('storage').info(
    { torrentId: torrent.id, fileIndex: planned.fileIndex, linkMode },
    'Library file added',
  )
  queueProbe(row.id)
}

/** Субтитры и дорожки серии — рядом с её файлом, когда скачаны целиком */
async function placeSidecars(torrent: Torrent, state: EngineTorrentState) {
  const folders = new Map(
    managedFolders().map(folder => [folder.id, folder]),
  )

  for (const video of torrentLibraryFiles(torrent.id)) {
    const folder = folders.get(video.folderId)

    if (video.fileIndex === null || !folder)
      continue

    const taken = new Set<string>()

    for (const sidecar of findSidecars(torrent.files ?? [], video.fileIndex)) {
      // `forced` в пометках имени уже есть отдельным признаком
      const title = sidecar.title
        ?.split(' ')
        .filter(word => word !== 'forced')
        .join(' ')
      const tags = [
        title,
        sidecar.language,
        sidecar.forced ? 'forced' : null,
      ].filter((tag): tag is string => !!tag)
      let relPath = sidecarPath(video.relPath, sidecar.extension, tags)

      // Две дорожки с одинаковыми пометками — номер, порядок файлов раздачи
      for (let n = 2; taken.has(relPath); n++) {
        relPath = sidecarPath(video.relPath, sidecar.extension, [
          ...tags,
          String(n),
        ])
      }

      taken.add(relPath)

      if (!isComplete(torrent, state, sidecar.fileIndex))
        continue

      try {
        const absolute = libraryPath(folder, relPath)

        if (await exists(absolute))
          continue

        const source = await sourcePathOf(torrent, sidecar.fileIndex)

        if (!source)
          continue

        await placeFile(source, absolute)
      }
      catch (err) {
        logFor('storage').warn(
          { err, torrentId: torrent.id, fileIndex: sidecar.fileIndex },
          'Library sidecar was not placed',
        )
      }
    }
  }
}

/**
 * Копия заняла второе место на диске: когда всё выбранное лежит в
 * библиотеке, раздача возвращается в кэш и раздаётся, пока её не вытеснят.
 */
async function releaseCopies(torrent: Torrent, planned: PlannedVideo[]) {
  const files = torrentLibraryFiles(torrent.id)

  if (!files.some(file => file.linkMode === 'copy'))
    return

  const placed = new Set(files.map(file => file.fileIndex))
  const selected = new Set(torrent.selectedFiles ?? [])
  const waiting = planned.some(
    item => selected.has(item.fileIndex) && !placed.has(item.fileIndex),
  )

  if (waiting)
    return

  await setRetention(torrent, 'cache')
  logFor('storage').info(
    { torrentId: torrent.id },
    'Torrent returned to cache after library copy',
  )
}

/**
 * Раздача «не фильм и не сериал»: её видео — в `other/` без тайтла, на
 * витрине они в «Без описания». Сэмплы и допы не кладём
 */
async function linkOther(
  folder: LibraryFolder,
  torrent: Torrent,
  state: EngineTorrentState,
) {
  const entries = torrent.files ?? []
  const matches = matchFiles(
    entries.map(({ path, size }) => ({ path, size })),
    parseRelease(torrent.name),
  )
  const selected = new Set(torrent.selectedFiles ?? [])
  const placed = new Set(
    torrentLibraryFiles(torrent.id).map(file => file.fileIndex),
  )

  for (const [index, file] of entries.entries()) {
    if (
      file.padding
      || matches[index]?.kind !== 'video'
      || (selected.size && !selected.has(index))
      || placed.has(index)
      || !isComplete(torrent, state, index)
    ) {
      continue
    }

    const source = await sourcePathOf(torrent, index)

    if (!source)
      continue

    const relPath = otherPath(torrent.name, file.path)
    let absolute: string
    let linkMode: MediaLinkMode

    try {
      absolute = libraryPath(folder, relPath)
      linkMode = (await exists(absolute))
        ? 'hardlink'
        : await placeFile(source, absolute)
    }
    catch (err) {
      logFor('storage').error(
        { err, torrentId: torrent.id, fileIndex: index },
        'Library file was not placed',
      )
      continue
    }

    const info = await stat(absolute)
    const row = getDb()
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath,
        size: info.size,
        mtime: info.mtime,
        inode: info.ino,
        torrentId: torrent.id,
        fileIndex: index,
        linkMode,
        matchStatus: 'ignored',
        matchSource: 'user',
        matchGroup: relPath.split('/').slice(0, 2).join('/'),
      })
      .onConflictDoNothing()
      .returning()
      .get()

    if (row)
      queueProbe(row.id)
  }

  return true
}

/** Раскладывает раздачу; `false` — каталог недоступен, пройти её ещё раз */
async function linkTorrent(
  folder: LibraryFolder,
  torrent: Torrent,
  state: EngineTorrentState,
  language: string | null,
) {
  if (!torrent.titleId)
    return linkOther(folder, torrent, state)

  const kind = torrent.titleId.startsWith('tmdb:movie:') ? 'movie' : 'series'
  const placed = new Set(
    torrentLibraryFiles(torrent.id).map(file => file.fileIndex),
  )
  let planned = planVideos(torrent, kind)
  const ready = (items: PlannedVideo[]) =>
    items.filter(
      item =>
        !placed.has(item.fileIndex)
        && isComplete(torrent, state, item.fileIndex),
    )

  if (ready(planned).length || (kind === 'series' && !planned.length)) {
    let identity: TitleIdentity | undefined

    try {
      identity = await getTitleIdentity(torrent.titleId!)
    }
    catch (err) {
      // Каталог недоступен — разложим на следующем проходе
      logFor('storage').debug(
        { err, torrentId: torrent.id },
        'Library title is unavailable',
      )
      return false
    }

    if (!identity)
      return true

    if (kind === 'series') {
      const seasons = Object.keys(identity.episodeCounts ?? {})
        .map(Number)
        .filter(season => season > 0)

      planned = planVideos(torrent, kind, seasons)
    }

    const title = layoutTitleOf(identity, language)

    for (const item of ready(planned))
      await placeVideo(folder, torrent, title, item)
  }

  await placeSidecars(torrent, state)
  await releaseCopies(torrent, planned)
  return true
}

// Что было у раздачи на прошлом удачном проходе: не изменилось — разбирать
// пак заново незачем. Проход идёт раз в минуту, а закреплённых раздач много
const passed = new Map<string, string>()

function signatureOf(torrent: Torrent, state: EngineTorrentState) {
  return [
    state.bytesCompleted,
    torrentLibraryFiles(torrent.id).length,
    torrent.titleId,
    torrent.matchStatus,
    torrent.selectedFiles?.join(','),
  ].join(':')
}

/**
 * Пройти все раздачи заново: после переноса папок хардлинки могли стать
 * копиями, и раздача должна вернуться в кэш, хотя скачанное не менялось
 */
export function forgetLibraryPasses() {
  passed.clear()
}

async function runSync() {
  if (!isEngineReady())
    return

  const rows = getDb()
    .select()
    .from(torrents)
    .where(
      and(
        eq(torrents.retention, 'keep'),
        eq(torrents.status, 'ready'),
        eq(torrents.inEngine, true),
        // «Не фильм и не сериал» тоже: их видео — в `other/`
        or(isNotNull(torrents.titleId), eq(torrents.matchStatus, 'ignored')),
      ),
    )
    .all()

  if (!rows.length) {
    passed.clear()
    return
  }

  const live = await liveTorrents()
  const folder = managedFolder()
  const language = metadataLanguage()

  for (const row of rows) {
    const state = live.get(row.infoHash)

    if (!state)
      continue

    const before = signatureOf(row, state)

    if (passed.get(row.id) === before)
      continue

    if (await linkTorrent(folder, row, state, language))
      passed.set(row.id, signatureOf(row, state))
  }

  const ids = new Set(rows.map(row => row.id))

  for (const id of passed.keys()) {
    if (!ids.has(id))
      passed.delete(id)
  }
}

let running: Promise<void> | undefined
let again = false

/**
 * Раскладывает скачанные целиком файлы закреплённых раздач с тайтлом. Проход
 * один за раз; запрос во время прохода запускает ещё один после него.
 */
export function syncLibrary(): Promise<void> {
  if (running) {
    again = true
    return running
  }

  running = runSync()
    .catch(err => logFor('storage').error({ err }, 'Library sync failed'))
    .finally(() => {
      running = undefined

      if (again) {
        again = false
        void syncLibrary()
      }
    })

  return running
}
