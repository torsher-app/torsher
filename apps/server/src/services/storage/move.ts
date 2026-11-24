import { libraryProbeKey } from '../library/playedSource.ts'
import { rebindMovedSubtitles } from '../media/downloadedSubtitles.ts'
import {
  assertMaintenanceMutation,
  MaintenanceBusyError,
  withMaintenanceLease,
} from '../libraryMaintenance/admission.ts'
import type {
  LibraryFolder,
  MediaFile,
  MediaLinkMode,
  StorageMove,
  Torrent,
} from '../../db/schema.ts'
import type { EngineMoveState, EngineTorrentState } from '../engine/index.ts'
import type {
  DownloadIntent,
  FileSnapshot,
  LibraryIntent,
  MoveFileReceipt,
  StorageMoveRecovery,
} from './moveIntent.ts'
import type { StorageKind } from './paths.ts'
import type { Stats } from 'node:fs'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { extensionKind } from '@torsher/release-parser'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mediaFiles, storageMoves, torrents } from '../../db/schema.ts'
import {
  EngineError,
  engineStorageInventory,
  engineUnavailableError,
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
import {
  placeFileWithReceipt,
  probeLibraryStorage,
  publishLibraryStorage,
} from '../library/link.ts'
import {
  forgetLibraryPasses,
  sourcePathOf,
  syncLibrary,
} from '../library/linker.ts'
import { logFor } from '../logs/index.ts'
import { durableSqlite } from '../libraryMaintenance/durable.ts'
import { diskUsage } from './disk.ts'
import {
  dropEmptyManagedFolders,
  moveSharesSpace,
  prepareStoragePath,
  sameDirectory,
  sameVolume,
} from './folders.ts'
import { getStorageOverview } from './index.ts'
import {
  captureLibraryFiles,
  createMoveStage,
  directorySnapshot,
  discardCapturedLibraryFiles,
  LIBRARY_MOVE_FILE_LIMIT,
  lstatIfPresent,
  MoveCaptureConflict,
  removeEmptyMoveParents,
  removeMoveStage,
  requireMoveTargets,
  restoreCapturedLibraryFiles,
  sameFileSnapshot as sameIdentity,
  fileSnapshot as snapshot,
  within,
} from './libraryMoveCapture.ts'
import {
  markMoving,
  unmarkMoving,
  withTorrentStorageMutation,
} from './moving.ts'
import {
  downloadDirValue,
  isIsolatedTorrentDir,
  isolatedTorrentDir,
  notifyStoragePathsChanged,
  persistStoragePath,
  storageLocation,
  torrentAtRoot,
  torrentDir,
} from './paths.ts'
import { isStreaming } from './streams.ts'

const POLL_MS = 1000
// Столько раз перенос раздачи начинается заново, если движок перезапустился
const ENGINE_RETRIES = 3

/** Перенос не начат: уже идёт или стартует другой, или не хватит места */
export class StorageMoveError extends Error {
  readonly kind: 'busy' | 'no_space'

  constructor(kind: 'busy' | 'no_space') {
    super(kind === 'busy' ? 'Storage move is running' : 'Not enough space')
    this.name = 'StorageMoveError'
    this.kind = kind
  }
}

/**
 * Почему перенос встал: панель переводит в текст. `exists` — в новой папке
 * чужой файл под тем же именем
 */
export type StorageMoveErrorKind
  = 'no_space' | 'denied' | 'engine' | 'exists' | 'failed'

interface Running {
  id: string
  cancelled: boolean
  recoveryOnly: boolean
  /** Байт текущего элемента сверх сохранённого в базе */
  current: number
  currentName: string | null
  waiting: boolean
}

let running: Running | undefined
let task: Promise<void> | undefined
// Смена папки или старт переноса между первой проверкой и записью задания:
// параллельный запрос получает `busy`, а не второе задание
let starting = false

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

function isBusy() {
  return !!running || starting
}

function errorKindOf(err: unknown): StorageMoveErrorKind {
  const code = (err as NodeJS.ErrnoException).code

  if (
    code === 'ENOSPC'
    || code === 'EDQUOT'
    || (err instanceof StorageMoveError && err.kind === 'no_space')
  ) {
    return 'no_space'
  }

  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')
    return 'denied'

  if (err instanceof EngineMoveFailed)
    return err.kind === 'exists' ? 'exists' : 'engine'

  if (err instanceof EngineError)
    return 'engine'

  return 'failed'
}

class EngineMoveFailed extends Error {
  readonly kind: string | undefined

  constructor(message: string, kind?: string) {
    super(message)
    this.name = 'EngineMoveFailed'
    this.kind = kind
  }
}

/** Объём работающих раздач неизвестен, пока движок недоступен. */
async function pendingTorrents(
  target: string,
  snapshot?: Map<string, EngineTorrentState>,
) {
  const rows = getDb()
    .select()
    .from(torrents)
    .all()
    .filter(row => !torrentAtRoot(row, target))
  if (rows.some(row => row.inEngine) && !snapshot && !isEngineReady())
    throw engineUnavailableError()
  const live
    = snapshot ?? (await liveSnapshot()) ?? new Map<string, EngineTorrentState>()

  return rows.map(row => ({
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

/** Item identity is available even while the Downloads byte count is unknown. */
export function storageMoveItemCount(kind: StorageKind, target: string) {
  return kind === 'downloads'
    ? getDb()
      .select()
      .from(torrents)
      .all()
      .filter(row => row.inEngine && !torrentAtRoot(row, target))
      .length
    : pendingFiles(managedFolderFor(target)).length
}

/** Один набор для объёма задания и предпросмотра, включая прежние папки. */
async function pendingMoveItems(
  kind: StorageKind,
  target: string,
  snapshot?: Map<string, EngineTorrentState>,
) {
  if (kind === 'downloads') {
    return (await pendingTorrents(target, snapshot))
      .filter(item => item.row.inEngine)
      .map(item => ({
        dir: torrentDir(item.row),
        bytes: item.bytes,
        parts: [
          {
            dir: torrentDir(item.row),
            target: isIsolatedTorrentDir(
              torrentDir(item.row),
              item.row.infoHash,
            )
              ? isolatedTorrentDir(target, item.row.infoHash)
              : target,
            bytes: item.bytes,
          },
        ],
      }))
  }

  return libraryMoveItems(managedFolderFor(target))
}

async function libraryMoveItems(target: LibraryFolder) {
  const pending = pendingFiles(target)
  const mediaPaths = new Set(
    pending.map(({ folder, file }) => absolutePathOf(folder, file)),
  )
  const items = await Promise.all(
    pending.map(async ({ file, folder }) => {
      const source = absolutePathOf(folder, file)
      const [info, sidecars] = await Promise.all([
        lstatIfPresent(source),
        sidecarsOf(source, mediaPaths),
      ])
      return { file, folder, source, size: info?.size ?? file.size, sidecars }
    }),
  )

  // Account for shared sidecars with the last owner, so a resumed job
  // cannot count them again while another source video still needs them.
  const lastOwner = new Map<string, string>()
  for (const { source, sidecars } of items) {
    for (const sidecar of sidecars) lastOwner.set(sidecar.path, source)
  }
  return items.map(({ file, folder, source, size, sidecars }) => {
    const accounted = sidecars.filter(
      item => lastOwner.get(item.path) === source,
    )
    const parts = [{ path: source, size }, ...accounted].map(item => ({
      dir: dirname(item.path),
      target: dirname(join(target.path, file.relPath)),
      bytes: item.size,
    }))
    return {
      file,
      folder,
      dir: folder.path,
      sidecars,
      bytes: parts.reduce((sum, item) => sum + item.bytes, 0),
      parts,
    }
  })
}

/** Объём файлов и дополнительное место на целевом томе — разные величины. */
export async function storageMovePreview(kind: StorageKind, target: string) {
  return summarizeMoveItems(kind, await pendingMoveItems(kind, target))
}

async function summarizeMoveItems(
  kind: StorageKind,
  sources: Awaited<ReturnType<typeof pendingMoveItems>>,
) {
  const volumes = new Map<string, boolean>()
  let needed = 0
  let allSameVolume = true

  for (const source of sources.flatMap(item => item.parts)) {
    const key = JSON.stringify([source.dir, source.target])
    let same = volumes.get(key)

    if (same === undefined) {
      same = await moveSharesSpace(kind, source.dir, source.target)
      volumes.set(key, same)
    }

    allSameVolume &&= same
    if (!same)
      needed += source.bytes
  }

  return {
    moveBytes: needed,
    moveTotalBytes: sources.reduce((sum, source) => sum + source.bytes, 0),
    moveItems: sources.length,
    sameVolume: allSameVolume,
  }
}

/** Сколько займёт перенос в папку: на том же томе — нисколько */
export async function moveBytesNeeded(kind: StorageKind, target: string) {
  return (await storageMovePreview(kind, target)).moveBytes
}

// Папка раскладки для пути: для действующего — она сама, для нового —
// без создания строки (она появится при смене пути)
function managedFolderFor(target: string) {
  const existing = managedFolders().find(folder => folder.path === target)

  if (existing)
    return existing

  const active = managedFolder()

  return active.path === target
    ? active
    : ({ ...active, id: '', path: target } satisfies LibraryFolder)
}

/**
 * Сменить папку. «Только новые» — новое пишется в новую папку, старое
 * работает на месте. «Перенести» — фоновое задание переносит всё в новую.
 */
function ensureMoveCanStart() {
  if (isBusy())
    throw new StorageMoveError('busy')
  if (recoverableMove()) {
    resumeMoves()
    throw new StorageMoveError('busy')
  }
}

function liveSnapshot() {
  return isEngineReady()
    ? listEngineTorrents().then(
        items => new Map(items.map(item => [item.infoHash, item])),
      )
    : undefined
}

async function acceptStorageChange(
  kind: StorageKind,
  path: string | null | undefined,
  move: boolean,
) {
  ensureMoveCanStart()
  starting = true

  try {
    const downloads = storageLocation(
      'downloads',
      kind === 'downloads' ? path : undefined,
    )
    const library = storageLocation(
      'library',
      kind === 'library' ? path : undefined,
    )
    const target = kind === 'downloads' ? downloads.path : library.path

    if (path)
      await prepareStoragePath(kind, path)

    const [live, link, disk] = await Promise.all([
      liveSnapshot(),
      probeLibraryStorage(downloads.path, library.path),
      diskUsage(target),
    ])
    const items = move ? await pendingMoveItems(kind, target, live) : []
    const preview = move ? await summarizeMoveItems(kind, items) : undefined
    if (preview && preview.moveBytes > disk.free)
      throw new StorageMoveError('no_space')

    const overview = await getStorageOverview({
      downloads,
      library,
      live: live ?? new Map(),
      disks: new Map([[target, disk]]),
      librarySharesVolume: link.sameDevice,
    })

    const previous = move ? null : storageMoveState()
    const db = getDb()
    const row = durableSqlite(db.$client, () => {
      if (path !== undefined)
        persistStoragePath(kind, path)
      if (!preview)
        return undefined

      return db
        .insert(storageMoves)
        .values({
          kind,
          target,
          status: 'running',
          itemsTotal: preview.moveItems,
          bytesTotal: preview.moveTotalBytes,
          recovery: {},
        })
        .returning()
        .get()
    })

    publishLibraryStorage(link)
    if (path !== undefined) {
      notifyStoragePathsChanged()
      logFor('storage').info(
        { kind, source: (kind === 'downloads' ? downloads : library).source },
        'Storage path changed',
      )
    }
    const state = row
      ? { ...row, currentName: null, waiting: false }
      : previous
    if (row) {
      logFor('storage').info(
        { kind, moveId: row.id, items: row.itemsTotal },
        'Storage move started',
      )
      run(row)
    }
    return { overview, move: state }
  }
  finally {
    starting = false
  }
}

export function changeStoragePath(
  kind: StorageKind,
  path: string | null,
  mode: 'new_only' | 'move',
) {
  return withMaintenanceLease({ global: true, producer: true }, () =>
    acceptStorageChange(kind, path, mode === 'move'))
}

export function startMove(kind: StorageKind) {
  return withMaintenanceLease({ global: true, producer: true }, () =>
    acceptStorageChange(kind, undefined, true))
}

/** Остановиться после текущего элемента: перенесённое уже работает */
export function cancelMove() {
  const state = running
  if (!state)
    return

  const db = getDb()
  durableSqlite(db.$client, () => {
    const row = moveRow(state.id)
    if (row)
      patch(state.id, { recovery: { ...row.recovery, cancelRequested: true } })
  })
  state.cancelled = true
}

function recoverableMove() {
  const hasIntent = sql`json_type(${storageMoves.recovery}, '$.current') = 'object'`
  return getDb()
    .select()
    .from(storageMoves)
    .where(or(eq(storageMoves.status, 'running'), hasIntent))
    .orderBy(desc(hasIntent), desc(storageMoves.startedAt))
    .get()
}

/** Resume both active jobs and unresolved intents of interrupted jobs. */
export function resumeMoves() {
  try {
    assertMaintenanceMutation({ global: true, producer: true })
  }
  catch (error) {
    if (error instanceof MaintenanceBusyError)
      return
    throw error
  }
  if (isBusy())
    return

  const row = recoverableMove()
  if (row) {
    logFor('storage').info({ moveId: row.id }, 'Storage move resumed')
    run(row)
  }
}

/** Ждать конца задания: тесты и остановка сервера */
export function moveIdle() {
  return task ?? Promise.resolve()
}

function run(row: StorageMove) {
  const state: Running = {
    id: row.id,
    cancelled: row.recovery?.cancelRequested ?? row.status === 'cancelled',
    recoveryOnly: row.status !== 'running',
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

async function runMoveImpl(state: Running) {
  const row = moveRow(state.id)
  if (!row)
    return

  try {
    if (row.kind === 'downloads')
      await moveDownloads(state, row)
    else await moveLibrary(state, row)

    const latest = moveRow(row.id)!
    const incomplete
      = latest.recovery?.current
        || ((row.kind === 'downloads' || state.recoveryOnly)
          && latest.itemsDone < latest.itemsTotal)
    const status = state.cancelled
      ? 'cancelled'
      : incomplete
        ? 'failed'
        : 'done'
    patch(row.id, {
      status,
      error: status === 'failed' ? (latest.error ?? 'failed') : null,
      finishedAt: new Date(),
    })
    logFor('storage').info({ moveId: row.id, status }, 'Storage move finished')
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

type MoveIntent = NonNullable<StorageMoveRecovery['current']>

function transitionIntent(
  state: Running,
  expected: MoveIntent | undefined,
  current?: MoveIntent,
  commit?: (row: StorageMove) => void,
) {
  const db = getDb()
  durableSqlite(db.$client, () => {
    const row = moveRow(state.id)
    const previous = row?.recovery?.current
    if (
      !row
      || previous?.token !== expected?.token
      || previous?.kind !== expected?.kind
      || (previous?.kind === 'library'
        && expected?.kind === 'library'
        && previous.phase !== expected.phase)
    ) {
      throw new Error('Storage move intent changed')
    }

    commit?.(row)
    const recovery: StorageMoveRecovery = { ...row.recovery }
    if (current)
      recovery.current = current
    else delete recovery.current
    patch(row.id, { recovery })
  })
}

function runMove(...args: Parameters<typeof runMoveImpl>) {
  return withMaintenanceLease({ global: true, producer: true }, () =>
    runMoveImpl(...args))
}

function itemDone(state: Running, bytes: number) {
  const row = moveRow(state.id)!

  state.current = 0
  patch(state.id, {
    itemsDone: row.itemsDone + 1,
    bytesDone: row.bytesDone + bytes,
  })
}

async function waitForEngine(state: Running, movePending = false) {
  while (!isEngineReady()) {
    if (state.cancelled && !movePending)
      break
    state.waiting = true
    await sleep(POLL_MS * 2)
  }

  state.waiting = false
}

async function moveDownloads(state: Running, row: StorageMove) {
  const target = row.target
  const current = row.recovery?.current
  if (current) {
    if (current.kind !== 'downloads')
      throw new Error('Storage move intent kind changed')
    await withTorrentStorageMutation(current.torrentId, async () => {
      markMoving(current.torrentId)
      try {
        await recoverDownload(state, current)
      }
      finally {
        unmarkMoving(current.torrentId)
      }
    })
  }
  if (
    state.cancelled
    || state.recoveryOnly
    || moveRow(row.id)?.recovery?.current
  ) {
    return
  }

  // Без данных на диске: следующая закачка начнётся в новом каталоге
  for (const item of getDb()
    .select()
    .from(torrents)
    .all()
    .filter(row => !torrentAtRoot(row, target))
    .map(row => ({ row }))) {
    if (!item.row.inEngine) {
      await withTorrentStorageMutation(item.row.id, async () => {
        const current = getDb()
          .select()
          .from(torrents)
          .where(eq(torrents.id, item.row.id))
          .get()
        if (current && !current.inEngine) {
          setDownloadDir(
            current,
            isIsolatedTorrentDir(torrentDir(current), current.infoHash)
              ? isolatedTorrentDir(target, current.infoHash)
              : target,
          )
        }
      })
    }
  }

  for (;;) {
    if (state.cancelled)
      return

    await waitForEngine(state)
    if (state.cancelled)
      return

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

    await withTorrentStorageMutation(next.row.id, async () => {
      const current = getDb()
        .select()
        .from(torrents)
        .where(eq(torrents.id, next.row.id))
        .get()
      if (current && current.inEngine && !torrentAtRoot(current, target))
        await moveOneTorrent(state, current, target, next.bytes)
    })
    if (moveRow(row.id)?.recovery?.current)
      return
  }
}

function moveResponseUncertain(error: EngineError) {
  const status = error.status
  const invalidSuccess = status !== undefined && status >= 200 && status < 300
  const serverFailure = status !== undefined && status >= 500
  return (
    error.kind === 'unavailable'
    || error.kind === 'timeout'
    || error.kind === 'moving'
    || invalidSuccess
    || serverFailure
  )
}

function requireDownloadTorrent(state: Running, intent: DownloadIntent) {
  const row = moveRow(state.id)
  const torrent = getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.id, intent.torrentId))
    .get()
  if (
    !row
    || row.kind !== 'downloads'
    || !torrent
    || torrent.infoHash !== intent.infoHash
    || !/^[0-9a-f]{40}$/.test(intent.infoHash)
    || resolve(intent.source) !== intent.source
    || (intent.target !== row.target
      && intent.target !== isolatedTorrentDir(row.target, intent.infoHash))
    || intent.source === intent.target
    || !Number.isSafeInteger(intent.bytes)
    || intent.bytes < 0
  ) {
    throw new Error('Invalid download move intent')
  }
  return torrent
}

async function finalizeDownload(state: Running, intent: DownloadIntent) {
  const current = requireDownloadTorrent(state, intent)
  const separated = await libraryCopiesOnOtherVolumes(current, intent.target)
  transitionIntent(state, intent, undefined, (row) => {
    requireDownloadTorrent(state, intent)
    setDownloadDir(current, intent.target)
    for (const id of separated) {
      getDb()
        .update(mediaFiles)
        .set({ linkMode: 'copy' })
        .where(and(eq(mediaFiles.id, id), eq(mediaFiles.torrentId, current.id)))
        .run()
    }
    patch(row.id, {
      itemsDone: row.itemsDone + 1,
      bytesDone: row.bytesDone + intent.bytes,
    })
  })
  state.current = 0
}

async function pollMove(
  state: Running,
  intent: DownloadIntent,
  initial: EngineMoveState,
) {
  let move = initial
  for (;;) {
    if ((move.state !== 'running' || move.dir) && move.dir !== intent.target)
      throw new EngineMoveFailed('Engine move returned an unexpected path')
    if (move.state !== 'running')
      return move

    state.current = move.bytesDone
    await sleep(POLL_MS)
    move = await torrentMoveState(intent.infoHash)
  }
}

async function recoverDownload(
  state: Running,
  intent: DownloadIntent,
  statusMissing = false,
): Promise<'done' | 'rolled_back' | 'unresolved'> {
  requireDownloadTorrent(state, intent)
  for (let n = 0; n <= ENGINE_RETRIES; n++) {
    try {
      await waitForEngine(state, true)
      let move = statusMissing
        ? undefined
        : await torrentMoveState(intent.infoHash).catch((err) => {
            if (!(err instanceof EngineError) || err.kind !== 'not_found')
              throw err
            return undefined
          })
      statusMissing = false
      if (move?.state === 'running')
        move = await pollMove(state, intent, move)

      const inventory = await engineStorageInventory()
      const current = inventory.find(
        item => item.infoHash === intent.infoHash,
      )
      if (current?.state === 'active') {
        if (current.dir === intent.target) {
          if (!move || move.state === 'done' || move.dir !== intent.target) {
            await finalizeDownload(state, intent)
            return 'done'
          }
        }
        if (
          current.dir === intent.source
          && (!move || move.state === 'failed' || move.dir !== intent.target)
        ) {
          transitionIntent(state, intent)
          state.current = 0
          return 'rolled_back'
        }
      }
      // A completed job may be visible just before Go publishes ownership.
      if (state.cancelled && !move)
        return 'unresolved'
    }
    catch (err) {
      if (
        !(err instanceof EngineError)
        || (err.kind !== 'not_found' && !moveResponseUncertain(err))
      ) {
        throw err
      }
    }

    if (n < ENGINE_RETRIES)
      await sleep(POLL_MS)
  }
  return 'unresolved'
}

async function moveOneTorrent(
  state: Running,
  torrent: Torrent,
  target: string,
  bytes: number,
) {
  markMoving(torrent.id)
  const source = resolve(torrentDir(torrent))
  let destination = isIsolatedTorrentDir(source, torrent.infoHash)
    ? isolatedTorrentDir(target, torrent.infoHash)
    : target
  let canUseMissingCompatibility = true

  try {
    for (let attempt = 0; attempt <= ENGINE_RETRIES; attempt++) {
      if (state.cancelled)
        return
      // Recheck immediately before every actual POST, including new isolated paths.
      const [needed, disk] = await Promise.all([
        moveBytesNeeded('downloads', target),
        diskUsage(target),
      ])
      if (state.cancelled)
        return
      if (needed > disk.free)
        throw new StorageMoveError('no_space')

      const intent: DownloadIntent = {
        kind: 'downloads',
        token: randomUUID(),
        torrentId: torrent.id,
        infoHash: torrent.infoHash,
        source,
        target: destination,
        bytes,
      }
      transitionIntent(state, undefined, intent)

      let acknowledged = false
      try {
        const result = await moveTorrent(intent.infoHash, intent.target)
        acknowledged = true
        const done = await pollMove(state, intent, result)
        if (done.state === 'failed') {
          transitionIntent(state, intent)
          throw new EngineMoveFailed(
            done.error ?? 'Engine move failed',
            done.kind,
          )
        }
      }
      catch (err) {
        if (!(err instanceof EngineError))
          throw err
        if (
          err.engineCode === 'storage_path_conflict'
          && destination === target
        ) {
          transitionIntent(state, intent)
          destination = isolatedTorrentDir(target, torrent.infoHash)
          continue
        }
        // Only a definite first POST 404 may retarget a forgotten engine row.
        // A poll GET can also be 404, so keep that case in recovery.
        if (
          err.kind === 'not_found'
          && err.engineCode === 'torrent_not_found'
          && !acknowledged
          && canUseMissingCompatibility
          && err.status === 404
        ) {
          await finalizeDownload(state, intent)
          return
        }
        if (err.kind !== 'not_found' && !moveResponseUncertain(err)) {
          transitionIntent(state, intent)
          throw err
        }

        canUseMissingCompatibility = false
        const recovered = await recoverDownload(
          state,
          intent,
          acknowledged && err.kind === 'not_found',
        )
        if (recovered !== 'rolled_back')
          return
        continue
      }

      await finalizeDownload(state, intent)
      return
    }
    throw new EngineMoveFailed('Engine move retry limit reached')
  }
  finally {
    unmarkMoving(torrent.id)
  }
}

function setDownloadDir(torrent: Pick<Torrent, 'id'>, target: string) {
  getDb()
    .update(torrents)
    .set({ downloadDir: downloadDirValue(target) })
    .where(eq(torrents.id, torrent.id))
    .run()
}

/**
 * Раздача уехала с тома библиотеки: её файлы в библиотеке больше не общие с
 * раздачей. Они отмечаются копиями, и связыватель возвращает закреплённую
 * раздачу в кэш, как после копии
 */
async function libraryCopiesOnOtherVolumes(torrent: Torrent, target: string) {
  const files = getDb()
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.torrentId, torrent.id))
    .all()
    .filter(file => file.linkMode && file.linkMode !== 'copy')

  if (!files.length)
    return []

  const folders = new Map(
    managedFolders().map(folder => [folder.id, folder]),
  )
  const separated: string[] = []

  for (const file of files) {
    const folder = folders.get(file.folderId)

    if (folder && !(await sameVolume(folder.path, target)))
      separated.push(file.id)
  }

  return separated
}

async function moveLibrary(state: Running, row: StorageMove) {
  const current = row.recovery?.current
  if (current) {
    if (current.kind !== 'library')
      throw new Error('Storage move intent kind changed')
    await recoverLibrary(state, current)
  }
  if (state.cancelled || state.recoveryOnly)
    return

  const target = managedFolder()
  // The env-backed destination can change across a restart, but a saved
  // capture is always reconciled against its original registered roots first.
  if (target.path !== row.target)
    patch(row.id, { target: target.path })

  const aliases = new Set<string>()
  const sources: LibraryFolder[] = []
  for (const folder of managedFolders()) {
    if (folder.id === target.id)
      continue
    if (await sameDirectory(folder.path, target.path))
      aliases.add(folder.id)
    else sources.push(folder)
  }

  // Historical orphans predate this job. Never sweep over a source just
  // recreated after we transferred its database row.
  if (!moveRow(row.id)!.itemsDone) {
    await removeOrphans(
      state,
      sources,
      target,
      current?.orphan ? current : undefined,
    )
  }

  const items = await libraryMoveItems(target)
  const remaining = new Map<string, number>()
  for (const { sidecars } of items) {
    for (const { path } of sidecars)
      remaining.set(path, (remaining.get(path) ?? 0) + 1)
  }

  for (const { file, folder, bytes, sidecars } of items) {
    if (state.cancelled)
      return
    state.currentName = basename(file.relPath)
    if (aliases.has(folder.id)) {
      getDb().transaction(() => {
        retargetLibraryFile(file, target)
        itemDone(state, bytes)
      })
      continue
    }

    const moved = await moveLibraryFile(
      state,
      file,
      folder,
      target,
      bytes,
      sidecars,
      remaining,
    )
    if (!moved) {
      itemDone(state, bytes)
      continue
    }
    for (const { path } of sidecars)
      remaining.set(path, remaining.get(path)! - 1)
  }

  dropEmptyManagedFolders()
}

function takenIn(target: LibraryFolder, relPath: string) {
  return getDb()
    .select({ id: mediaFiles.id })
    .from(mediaFiles)
    .where(
      and(eq(mediaFiles.folderId, target.id), eq(mediaFiles.relPath, relPath)),
    )
    .get()
}

function retargetLibraryFile(file: MediaFile, target: LibraryFolder) {
  if (takenIn(target, file.relPath)) {
    logFor('storage').warn(
      { mediaFileId: file.id },
      'Library file name is taken in the new folder',
    )
    return
  }

  getDb()
    .update(mediaFiles)
    .set({ folderId: target.id })
    .where(eq(mediaFiles.id, file.id))
    .run()
}

/**
 * Остановка между переключением строки и удалением исходника оставляет файл
 * в прежней папке без строки. Он удаляется, если его копия на месте в новой;
 * файл со своей строкой не трогаем
 */
async function removeOrphans(
  state: Running,
  sources: LibraryFolder[],
  target: LibraryFolder,
  recovered?: LibraryIntent,
) {
  if (!sources.length)
    return

  const db = getDb()
  const moved = db
    .select()
    .from(mediaFiles)
    .where(
      and(eq(mediaFiles.folderId, target.id), eq(mediaFiles.state, 'present')),
    )
    .all()

  for (const folder of sources) {
    const own = new Set(
      db
        .select({ relPath: mediaFiles.relPath })
        .from(mediaFiles)
        .where(eq(mediaFiles.folderId, folder.id))
        .all()
        .map(item => item.relPath),
    )

    for (const file of moved) {
      if (state.cancelled)
        return
      if (
        own.has(file.relPath)
        || (file.id === recovered?.mediaId
          && folder.id === recovered.sourceFolderId)
      ) {
        continue
      }

      const orphan = absolutePathOf(folder, file)

      const destination = absolutePathOf(target, file)
      if (
        !(await lstatIfPresent(orphan))?.isFile()
        || !(await independentTargetStat(orphan, destination))
      ) {
        continue
      }

      const compared = await compareFiles(orphan, destination)
      if (!compared)
        continue
      // Historical rows only prove ownership of the video's name.
      await transferLibraryItem(
        state,
        file,
        folder,
        target,
        0,
        [
          {
            source: snapshot(orphan, compared.source),
            target: snapshot(destination, compared.target),
          },
        ],
        file.linkMode,
        true,
      )
      logFor('storage').info(
        { mediaFileId: file.id },
        'Leftover library file removed',
      )
    }
  }
}

/**
 * Файл раздачи на томе новой папки: из него получится хардлинк. Только
 * докачанный: хардлинк с недокачанного файла положил бы в библиотеку дыры
 */
async function torrentSourceFor(file: MediaFile, target: LibraryFolder) {
  if (!file.torrentId || file.fileIndex === null)
    return undefined

  const torrent = getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.id, file.torrentId))
    .get()

  if (!torrent?.inEngine || !isEngineReady())
    return undefined

  const live = await listEngineTorrents()
    .then(items => items.find(item => item.infoHash === torrent.infoHash))
    .catch(() => undefined)
  const size = torrent.files?.[file.fileIndex]?.size ?? file.size

  if ((live?.fileProgress[file.fileIndex] ?? 0) < size)
    return undefined

  const source = await sourcePathOf(torrent, file.fileIndex)

  return source && (await sameVolume(dirname(source), target.path))
    ? source
    : undefined
}

async function moveLibraryFile(
  state: Running,
  file: MediaFile,
  folder: LibraryFolder,
  target: LibraryFolder,
  bytes: number,
  sidecars: FileSnapshot[],
  sidecarOwners: Map<string, number>,
) {
  const source = absolutePathOf(folder, file)
  const destination = absolutePathOf(target, file)
  const taken = takenIn(target, file.relPath)

  // Такое имя в новой папке уже занято другим файлом: этот остаётся на месте
  if (taken) {
    logFor('storage').warn(
      { mediaFileId: file.id },
      'Library file name is taken in the new folder',
    )
    return false
  }

  if (sidecars.length + 1 > LIBRARY_MOVE_FILE_LIMIT)
    throw new Error('Too many files in one library move item')
  const sourceInfo = await lstat(source)
  if (!sourceInfo.isFile())
    throw new Error('Library source is not a regular file')

  const fromTorrent = await torrentSourceFor(file, target)
  const video = await placeMovedFile(
    source,
    sourceInfo,
    destination,
    fromTorrent,
  )
  const placedSidecars = await moveSidecars(sidecars, destination)
  const copies = [video, ...placedSidecars] as const
  await Promise.all(copies.map(checkIndependentTarget))
  await Promise.all(copies.map(verifiedTarget))
  const linkMode = video.mode
    ? video.fromTorrent
      ? video.mode
      : linkModeAfter(file.linkMode, video.mode)
    : file.linkMode
  const captured = placedSidecars.filter(
    item => sidecarOwners.get(item.source.path) === 1,
  )
  await transferLibraryItem(
    state,
    file,
    folder,
    target,
    bytes,
    [video, ...captured],
    linkMode,
  )
  return true
}

async function transferLibraryItem(
  state: Running,
  file: MediaFile,
  source: LibraryFolder,
  target: LibraryFolder,
  bytes: number,
  copies: MoveFileReceipt[],
  linkMode: MediaLinkMode | null,
  orphan?: true,
) {
  const video = copies[0]!
  const [sourceRoot, targetRoot, sourceParent, targetParent]
    = await Promise.all([
      directorySnapshot(source.path),
      directorySnapshot(target.path),
      directorySnapshot(dirname(video.source.path)),
      directorySnapshot(dirname(video.target.path)),
    ])
  const intent: LibraryIntent = {
    kind: 'library',
    token: randomUUID(),
    mediaId: file.id,
    relPath: file.relPath,
    sourceFolderId: source.id,
    targetFolderId: target.id,
    sourceRoot,
    targetRoot,
    sourceParent,
    targetParent,
    bytes,
    orphan,
    // Store only the receipts and use a fixed cap per current item.
    files: copies.map(({ source, target }) => ({ source, target })),
    linkMode,
    phase: 'prepared',
  }
  requireLibraryIntent(state, intent)
  transitionIntent(state, undefined, intent)
  await recoverLibrary(state, intent)
}

function requireLibraryIntent(state: Running, intent: LibraryIntent) {
  const job = moveRow(state.id)
  const folders = managedFolders()
  const source = folders.find(row => row.id === intent.sourceFolderId)
  const target = folders.find(row => row.id === intent.targetFolderId)
  const file = getDb()
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.id, intent.mediaId))
    .get()
  const pending
    = intent.phase === 'prepared'
      || intent.phase === 'rollback'
      || intent.phase === 'rolled_back'
  if (
    !job
    || job.kind !== 'library'
    || !source
    || !target
    || !file
    || source.id === target.id
    || source.path !== intent.sourceRoot.path
    || target.path !== intent.targetRoot.path
    || target.path !== job.target
    || !['prepared', 'committed', 'rollback', 'rolled_back', 'cleaned'].includes(
      intent.phase,
    )
    || file.folderId !== (intent.orphan || !pending ? target.id : source.id)
    || file.relPath !== intent.relPath
    || !Number.isSafeInteger(intent.bytes)
    || intent.bytes < 0
    || !/^[\da-f-]{36}$/.test(intent.token)
    || !intent.files.length
    || intent.files.length > LIBRARY_MOVE_FILE_LIMIT
  ) {
    throw new Error('Invalid library move intent')
  }

  const original = absolutePathOf(source, file)
  const destination = absolutePathOf(target, file)
  if (
    original === source.path
    || destination === target.path
    || !within(source.path, original)
    || !within(target.path, destination)
    || intent.sourceParent.path !== dirname(original)
    || intent.targetParent.path !== dirname(destination)
    || intent.files[0]!.source.path !== original
    || intent.files[0]!.target.path !== destination
    || (intent.orphan
      && (intent.files.length !== 1 || takenIn(source, file.relPath)))
  ) {
    throw new Error('Invalid library move paths')
  }
  const prefix = `${basename(baseOf(original))}.`
  const seen = new Set([original])
  for (const { source: from, target: to } of intent.files.slice(1)) {
    const name = basename(from.path)
    if (
      !name.startsWith(prefix)
      || dirname(from.path) !== intent.sourceParent.path
      || dirname(to.path) !== intent.targetParent.path
      || name !== basename(to.path)
      || seen.has(from.path)
    ) {
      throw new Error('Invalid library sidecar path')
    }
    seen.add(from.path)
  }
  return file
}

async function recoverLibrary(state: Running, saved: LibraryIntent) {
  let intent = saved
  const file = requireLibraryIntent(state, intent)
  state.currentName = basename(file.relPath)

  if (intent.phase === 'prepared') {
    try {
      if (!intent.stage) {
        const stage = await createMoveStage(intent)
        const prepared = { ...intent, stage }
        transitionIntent(state, intent, prepared)
        intent = prepared
      }
      await captureLibraryFiles(intent)
    }
    catch (err) {
      if (!(err instanceof MoveCaptureConflict))
        throw err

      // Once rollback begins, a restart must finish restoring, not recapture.
      const rollback = { ...intent, phase: 'rollback' as const }
      transitionIntent(state, intent, rollback)
      await rollbackLibrary(state, rollback)
      throw err
    }

    const committed = { ...intent, phase: 'committed' as const }
    transitionIntent(state, intent, committed, () => {
      requireLibraryIntent(state, intent)
      if (!intent.orphan) {
        const { source, target } = intent.files[0]!
        getDb()
          .update(mediaFiles)
          .set({
            folderId: intent.targetFolderId,
            inode: target.ino,
            mtime: new Date(target.mtimeMs),
            linkMode: intent.linkMode,
          })
          .where(eq(mediaFiles.id, file.id))
          .run()
        rebindMovedSubtitles(
          file.id,
          libraryProbeKey(file.id, source),
          libraryProbeKey(file.id, target),
          new Set(
            intent.files
              .slice(1)
              .map(receipt => basename(receipt.target.path)),
          ),
        )
      }
    })
    intent = committed
  }

  if (intent.phase === 'rollback' || intent.phase === 'rolled_back') {
    await rollbackLibrary(state, intent)
    return
  }

  if (intent.phase === 'committed') {
    await discardCapturedLibraryFiles(intent)
    const cleaned = { ...intent, phase: 'cleaned' as const }
    transitionIntent(state, intent, cleaned)
    intent = cleaned
  }

  await requireMoveTargets(intent)
  await removeMoveStage(intent)
  transitionIntent(state, intent, undefined, (row) => {
    requireLibraryIntent(state, intent)
    if (!intent.orphan) {
      patch(row.id, {
        itemsDone: row.itemsDone + 1,
        bytesDone: row.bytesDone + intent.bytes,
      })
    }
  })
  await removeEmptyMoveParents(intent)
}

async function rollbackLibrary(state: Running, intent: LibraryIntent) {
  if (intent.phase === 'rollback') {
    await restoreCapturedLibraryFiles(intent)
    const restored = { ...intent, phase: 'rolled_back' as const }
    transitionIntent(state, intent, restored)
    intent = restored
  }
  await removeMoveStage(intent)
  transitionIntent(state, intent)
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

interface MovedFile extends MoveFileReceipt {
  mode?: MediaLinkMode
  fromTorrent?: boolean
}

async function checkIndependentTarget(file: MovedFile) {
  if (!(await independentTargetStat(file.source.path, file.target.path)))
    throw new Error('Library file target disappeared during move')
}

async function verifiedTarget(file: MovedFile) {
  const [source, target] = await Promise.all([
    lstatIfPresent(file.source.path),
    lstatIfPresent(file.target.path),
  ])
  if (
    !target
    || !sameIdentity(source, file.source)
    || !sameIdentity(target, file.target)
  ) {
    throw new Error('Library file changed during move')
  }
  return target
}

async function placeMovedFile(
  source: string,
  info: Stats,
  target: string,
  torrentSource?: string,
): Promise<MovedFile> {
  const original = snapshot(source, info)
  if (await independentTargetStat(source, target)) {
    const existing = await compareFiles(source, target)
    if (!existing || !sameIdentity(existing.source, original)) {
      throw Object.assign(new Error('Library file target is occupied'), {
        code: 'EEXIST',
      })
    }
    return { source: original, target: snapshot(target, existing.target) }
  }

  let input = source
  let identity = info
  if (
    torrentSource
    && torrentSource !== source
    && (await lstatIfPresent(torrentSource))?.isFile()
  ) {
    const matching = await compareFiles(source, torrentSource)
    if (matching && sameIdentity(matching.source, original)) {
      input = torrentSource
      identity = matching.target
    }
  }

  const placed = await placeFileWithReceipt(input, target, identity)
  if (
    input !== source
    && !sameIdentity(await lstatIfPresent(input), snapshot(input, identity))
  ) {
    throw new Error('Torrent file changed during move')
  }
  return {
    source: original,
    target: snapshot(target, placed.target),
    mode: placed.mode,
    fromTorrent: input !== source,
  }
}

/** Субтитры и дорожки рядом с тем же базовым именем едут вместе с видео */
async function moveSidecars(sidecars: FileSnapshot[], destination: string) {
  const placed = []
  for (const item of sidecars) {
    const to = join(dirname(destination), basename(item.path))
    const from = await lstatIfPresent(item.path)
    if (!from || !sameIdentity(from, item))
      throw new Error('Library sidecar changed during move')
    placed.push(await placeMovedFile(item.path, from, to))
  }
  return placed
}

/** A surviving hardlink is a copy; a symlink or an alias of the same entry is not. */
async function independentTargetStat(source: string, target: string) {
  const info = await lstatIfPresent(target)
  if (!info)
    return undefined
  if (
    !info.isFile()
    || (await realpath(source)) === (await realpath(target))
    || (basename(source) === basename(target)
      && (await sameDirectory(dirname(source), dirname(target))))
  ) {
    throw Object.assign(
      new Error('Library file target is not an independent file'),
      { code: 'EEXIST' },
    )
  }
  return info
}

/** Bounded reads also allow retrying a verified copy left by an interrupted move. */
async function compareFiles(source: string, target: string) {
  const flags
    = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  const from = await open(source, flags)
  try {
    const to = await open(target, flags)
    try {
      const [a, b] = await Promise.all([from.stat(), to.stat()])
      if (!a.isFile() || !b.isFile() || a.size !== b.size)
        return undefined
      if (a.dev === b.dev && a.ino === b.ino)
        return { source: a, target: b }
      const first = Buffer.alloc(1024 * 1024)
      const second = Buffer.alloc(first.length)
      for (let offset = 0; offset < a.size; offset += first.length) {
        const length = Math.min(first.length, a.size - offset)
        const [one, two] = await Promise.all([
          from.read(first, 0, length, offset),
          to.read(second, 0, length, offset),
        ])
        if (
          one.bytesRead !== length
          || two.bytesRead !== length
          || !first.subarray(0, length).equals(second.subarray(0, length))
        ) {
          return undefined
        }
      }
      if (
        sameIdentity(await from.stat(), snapshot(source, a))
        && sameIdentity(await to.stat(), snapshot(target, b))
      ) {
        return { source: a, target: b }
      }
      return undefined
    }
    finally {
      await to.close()
    }
  }
  finally {
    await from.close()
  }
}

/** The same regular sidecars are counted by preflight and placed by move. */
async function sidecarsOf(source: string, mediaPaths: Set<string>) {
  const prefix = `${basename(baseOf(source))}.`
  const names = await readdir(dirname(source)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT')
        throw error
      return [] as string[]
    },
  )
  const files = []

  for (const name of names) {
    if (!name.startsWith(prefix) || name === basename(source))
      continue

    const path = join(dirname(source), name)
    if (mediaPaths.has(path) || extensionKind(path) === 'video')
      continue

    const found = await lstatIfPresent(path)
    if (found?.isFile())
      files.push(snapshot(path, found))
  }
  return files
}
