import type { Torrent } from '../../db/schema.ts'
import { link, mkdir, rmdir, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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

    const [a, b] = await Promise.all([inodeOf(source), inodeOf(target)])

    if (a && a === b)
      paths.push(target)
  }

  await removeFiles(paths, join(resolve(dir), next.name))
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
export async function removeFiles(paths: string[], root: string) {
  const dirs = new Set<string>()

  for (const path of paths) {
    for (const candidate of [path, `${path}${PART_SUFFIX}`]) {
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
