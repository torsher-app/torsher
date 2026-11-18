import type { Torrent } from '../../db/schema.ts'
import {
  link,
  mkdir,
  readdir,
  realpath,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { torrents, watchStates } from '../../db/schema.ts'
import { EngineError, forgetTorrent, inspectTorrent } from '../engine/index.ts'

// Так движок называет недокачанный файл прежних версий
const PART_SUFFIX = '.part'
// Хардлинк невозможен: ФС без ссылок, сетевая папка, предел ссылок
const NO_LINK_CODES = new Set([
  'EXDEV',
  'EPERM',
  'EMLINK',
  'ENOTSUP',
  'EOPNOTSUPP',
  'ENOSYS',
  'EACCES',
])

type FilesOf = Pick<Torrent, 'name' | 'files'>

/** Хардлинки в папку новой версии не поставить: она пойдёт рядом */
export class NoLinkError extends Error {
  constructor(options?: ErrorOptions) {
    super('Hard links are not supported here', options)
    this.name = 'NoLinkError'
  }
}

function isInside(base: string, path: string) {
  const rel = relative(base, path)

  return (
    rel !== ''
    && rel !== '..'
    && !rel.startsWith(`..${sep}`)
    && !isAbsolute(rel)
  )
}

/**
 * Файлы старой версии раздачи, которые есть в новой: тот же путь внутри
 * раздачи и размер. Старый индекс → новый.
 */
export function carryMap(old: FilesOf, next: FilesOf) {
  const byKey = new Map<string, number>()

  for (const [index, file] of (next.files ?? []).entries()) {
    if (!file.padding)
      byKey.set(`${file.path}\0${file.size}`, index)
  }

  const map = new Map<number, number>()

  for (const [index, file] of (old.files ?? []).entries()) {
    const found = file.padding
      ? undefined
      : byKey.get(`${file.path}\0${file.size}`)

    if (found !== undefined)
      map.set(index, found)
  }

  return map
}

/**
 * Где движок держит файл раздачи в каталоге `dir`: в папке с именем
 * раздачи, а раздачу из одного файла — прямо в каталоге. Путь из чужого
 * `.torrent` за каталог не выходит — тогда `undefined`.
 */
export function diskPathOf(torrent: FilesOf, index: number, dir: string) {
  const files = torrent.files ?? []
  const file = files[index]

  if (!file)
    return undefined

  const base = resolve(dir)
  const single = files.length === 1 && file.path === torrent.name
  const path = single
    ? resolve(base, torrent.name)
    : resolve(base, torrent.name, ...file.path.split('/'))

  return isInside(base, path) ? path : undefined
}

async function inodeOf(path: string) {
  return (await stat(path).catch(() => undefined))?.ino
}

/**
 * Новая версия раздачи называется иначе: перенесённые файлы заранее
 * связываются хардлинком в её папку, и движок найдёт их на месте. Уже
 * стоящая ссылка на тот же файл — не ошибка, чужой файл не трогаем.
 */
export async function linkCarried(
  old: FilesOf,
  next: FilesOf,
  map: Map<number, number>,
  dir: string,
) {
  for (const [from, to] of map) {
    const source = diskPathOf(old, from, dir)
    const target = diskPathOf(next, to, dir)

    if (!source || !target || !(await inodeOf(source)))
      continue

    if (await inodeOf(target))
      continue

    try {
      await mkdir(dirname(target), { recursive: true })
      await link(source, target)
    }
    catch (err) {
      if (NO_LINK_CODES.has((err as NodeJS.ErrnoException).code ?? ''))
        throw new NoLinkError({ cause: err })

      throw err
    }
  }
}

/** Убирает поставленные `linkCarried` ссылки: новая версия пошла рядом */
export async function unlinkCarried(
  old: FilesOf,
  next: FilesOf,
  map: Map<number, number>,
  dir: string,
) {
  const paths: string[] = []

  for (const [from, to] of map) {
    const source = diskPathOf(old, from, dir)
    const target = diskPathOf(next, to, dir)

    if (!source || !target || source === target)
      continue

    const [a, b] = await Promise.all([
      entryIdentity(source),
      entryIdentity(target),
    ])

    if (a && a === b && !(await sameDirectoryEntry(source, target)))
      paths.push(target)
  }

  await removeFiles(paths, join(resolve(dir), next.name), [
    ...metadataPaths(old, dir),
    ...metadataPaths(next, dir),
  ])
}

/** Все собственные пути metainfo, включая невыбранные файлы. */
export function metadataPaths(torrent: FilesOf, dir: string) {
  return (torrent.files ?? []).flatMap(
    (_, index) => diskPathOf(torrent, index, dir) ?? [],
  )
}

/**
 * Сверка новой версии с тем, что уже лежит в каталоге, по хэшам кусков —
 * только чтение. Ответ — `onDisk` каждого файла по индексу.
 */
export async function compareOnDisk(next: Torrent, dir: string) {
  if (!next.torrentFile)
    throw new Error('Torrent metadata is not ready')

  const details = await inspectTorrent(next.torrentFile, { dir })

  return details.files.map(file => file.onDisk ?? 'unknown')
}

/**
 * Удаляет файлы (и их `.part`) и опустевшие каталоги над ними до `root`
 * включительно. Нет файла — не ошибка: уборку повторяют после перезапуска.
 */
export async function removeFiles(
  paths: string[],
  root: string,
  protectedPaths: string[] = [],
  keepEntry?: (path: string) => Promise<boolean>,
) {
  // Conservatively protect aliases on case-insensitive filesystems as well.
  const owned = new Set(protectedPaths.map(path => path.toLowerCase()))

  let identities: Map<string, string[]> | undefined
  const dirs = new Set<string>()

  for (const path of paths) {
    for (const candidate of [
      path,
      ...(!owned.has(`${path}${PART_SUFFIX}`.toLowerCase())
        ? [`${path}${PART_SUFFIX}`]
        : []),
    ]) {
      if (keepEntry && (await keepEntry(candidate)))
        continue
      if (candidate !== path && protectedPaths.length) {
        const identity = await entryIdentity(candidate)
        // An absent suffix must not pick up a payload published during cleanup.
        if (!identity)
          continue
        identities ??= await indexEntries(protectedPaths)
        if (await aliasesEntry(candidate, identities.get(identity)))
          continue
      }
      await unlink(candidate).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT')
          throw err
      })
    }

    dirs.add(dirname(path))
  }

  const base = resolve(root)

  for (const start of dirs) {
    let current = start

    while (current === base || isInside(base, current)) {
      try {
        await rmdir(current)
      }
      catch {
        // Не пустой или уже убран: выше чистить незачем
        break
      }

      if (current === base)
        break

      current = dirname(current)
    }
  }
}

async function entryIdentity(path: string) {
  const entry = await stat(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT')
      throw err
  })
  return entry ? `${entry.dev}:${entry.ino}` : undefined
}

/** Hardlinks in distinct directory entries survive unlinking either name. */
async function sameDirectoryEntry(a: string, b: string) {
  const [first, second] = await Promise.all([realpath(a), realpath(b)])
  if (first === second)
    return true

  const parent = dirname(first)
  const [left, right] = await Promise.all([
    entryIdentity(parent),
    entryIdentity(dirname(second)),
  ])
  if (!left || !right)
    return true
  if (left !== right)
    return false

  const names = await readdir(parent)
  return (
    basename(first) === basename(second)
    || !names.includes(basename(first))
    || !names.includes(basename(second))
  )
}

async function indexEntries(paths: Iterable<string>, only?: Set<string>) {
  const entries = new Map<string, string[]>()
  for (const path of paths) {
    const identity = await entryIdentity(path)
    if (identity && (!only || only.has(identity))) {
      const names = entries.get(identity) ?? []
      names.push(path)
      entries.set(identity, names)
    }
  }
  return entries
}

async function aliasesEntry(path: string, others: string[] | undefined) {
  for (const other of others ?? []) {
    if (await sameDirectoryEntry(path, other))
      return true
  }
  return false
}

/** Post-add cleanup must keep active entries, including old journal aliases. */
export async function removeRetiredFiles(
  paths: string[],
  root: string,
  activePaths: string[],
  protectedPaths: string[],
) {
  if (!paths.length)
    return

  // Observe old names before active ones. An absent or replaced old entry
  // may now be the engine publishing a new file at an aliased path.
  const retired = new Map<string, string>()
  for (const path of paths) {
    for (const candidate of [path, `${path}${PART_SUFFIX}`]) {
      const identity = await entryIdentity(candidate)
      if (identity)
        retired.set(candidate, identity)
    }
  }

  const retiredIdentities = new Set(retired.values())
  const active = new Set(activePaths)
  const aliases = await indexEntries(active, retiredIdentities)

  await removeFiles(
    paths,
    root,
    [...protectedPaths, ...active],
    async (path) => {
      const identity = retired.get(path)
      if (
        active.has(path)
        || !identity
        || (await entryIdentity(path)) !== identity
      ) {
        return true
      }

      return aliasesEntry(path, aliases.get(identity))
    },
  )
}

/** Раздачу забывает движок, файлы остаются на диске */
export async function forgetKeepingFiles(torrent: Torrent) {
  try {
    await forgetTorrent(torrent.infoHash)
  }
  catch (err) {
    if (!(err instanceof EngineError) || err.kind !== 'not_found')
      throw err
  }

  getDb()
    .update(torrents)
    .set({ inEngine: false })
    .where(eq(torrents.id, torrent.id))
    .run()
}

/**
 * Позиции просмотра файлов старой версии переходят к тем же файлам новой.
 * Позицию, которая у новой версии уже есть, не перезаписываем. Старые
 * строки уйдут каскадом вместе со старой раздачей — перенос строго до этого.
 */
export function moveWatchStates(
  oldId: string,
  newId: string,
  map: Map<number, number>,
) {
  const db = getDb()
  const rows = db
    .select()
    .from(watchStates)
    .where(eq(watchStates.torrentId, oldId))
    .all()

  for (const row of rows) {
    const fileIndex = map.get(row.fileIndex)

    if (fileIndex === undefined)
      continue

    db.insert(watchStates)
      .values({ ...row, torrentId: newId, fileIndex })
      .onConflictDoNothing()
      .run()
  }
}
