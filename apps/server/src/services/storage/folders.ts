import type { EngineTorrentState } from '../engine/index.ts'
import type { StorageKind, StoragePathSource } from './paths.ts'
import { randomBytes } from 'node:crypto'
import { realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
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
import { overlaps, ownStoragePaths } from '../library/folders.ts'
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

/** Реальный путь: симлинки ближайшего существующего каталога раскрыты */
export async function realPathOf(path: string) {
  const target = resolve(path)
  const dir = await existingDir(target)

  if (!dir)
    return target

  const real = await realpath(dir).catch(() => dir)

  return join(real, relative(dir, target))
}

/**
 * Один каталог под разными путями: симлинк, bind-mount (тот же inode) или
 * один сетевой экспорт, смонтированный дважды (inode разные — видно только
 * по пробному файлу). Перенос в такой каталог удалил бы файлы вместе с
 * «копией»
 */
export async function sameDirectory(a: string, b: string) {
  const first = resolve(a)
  const second = resolve(b)

  if (first === second)
    return true

  if ((await realPathOf(first)) === (await realPathOf(second)))
    return true

  const [one, two] = await Promise.all([
    stat(first).catch(() => undefined),
    stat(second).catch(() => undefined),
  ])

  if (!one?.isDirectory() || !two?.isDirectory())
    return false

  if (one.dev === two.dev && one.ino === two.ino)
    return true

  const name = `.torsher-same-${randomBytes(6).toString('hex')}`

  try {
    await writeFile(join(second, name), '', { flag: 'wx' })
  }
  catch {
    return false
  }

  try {
    return !!(await stat(join(first, name)).catch(() => undefined))
  }
  finally {
    await unlink(join(second, name)).catch(() => undefined)
  }
}

/** Ключ тома: устройство ближайшего существующего каталога */
async function deviceKeyOf(path: string) {
  const dir = await existingDir(resolve(path))

  return dir ? String((await stat(dir)).dev) : undefined
}

/** Подмена в тестах: разные тома на одной ФС */
export const volumeDeps = { volumeKey: deviceKeyOf }

export function volumeKey(path: string) {
  return volumeDeps.volumeKey(path)
}

/** Две папки на одном томе: перенос между ними — хардлинки, место не нужно */
export async function sameVolume(a: string, b: string) {
  const [first, second] = await Promise.all([volumeKey(a), volumeKey(b)])

  return first !== undefined && first === second
}

function otherKind(kind: StorageKind): StorageKind {
  return kind === 'downloads' ? 'library' : 'downloads'
}

/**
 * Папки этого вида, куда можно переносить: действующая, окружения и прежние
 * (каталоги раздач или папки своей раскладки)
 */
function sameKindPaths(kind: StorageKind) {
  const paths
    = kind === 'downloads'
      ? knownDownloadDirs()
      : managedFolders().map(folder => folder.path)

  return new Set(
    [storagePath(kind), envStoragePath(kind), ...paths].map(path =>
      resolve(path),
    ),
  )
}

async function withRealPaths(paths: string[]) {
  const real = await Promise.all(paths.map(path => realPathOf(path)))

  return [...new Set([...paths.map(path => resolve(path)), ...real])]
}

function overlapsAny(first: string[], second: string[]) {
  return first.some(a => second.some(b => overlaps(a, b)))
}

/**
 * Можно ли выбрать путь: абсолютный, не пересекается с каталогом данных,
 * папками другого вида (действующими и прежними) и подключёнными папками
 * пользователя (они только на чтение). Сверяется и путь как есть, и
 * реальный: симлинк не обходит запрет. Путь окружения разрешён всегда: это
 * «по умолчанию».
 */
export async function pathProblem(
  kind: StorageKind,
  path: string,
): Promise<StoragePathProblem | null> {
  if (!isAbsolute(path))
    return 'not_absolute'

  const target = await withRealPaths([path])
  const env = await withRealPaths([envStoragePath(kind)])

  if (target.some(item => env.includes(item)))
    return null

  const dataDir = resolve(config.dataDir)

  if (overlapsAny(target, await withRealPaths([dataDir])))
    return 'inside_data'

  const own = sameKindPaths(kind)
  const others = ownStoragePaths().filter(
    item => item !== dataDir && !own.has(item),
  )

  others.push(storagePath(otherKind(kind)), envStoragePath(otherKind(kind)))

  if (overlapsAny(target, await withRealPaths(others)))
    return 'overlaps_other'

  const userFolders = getDb()
    .select({ path: libraryFolders.path })
    .from(libraryFolders)
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(eq(libraries.managed, false))
    .all()
    .map(folder => folder.path)

  if (overlapsAny(target, await withRealPaths(userFolders)))
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
  const problem = await pathProblem(kind, path)
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

  // Пробный файл — только в разрешённой папке: в подключённые папки
  // пользователя Torsher не пишет
  const [writable, disk, same] = await Promise.all([
    problem ? false : canWrite(existing),
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
