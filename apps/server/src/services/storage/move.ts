import type {
  LibraryFolder,
  MediaFile,
  StorageMove,
  Torrent,
} from '../../db/schema.ts'
import type { StorageKind } from './paths.ts'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mediaFiles, storageMoves, torrents } from '../../db/schema.ts'
import {
  EngineError,
  isEngineReady,
  listEngineTorrents,
  moveTorrent,
  torrentMoveState,
} from '../engine/index.ts'
import {
  absolutePathOf,
  managedFolder,
  managedFolders,
} from '../library/files.ts'
import { checkLinkMode, placeFile, removeFile } from '../library/link.ts'
import {
  forgetLibraryPasses,
  sourcePathOf,
  syncLibrary,
} from '../library/linker.ts'
import { logFor } from '../logs/index.ts'
import { diskUsage } from './disk.ts'
import { dropEmptyManagedFolders, sameVolume } from './folders.ts'
import { markMoving, unmarkMoving } from './moving.ts'
import {
  downloadDirValue,
  envStoragePath,
  setStoragePath,
  storagePath,
  torrentDir,
} from './paths.ts'
import { isStreaming } from './streams.ts'

const POLL_MS = 1000
// Столько раз перенос раздачи начинается заново, если движок перезапустился
const ENGINE_RETRIES = 3

/** Перенос не начат: уже идёт другой или не хватит места */
export class StorageMoveError extends Error {
  readonly kind: 'busy' | 'no_space'

  constructor(kind: 'busy' | 'no_space') {
    super(kind === 'busy' ? 'Storage move is running' : 'Not enough space')
    this.name = 'StorageMoveError'
    this.kind = kind
  }
}

/** Почему перенос встал: панель переводит в текст */
export type StorageMoveErrorKind = 'no_space' | 'denied' | 'engine' | 'failed'

interface Running {
  id: string
  cancelled: boolean
  /** Байт текущего элемента сверх сохранённого в базе */
  current: number
  currentName: string | null
  waiting: boolean
}

let running: Running | undefined
let task: Promise<void> | undefined

function moveRow(id: string) {
  return getDb()
    .select()
    .from(storageMoves)
    .where(eq(storageMoves.id, id))
    .get()
}

function patch(id: string, values: Partial<typeof storageMoves.$inferInsert>) {
  getDb().update(storageMoves).set(values).where(eq(storageMoves.id, id)).run()
}

export interface StorageMoveState extends StorageMove {
  currentName: string | null
  waiting: boolean
}

/** Идущий перенос или последний завершённый — для панели */
export function storageMoveState(): StorageMoveState | null {
  const row = getDb()
    .select()
    .from(storageMoves)
    .orderBy(desc(storageMoves.startedAt))
    .get()

  if (!row)
    return null

  const live = running?.id === row.id ? running : undefined

  return {
    ...row,
    bytesDone: row.bytesDone + (live?.current ?? 0),
    currentName: live?.currentName ?? null,
    waiting: live?.waiting ?? false,
  }
}

export function isMoveRunning() {
  return !!running
}

function errorKindOf(err: unknown): StorageMoveErrorKind {
  const code = (err as NodeJS.ErrnoException).code

  if (code === 'ENOSPC' || code === 'EDQUOT')
    return 'no_space'

  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')
    return 'denied'

  if (err instanceof EngineError || err instanceof EngineMoveFailed)
    return 'engine'

  return 'failed'
}

class EngineMoveFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineMoveFailed'
  }
}

/** Раздачи в движке не в целевом каталоге; без движка — без размера */
async function pendingTorrents(target: string) {
  const rows = getDb().select().from(torrents).all()
  const live = isEngineReady()
    ? new Map((await listEngineTorrents()).map(item => [item.infoHash, item]))
    : new Map()

  return rows
    .filter(row => resolve(torrentDir(row)) !== target)
    .map(row => ({
      row,
      bytes: live.get(row.infoHash)?.bytesCompleted ?? 0,
    }))
}

function pendingFiles(target: LibraryFolder) {
  const folders = managedFolders().filter(folder => folder.id !== target.id)

  if (!folders.length)
    return []

  const byId = new Map(folders.map(folder => [folder.id, folder]))

  return getDb()
    .select()
    .from(mediaFiles)
    .where(
      and(
        inArray(mediaFiles.folderId, [...byId.keys()]),
        eq(mediaFiles.state, 'present'),
      ),
    )
    .all()
    .map(file => ({ file, folder: byId.get(file.folderId)! }))
}

/** Сколько займёт перенос в папку: на том же томе — нисколько */
export async function moveBytesNeeded(kind: StorageKind, target: string) {
  const sources
    = kind === 'downloads'
      ? (await pendingTorrents(target))
          .filter(item => item.row.inEngine)
          .map(item => ({ dir: torrentDir(item.row), bytes: item.bytes }))
      : pendingFiles(managedFolderFor(target)).map(item => ({
          dir: item.folder.path,
          bytes: item.file.size,
        }))
  const volumes = new Map<string, boolean>()
  let needed = 0

  for (const source of sources) {
    let same = volumes.get(source.dir)

    if (same === undefined) {
      same = await sameVolume(source.dir, target)
      volumes.set(source.dir, same)
    }

    if (!same)
      needed += source.bytes
  }

  return needed
}

// Папка раскладки для пути: для действующего — она сама, для нового —
// без создания строки (она появится при смене пути)
function managedFolderFor(target: string) {
  const active = managedFolder()

  return active.path === target
    ? active
    : ({ ...active, id: '', path: target } satisfies LibraryFolder)
}

/**
 * Сменить папку. «Только новые» — новое пишется в новую папку, старое
 * работает на месте. «Перенести» — фоновое задание переносит всё в новую.
 */
export async function changeStoragePath(
  kind: StorageKind,
  path: string | null,
  mode: 'new_only' | 'move',
) {
  if (running)
    throw new StorageMoveError('busy')

  const target = path ? resolve(path) : null

  if (target)
    await mkdir(target, { recursive: true })

  if (mode === 'move') {
    const destination = target ?? envStoragePath(kind)
    const [needed, disk] = await Promise.all([
      moveBytesNeeded(kind, destination),
      diskUsage(destination),
    ])

    if (needed > disk.free)
      throw new StorageMoveError('no_space')
  }

  setStoragePath(kind, target)
  logFor('storage').info(
    { kind, source: target ? 'panel' : 'env' },
    'Storage path changed',
  )
  await checkLinkMode()

  if (mode === 'move')
    await startMove(kind)
}

/** Перенести в действующую папку всё, что лежит в прежних */
export async function startMove(kind: StorageKind) {
  if (running)
    throw new StorageMoveError('busy')

  const target = resolve(storagePath(kind))
  const [needed, disk] = await Promise.all([
    moveBytesNeeded(kind, target),
    diskUsage(target),
  ])

  if (needed > disk.free)
    throw new StorageMoveError('no_space')

  const items
    = kind === 'downloads'
      ? (await pendingTorrents(target)).filter(item => item.row.inEngine)
      : pendingFiles(managedFolder()).map(item => ({
          bytes: item.file.size,
        }))
  const row = getDb()
    .insert(storageMoves)
    .values({
      kind,
      target,
      status: 'running',
      itemsTotal: items.length,
      bytesTotal: items.reduce((sum, item) => sum + item.bytes, 0),
    })
    .returning()
    .get()

  logFor('storage').info(
    { kind, moveId: row.id, items: items.length },
    'Storage move started',
  )
  run(row.id)

  return row
}

/** Остановиться после текущего элемента: перенесённое уже работает */
export function cancelMove() {
  if (running)
    running.cancelled = true
}

/** Задания, прерванные остановкой сервера, продолжаются с того же места */
export function resumeMoves() {
  if (running)
    return

  const row = getDb()
    .select()
    .from(storageMoves)
    .where(eq(storageMoves.status, 'running'))
    .orderBy(desc(storageMoves.startedAt))
    .get()

  if (row) {
    logFor('storage').info({ moveId: row.id }, 'Storage move resumed')
    run(row.id)
  }
}

/** Ждать конца задания: тесты и остановка сервера */
export function moveIdle() {
  return task ?? Promise.resolve()
}

function run(id: string) {
  const state: Running = {
    id,
    cancelled: false,
    current: 0,
    currentName: null,
    waiting: false,
  }

  running = state
  task = runMove(state).finally(() => {
    if (running === state)
      running = undefined
  })
}

async function runMove(state: Running) {
  const row = moveRow(state.id)

  if (!row)
    return

  try {
    if (row.kind === 'downloads')
      await moveDownloads(state, row)
    else await moveLibrary(state, row)

    patch(row.id, {
      status: state.cancelled ? 'cancelled' : 'done',
      finishedAt: new Date(),
    })
    logFor('storage').info(
      { moveId: row.id, cancelled: state.cancelled },
      'Storage move finished',
    )
  }
  catch (err) {
    const kind = errorKindOf(err)

    patch(row.id, { status: 'failed', error: kind, finishedAt: new Date() })
    logFor('storage').error(
      { err, moveId: row.id, kind },
      'Storage move failed',
    )
  }
  finally {
    state.current = 0
    state.currentName = null
    forgetLibraryPasses()
    void syncLibrary()
  }
}

function itemDone(state: Running, bytes: number) {
  const row = moveRow(state.id)!

  state.current = 0
  patch(state.id, {
    itemsDone: row.itemsDone + 1,
    bytesDone: row.bytesDone + bytes,
  })
}

async function waitForEngine(state: Running) {
  while (!isEngineReady() && !state.cancelled) {
    state.waiting = true
    await sleep(POLL_MS * 2)
  }

  state.waiting = false
}

async function moveDownloads(state: Running, row: StorageMove) {
  const target = row.target

  // Без данных на диске: следующая закачка начнётся в новом каталоге
  for (const item of await pendingTorrents(target)) {
    if (!item.row.inEngine) {
      getDb()
        .update(torrents)
        .set({ downloadDir: downloadDirValue(target) })
        .where(eq(torrents.id, item.row.id))
        .run()
    }
  }

  for (;;) {
    if (state.cancelled)
      return

    await waitForEngine(state)

    const pending = (await pendingTorrents(target)).filter(
      item => item.row.inEngine,
    )

    if (!pending.length)
      return

    // Раздачу, которую смотрят, переносим последней: поток не обрываем
    const next = pending.find(item => !isStreaming(item.row.id))

    if (!next) {
      state.waiting = true
      await sleep(POLL_MS * 5)
      continue
    }

    state.waiting = false
    state.currentName = next.row.name
    await moveOneTorrent(state, next.row, target)
    await separateLibraryCopies(next.row, target)
    itemDone(state, next.bytes)
  }
}

async function moveOneTorrent(
  state: Running,
  torrent: Torrent,
  target: string,
) {
  markMoving(torrent.id)

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        let move

        try {
          move = await moveTorrent(torrent.infoHash, target)
        }
        catch (err) {
          // Движок раздачу не знает: файлами он не управляет, и следующая
          // закачка начнётся в новом каталоге
          if (
            err instanceof EngineError
            && err.kind === 'not_found'
            && attempt === 0
          ) {
            break
          }
          throw err
        }

        while (move.state === 'running') {
          state.current = move.bytesDone
          await sleep(POLL_MS)
          move = await torrentMoveState(torrent.infoHash)
        }

        if (move.state === 'failed')
          throw new EngineMoveFailed(move.error ?? 'Engine move failed')

        break
      }
      catch (err) {
        // Движок перезапустился посреди переноса и сам откатил или довёл его:
        // начинаем заново, уже перенесённое движок узнает
        const restarted
          = err instanceof EngineError
            && (err.kind === 'not_found' || err.kind === 'unavailable')

        if (!restarted || attempt >= ENGINE_RETRIES)
          throw err

        await waitForEngine(state)
      }
    }

    getDb()
      .update(torrents)
      .set({ downloadDir: downloadDirValue(target) })
      .where(eq(torrents.id, torrent.id))
      .run()
  }
  finally {
    unmarkMoving(torrent.id)
  }
}

/**
 * Раздача уехала с тома библиотеки: её файлы в библиотеке больше не общие с
 * раздачей. Они отмечаются копиями, и связыватель возвращает закреплённую
 * раздачу в кэш, как после копии
 */
async function separateLibraryCopies(torrent: Torrent, target: string) {
  const files = getDb()
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.torrentId, torrent.id))
    .all()
    .filter(file => file.linkMode && file.linkMode !== 'copy')

  if (!files.length)
    return

  const folders = new Map(
    managedFolders().map(folder => [folder.id, folder]),
  )
  const separated: string[] = []

  for (const file of files) {
    const folder = folders.get(file.folderId)

    if (folder && !(await sameVolume(folder.path, target)))
      separated.push(file.id)
  }

  if (!separated.length)
    return

  getDb()
    .update(mediaFiles)
    .set({ linkMode: 'copy' })
    .where(inArray(mediaFiles.id, separated))
    .run()
  logFor('storage').info(
    { torrentId: torrent.id, count: separated.length },
    'Library files are no longer shared with the torrent',
  )
}

async function moveLibrary(state: Running, row: StorageMove) {
  const target = managedFolder()

  // Путь сменили ещё раз после старта: переносим в действующую папку
  if (target.path !== row.target)
    patch(row.id, { target: target.path })

  for (const { file, folder } of pendingFiles(target)) {
    if (state.cancelled)
      return

    state.currentName = basename(file.relPath)
    await moveLibraryFile(file, folder, target)
    itemDone(state, file.size)
  }

  dropEmptyManagedFolders()
}

/** Файл раздачи на томе новой папки: из него получится хардлинк */
async function torrentSourceFor(file: MediaFile, target: LibraryFolder) {
  if (!file.torrentId || file.fileIndex === null)
    return undefined

  const torrent = getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.id, file.torrentId))
    .get()

  if (!torrent?.inEngine)
    return undefined

  const source = await sourcePathOf(torrent, file.fileIndex)

  return source && (await sameVolume(source, target.path)) ? source : undefined
}

async function moveLibraryFile(
  file: MediaFile,
  folder: LibraryFolder,
  target: LibraryFolder,
) {
  const source = absolutePathOf(folder, file)
  const destination = absolutePathOf(target, file)
  const taken = getDb()
    .select({ id: mediaFiles.id })
    .from(mediaFiles)
    .where(
      and(
        eq(mediaFiles.folderId, target.id),
        eq(mediaFiles.relPath, file.relPath),
      ),
    )
    .get()

  // Такое имя в новой папке уже занято другим файлом: этот остаётся на месте
  if (taken) {
    logFor('storage').warn(
      { mediaFileId: file.id },
      'Library file name is taken in the new folder',
    )
    return
  }

  const fromTorrent = await torrentSourceFor(file, target)
  const placedBefore = await stat(destination).catch(() => undefined)
  let linkMode = file.linkMode

  // Прерванная попытка уже положила файл целиком: `placeFile` пишет имя
  // только после сверки размера
  if (!placedBefore || placedBefore.size !== file.size) {
    const mode = await placeFile(fromTorrent ?? source, destination)

    linkMode = fromTorrent ? mode : linkModeAfter(file.linkMode, mode)
  }

  await moveSidecars(source, destination)

  const placed = await stat(destination)

  getDb()
    .update(mediaFiles)
    .set({
      folderId: target.id,
      inode: placed.ino,
      mtime: placed.mtime,
      linkMode,
    })
    .where(eq(mediaFiles.id, file.id))
    .run()

  await removeFile(source, folder.path, `${baseOf(source)}.`)
}

/**
 * Связь с раздачей после переноса файла библиотеки: хардлинк сохраняет её,
 * reflink делит те же блоки, копия — отдельный файл
 */
function linkModeAfter(
  before: MediaFile['linkMode'],
  placed: NonNullable<MediaFile['linkMode']>,
): MediaFile['linkMode'] {
  if (!before || before === 'copy' || placed === 'hardlink')
    return before

  return placed === 'reflink' ? 'reflink' : 'copy'
}

function baseOf(path: string) {
  const dot = path.lastIndexOf('.')

  return dot > path.lastIndexOf('/') ? path.slice(0, dot) : path
}

/** Субтитры и дорожки рядом с тем же базовым именем едут вместе с видео */
async function moveSidecars(source: string, destination: string) {
  const prefix = `${basename(baseOf(source))}.`
  const names = await readdir(dirname(source)).catch(() => [] as string[])

  for (const name of names) {
    if (!name.startsWith(prefix) || name === basename(source))
      continue

    const to = join(dirname(destination), name)

    if (await stat(to).catch(() => undefined))
      continue

    await placeFile(join(dirname(source), name), to)
  }
}
