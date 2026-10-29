import type {
  AttentionItem,
  FolderBrowse,
  OverviewResponse,
  StartStorageMoveInput,
  StorageCheck,
  StorageFolder,
  StorageMoveState,
  StorageOverview,
  StoragePathCheck,
  StoragePathCheckBodyInput,
  UpdateStoragePathInput,
  UpdateStoragePolicyInput,
} from '@torsher/api-client'
import {
  DATA_PATH,
  ENV_PATHS,
  FOLDER_TREE,
  MAIN_DISK,
  policy,
  volumeOf,
} from '../fixtures/storage'
import { ago, elapsedSeconds, MB, nextId } from '@torsher/demo/state'
import { DemoError, get, post, put } from '@torsher/demo/router'
import { torrentsSnapshot } from './downloads'
import {
  connectedFolderPaths,
  managedLibraryUsage,
  setManagedLibraryPath,
} from './library'

type Kind = UpdateStoragePathInput['kind']

/** Путь, выбранный в панели; `null` — путь окружения */
const chosen: Record<Kind, string | null> = { downloads: null, library: null }

interface Leftover {
  path: string
  items: number
  bytes: number
}

/** Что осталось в прежних папках после «Только новые» или отменённого переноса */
const leftovers: Record<Kind, Leftover[]> = { downloads: [], library: [] }

interface Move {
  id: string
  kind: Kind
  target: string
  bytesTotal: number
  itemsTotal: number
  startedAt: number
  startedAtIso: string
  /** Секунд на весь перенос */
  duration: number
  status: StorageMoveState['status']
  /** Доля, на которой перенос остановился */
  stoppedAt?: number
  finishedAt: string | null
}

let move: Move | null = null

// Перенос в демо занимает от нескольких секунд до минуты
const MOVE_SPEED = 400 * MB
const MOVE_MIN_SECONDS = 8
const MOVE_MAX_SECONDS = 45

const QUEUE_PREVIEW = 10

function pathOf(kind: Kind) {
  return chosen[kind] ?? ENV_PATHS[kind]
}

function normalize(path: string) {
  return path.replace(/\/+$/, '') || '/'
}

function overlaps(a: string, b: string) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

function otherKind(kind: Kind): Kind {
  return kind === 'downloads' ? 'library' : 'downloads'
}

function moveShare() {
  if (!move)
    return 0

  if (move.stoppedAt !== undefined)
    return move.stoppedAt

  return Math.min(1, (elapsedSeconds() - move.startedAt) / move.duration)
}

/** Переносит время: закончившийся перенос убирает остатки прежних папок */
function settleMove() {
  if (move?.status !== 'running' || moveShare() < 1)
    return

  move.status = 'done'
  move.stoppedAt = 1
  move.finishedAt = ago(0)
  leftovers[move.kind] = []
}

/** Остатки с учётом идущего переноса: перенесённое из них уже ушло */
function leftoversOf(kind: Kind): Leftover[] {
  if (move?.kind !== kind || move.status !== 'running')
    return leftovers[kind]

  const left = 1 - moveShare()

  return leftovers[kind]
    .map(item => ({
      path: item.path,
      items: Math.ceil(item.items * left),
      bytes: Math.round(item.bytes * left),
    }))
    .filter(item => item.items > 0)
}

/** Сколько всего лежит в папках вида: раздачи на диске или файлы раскладки */
function contentsOf(kind: Kind) {
  if (kind === 'library') {
    const usage = managedLibraryUsage()
    return { items: usage.files, bytes: usage.size }
  }

  const torrents = torrentsSnapshot().filter(item => item.sizeOnDisk > 0)

  return {
    items: torrents.length,
    bytes: torrents.reduce((sum, item) => sum + item.sizeOnDisk, 0),
  }
}

function usage() {
  const torrents = torrentsSnapshot()
  const sizeOf = (retention: 'cache' | 'keep') =>
    torrents
      .filter(item => item.retention === retention)
      .reduce((sum, item) => sum + item.sizeOnDisk, 0)
  const library = managedLibraryUsage()
  // Хардлинк: скачанное и оставленное лежит в библиотеке без второй копии
  const shared = Math.min(
    library.size,
    torrents
      .filter(item => item.inLibrary)
      .reduce((sum, item) => sum + item.sizeOnDisk, 0),
  )
  const cacheUsed = sizeOf('cache')
  const keptUsed = sizeOf('keep')
  const own = library.size - shared
  const free = Math.max(
    0,
    MAIN_DISK.total - MAIN_DISK.other - cacheUsed - keptUsed - own,
  )

  return { torrents, cacheUsed, keptUsed, library, shared, own, free }
}

/** Свободно на томе пути: системный диск считается от загрузок */
function volumeSpace(path: string) {
  const volume = volumeOf(path)

  return volume.mount === '/'
    ? { total: MAIN_DISK.total, free: usage().free }
    : { total: volume.total, free: volume.free }
}

function folderOf(kind: Kind): StorageFolder {
  const path = pathOf(kind)
  const left = leftoversOf(kind)
  const all = contentsOf(kind)

  return {
    path,
    source: chosen[kind] ? 'panel' : 'env',
    envPath: ENV_PATHS[kind],
    ...volumeSpace(path),
    items: Math.max(
      0,
      all.items - left.reduce((sum, item) => sum + item.items, 0),
    ),
    bytes: Math.max(
      0,
      all.bytes - left.reduce((sum, item) => sum + item.bytes, 0),
    ),
    leftovers: left,
  }
}

function moveView(): StorageMoveState | null {
  if (!move)
    return null

  const share = moveShare()
  const names
    = move.kind === 'downloads'
      ? torrentsSnapshot().map(item => item.name)
      : ['Movies', 'Series']
  const itemsDone = Math.floor(move.itemsTotal * share)

  return {
    id: move.id,
    kind: move.kind,
    target: move.target,
    status: move.status,
    bytesTotal: move.bytesTotal,
    bytesDone: Math.round(move.bytesTotal * share),
    itemsTotal: move.itemsTotal,
    itemsDone,
    currentName:
      move.status === 'running' && names.length
        ? names[itemsDone % names.length]!
        : null,
    waiting: false,
    error: null,
    startedAt: move.startedAtIso,
    finishedAt: move.finishedAt,
  }
}

function overview(): StorageOverview {
  settleMove()

  const { torrents, cacheUsed, keptUsed, library, shared, own, free } = usage()
  const linkMode
    = volumeOf(pathOf('library')) === volumeOf(pathOf('downloads'))
      ? 'hardlink'
      : 'copy'

  return {
    path: pathOf('downloads'),
    total: MAIN_DISK.total,
    free,
    cacheUsed,
    keptUsed,
    library: {
      path: pathOf('library'),
      used: library.size,
      shared,
      own,
      linkMode,
    },
    other: MAIN_DISK.other,
    policy: { ...policy },
    // Вытесняется первым то, что дольше всех не смотрели
    queue: torrents
      .filter(
        item =>
          item.retention === 'cache' && item.sizeOnDisk > 0 && !item.streaming,
      )
      .sort((a, b) =>
        (a.lastAccessAt ?? '').localeCompare(b.lastAccessAt ?? ''),
      )
      .slice(0, QUEUE_PREVIEW)
      .map(item => ({
        torrentId: item.id,
        name: item.name,
        sizeOnDisk: item.sizeOnDisk,
        lastAccessAt: item.lastAccessAt,
      })),
    folders: {
      downloads: folderOf('downloads'),
      library: folderOf('library'),
    },
    move: moveView(),
  }
}

/** Плитка хранилища «Обзора» */
export function storageStats(): OverviewResponse['storage'] {
  const { cacheUsed, free } = usage()

  return {
    usedByCache: cacheUsed,
    cacheLimit: policy.cacheLimit,
    free,
    total: MAIN_DISK.total,
    minFree: policy.minFree,
  }
}

/** Причины «Требует внимания» хранилища, как их собирает сервер */
export function storageAttention(): AttentionItem[] {
  const { torrents, free } = usage()
  const items: AttentionItem[] = []

  if (free < policy.minFree) {
    items.push({
      kind: 'storage_low',
      severity: 'error',
      section: 'storage',
      params: { free, minFree: policy.minFree },
    })
  }

  const paused = torrents
    .filter(item => item.state === 'paused' && item.pauseReason === 'storage')
    .map(item => item.name)

  if (paused.length) {
    items.push({
      kind: 'storage_paused',
      severity: 'warning',
      section: 'storage',
      params:
        paused.length === 1
          ? { count: 1, name: paused[0] }
          : { count: paused.length },
    })
  }

  if (overview().library.linkMode === 'copy') {
    items.push({
      kind: 'library_copies',
      severity: 'warning',
      section: 'storage',
      params: {},
    })
  }

  return items
}

/** Причина отказа, как у сервера: путь окружения разрешён всегда */
function problemOf(kind: Kind, path: string): StoragePathCheck['problem'] {
  if (!path.startsWith('/'))
    return 'not_absolute'

  if (path === ENV_PATHS[kind])
    return null

  if (overlaps(path, DATA_PATH))
    return 'inside_data'

  const other = otherKind(kind)

  if ([pathOf(other), ENV_PATHS[other]].some(item => overlaps(item, path)))
    return 'overlaps_other'

  if (connectedFolderPaths().some(item => overlaps(item, path)))
    return 'library_folder'

  return null
}

function bytesToMove(kind: Kind, target: string) {
  const sameVolume = volumeOf(target) === volumeOf(pathOf(kind))
  return sameVolume ? 0 : contentsOf(kind).bytes
}

function check(kind: Kind, rawPath: string): StoragePathCheck {
  const path = rawPath.startsWith('/') ? normalize(rawPath) : rawPath
  const problem = problemOf(kind, path)

  if (problem === 'not_absolute') {
    return {
      path,
      problem,
      exists: false,
      writable: false,
      total: 0,
      free: 0,
      sameVolume: false,
      linkMode: null,
      moveBytes: 0,
    }
  }

  const other = pathOf(otherKind(kind))

  return {
    path,
    problem,
    exists: path in FOLDER_TREE,
    writable: true,
    ...volumeSpace(path),
    sameVolume: volumeOf(path) === volumeOf(pathOf(kind)),
    linkMode: volumeOf(path) === volumeOf(other) ? 'hardlink' : 'copy',
    moveBytes: problem ? 0 : bytesToMove(kind, path),
  }
}

function busy() {
  settleMove()

  if (move?.status === 'running') {
    throw new DemoError(409, {
      kind: 'busy',
      message: 'Storage move is running',
    })
  }
}

/** Переносит остатки прежних папок вида в действующую */
function beginMove(kind: Kind) {
  const from = leftovers[kind]
  const bytesTotal = from.reduce((sum, item) => sum + item.bytes, 0)
  const itemsTotal = from.reduce((sum, item) => sum + item.items, 0)
  const target = pathOf(kind)

  if (
    from.some(item => volumeOf(item.path) !== volumeOf(target))
    && bytesTotal > volumeSpace(target).free
  ) {
    throw new DemoError(422, { kind: 'no_space', message: 'Not enough space' })
  }

  move = {
    id: nextId('move'),
    kind,
    target,
    bytesTotal,
    itemsTotal,
    startedAt: elapsedSeconds(),
    startedAtIso: ago(0),
    duration: Math.min(
      MOVE_MAX_SECONDS,
      Math.max(MOVE_MIN_SECONDS, bytesTotal / MOVE_SPEED),
    ),
    status: 'running',
    finishedAt: null,
  }
}

get<StorageOverview>('/api/storage', overview)

put<StorageOverview, UpdateStoragePolicyInput>(
  '/api/storage/policy',
  ({ body }) => {
    policy.cacheLimit = body.cacheLimit
    policy.minFree = body.minFree
    policy.custom = true

    return overview()
  },
)

get<FolderBrowse>('/api/storage/browse', ({ query }) => {
  const raw = query.get('path') || '/'
  const path = raw.startsWith('/') ? normalize(raw) : '/'
  const entries = FOLDER_TREE[path]

  if (!entries) {
    throw new DemoError(422, {
      message: `ENOENT: no such file or directory, scandir '${path}'`,
    })
  }

  return {
    path,
    parent: path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/',
    entries: entries.map(name => ({
      name,
      path: path === '/' ? `/${name}` : `${path}/${name}`,
    })),
  }
})

post<StoragePathCheck, StoragePathCheckBodyInput>(
  '/api/storage/check',
  ({ body }) => check(body.kind, body.path),
)

put<StorageOverview, UpdateStoragePathInput>(
  '/api/storage/paths',
  ({ body }) => {
    const { kind, mode } = body
    const target = body.path ? normalize(body.path) : ENV_PATHS[kind]

    if (body.path) {
      const result = check(kind, target)

      if (result.problem) {
        throw new DemoError(422, {
          kind: result.problem,
          message: 'Folder cannot be used',
        })
      }

      if (mode === 'move' && result.moveBytes > result.free) {
        throw new DemoError(422, {
          kind: 'no_space',
          message: 'Not enough space',
        })
      }
    }

    busy()

    const current = folderOf(kind)

    if (target !== current.path) {
      if (current.items > 0) {
        leftovers[kind] = [
          ...leftovers[kind],
          { path: current.path, items: current.items, bytes: current.bytes },
        ]
      }

      chosen[kind] = target === ENV_PATHS[kind] ? null : target

      if (kind === 'library')
        setManagedLibraryPath(target)
    }

    if (mode === 'move' && leftovers[kind].length)
      beginMove(kind)

    return overview()
  },
)

post<StorageOverview, StartStorageMoveInput>(
  '/api/storage/move',
  ({ body }) => {
    busy()
    beginMove(body.kind)

    return overview()
  },
)

// Отмена — после текущего элемента: перенесённое остаётся на новом месте
post<StorageOverview>('/api/storage/move/cancel', () => {
  settleMove()

  if (move?.status === 'running') {
    const share = moveShare()
    const kind = move.kind

    leftovers[kind] = leftoversOf(kind)
    move.stoppedAt = share
    move.status = 'cancelled'
    move.finishedAt = ago(0)
  }

  return overview()
})

get<StorageCheck>('/api/setup/storage-check', () => {
  const { free } = usage()
  const dir = (path: string) => ({ path, exists: true, writable: true })

  return {
    data: dir(DATA_PATH),
    downloads: dir(pathOf('downloads')),
    library: dir(pathOf('library')),
    linkMode: overview().library.linkMode,
    space: {
      total: MAIN_DISK.total,
      free,
      status: free < policy.minFree ? 'critical' : 'ok',
    },
  }
})
