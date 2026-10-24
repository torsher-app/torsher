import type { EngineTorrentState } from '../engine/index.ts'
import type { StorageKind, StoragePathSource } from './paths.ts'
import { randomBytes } from 'node:crypto'
import { stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import {
  libraries,
  libraryFolders,
  mediaFiles,
  torrents,
} from '../../db/schema.ts'
import { managedFolder, managedFolders } from '../library/files.ts'
import { overlaps } from '../library/folders.ts'
import { probeLinkMode } from '../library/link.ts'
import { diskUsage } from './disk.ts'
import {
  envStoragePath,
  storagePath,
  storagePathSource,
  torrentDir,
} from './paths.ts'

export type StoragePathProblem
  = | 'not_absolute'
    | 'not_directory'
    | 'denied'
    | 'inside_data'
    | 'overlaps_other'
    | 'library_folder'

/** Папку нельзя выбрать: причина для панели */
export class StoragePathError extends Error {
  readonly kind: StoragePathProblem

  constructor(kind: StoragePathProblem) {
    super(`Storage path rejected: ${kind}`)
    this.name = 'StoragePathError'
    this.kind = kind
  }
}

/** Ближайший существующий каталог: сам путь или родитель, где его создадут */
export async function existingDir(path: string) {
  let current = path

  for (;;) {
    const found = await stat(current).catch(
      (err: NodeJS.ErrnoException) => err,
    )

    if (!(found instanceof Error))
      return found.isDirectory() ? current : null

    const parent = dirname(current)

    if (found.code !== 'ENOENT' || parent === current)
      return null

    current = parent
  }
}

// Права и ACL по `access` врут на сетевых и read-only томах, поэтому пишем
// настоящий файл и сразу удаляем
export async function canWrite(dir: string) {
  const probe = join(dir, `.torsher-write-${randomBytes(6).toString('hex')}`)

  try {
    await writeFile(probe, '')
    await unlink(probe)

    return true
  }
  catch {
    return false
  }
}

async function deviceOf(path: string) {
  const dir = await existingDir(path)

  return dir ? (await stat(dir)).dev : undefined
}

/** Две папки на одном томе: перенос между ними — хардлинки, место не нужно */
async function onSameVolume(a: string, b: string) {
  const [first, second] = await Promise.all([deviceOf(a), deviceOf(b)])

  return first !== undefined && first === second
}

/** Подмена в тестах: разные тома на одной ФС */
export const volumeDeps = { sameVolume: onSameVolume }

export function sameVolume(a: string, b: string) {
  return volumeDeps.sameVolume(a, b)
}

function otherKind(kind: StorageKind): StorageKind {
  return kind === 'downloads' ? 'library' : 'downloads'
}

/**
 * Можно ли выбрать путь: абсолютный, не пересекается с каталогом данных,
 * папкой другого вида и подключёнными папками пользователя (они только на
 * чтение). Путь окружения разрешён всегда: это «по умолчанию».
 */
export function pathProblem(
  kind: StorageKind,
  path: string,
): StoragePathProblem | null {
  if (!isAbsolute(path))
    return 'not_absolute'

  const target = resolve(path)

  if (target === envStoragePath(kind))
    return null

  if (overlaps(target, resolve(config.dataDir)))
    return 'inside_data'

  const other = otherKind(kind)

  if (
    overlaps(target, storagePath(other))
    || overlaps(target, envStoragePath(other))
  ) {
    return 'overlaps_other'
  }

  const userFolders = getDb()
    .select({ path: libraryFolders.path })
    .from(libraryFolders)
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(eq(libraries.managed, false))
    .all()

  if (userFolders.some(folder => overlaps(target, folder.path)))
    return 'library_folder'

  return null
}

export interface StoragePathCheck {
  path: string
  problem: StoragePathProblem | null
  exists: boolean
  writable: boolean
  total: number
  free: number
  /** На одном томе с текущей папкой этого вида: перенос места не займёт */
  sameVolume: boolean
  /** Как файлы попадут из загрузок в библиотеку с этой папкой */
  linkMode: 'hardlink' | 'reflink' | 'copy' | null
}

/** Проверка папки в диалоге выбора: на каждом шаге обзора */
export async function checkStoragePath(
  kind: StorageKind,
  path: string,
): Promise<StoragePathCheck> {
  const problem = pathProblem(kind, path)
  const target = isAbsolute(path) ? resolve(path) : path
  const empty = {
    path: target,
    problem,
    exists: false,
    writable: false,
    total: 0,
    free: 0,
    sameVolume: false,
    linkMode: null,
  }

  if (problem === 'not_absolute')
    return empty

  const existing = await existingDir(target)

  if (!existing) {
    const found = await stat(target).catch(() => undefined)

    return {
      ...empty,
      problem: problem ?? (found ? 'not_directory' : 'denied'),
    }
  }

  const [writable, disk, same] = await Promise.all([
    canWrite(existing),
    diskUsage(existing),
    sameVolume(target, storagePath(kind)),
  ])
  const pair
    = kind === 'downloads'
      ? [target, storagePath('library')]
      : [storagePath('downloads'), target]
  const linkMode
    = writable && !problem ? await probeLinkMode(pair[0]!, pair[1]!) : null

  return {
    path: target,
    problem: problem ?? (writable ? null : 'denied'),
    exists: existing === target,
    writable,
    total: disk.total,
    free: disk.free,
    sameVolume: same,
    linkMode,
  }
}

export interface FolderContents {
  path: string
  items: number
  bytes: number
}

/**
 * Что лежит в папках загрузок: раздачи в движке по каталогу. Каталог
 * раздачи без своего — окружения
 */
export function downloadsContents(live: Map<string, EngineTorrentState>) {
  const rows = getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.inEngine, true))
    .all()
  const byDir = new Map<string, FolderContents>()

  for (const row of rows) {
    const dir = resolve(torrentDir(row))
    const entry = byDir.get(dir) ?? { path: dir, items: 0, bytes: 0 }

    entry.items++
    entry.bytes += live.get(row.infoHash)?.bytesCompleted ?? 0
    byDir.set(dir, entry)
  }

  return byDir
}

/** Что лежит в папках своей раскладки: файлы по папкам */
export function libraryContents() {
  const folders = managedFolders()
  const files = getDb()
    .select({ folderId: mediaFiles.folderId, size: mediaFiles.size })
    .from(mediaFiles)
    .where(
      and(
        inArray(
          mediaFiles.folderId,
          folders.map(folder => folder.id),
        ),
        eq(mediaFiles.state, 'present'),
      ),
    )
    .all()
  const byDir = new Map<string, FolderContents>()

  for (const folder of folders) {
    const entry = byDir.get(folder.path) ?? {
      path: folder.path,
      items: 0,
      bytes: 0,
    }

    for (const file of files) {
      if (file.folderId === folder.id) {
        entry.items++
        entry.bytes += file.size
      }
    }

    byDir.set(folder.path, entry)
  }

  return byDir
}

export interface StorageFolder {
  path: string
  source: StoragePathSource
  envPath: string
  total: number
  free: number
  /** Что лежит в действующей папке */
  items: number
  bytes: number
  /** Прежние папки, где ещё лежат данные */
  leftovers: FolderContents[]
}

export async function storageFolder(
  kind: StorageKind,
  live: Map<string, EngineTorrentState>,
): Promise<StorageFolder> {
  const path = storagePath(kind)
  const contents
    = kind === 'downloads' ? downloadsContents(live) : libraryContents()
  const disk = await diskUsage(path)
  const current = contents.get(path)

  return {
    path,
    source: storagePathSource(kind),
    envPath: envStoragePath(kind),
    total: disk.total,
    free: disk.free,
    items: current?.items ?? 0,
    bytes: current?.bytes ?? 0,
    leftovers: [...contents.values()].filter(
      entry => entry.path !== path && entry.items > 0,
    ),
  }
}

/** Пустые прежние папки своей раскладки больше не нужны */
export function dropEmptyManagedFolders() {
  const active = managedFolder()
  const db = getDb()
  const folders = managedFolders().filter(folder => folder.id !== active.id)

  for (const folder of folders) {
    const used = db
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .where(eq(mediaFiles.folderId, folder.id))
      .get()

    // Папку окружения оставляем: в неё вернёт «Вернуть по умолчанию»
    if (!used && !folder.followsEnv)
      db.delete(libraryFolders).where(eq(libraryFolders.id, folder.id)).run()
  }
}

/** Каталоги загрузок для очистки журнала: панели и прежние каталоги раздач */
export function knownDownloadDirs() {
  const dirs = getDb()
    .selectDistinct({ dir: torrents.downloadDir })
    .from(torrents)
    .where(and(isNotNull(torrents.downloadDir), ne(torrents.downloadDir, '')))
    .all()
    .map(row => row.dir!)

  return [...new Set([storagePath('downloads'), ...dirs])]
}
