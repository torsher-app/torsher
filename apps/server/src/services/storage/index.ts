import type { Torrent } from '../../db/schema.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import type { ShortageKind, StoredTorrent } from './eviction.ts'
import { eq } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import {
  EngineError,
  forgetTorrent,
  isEngineReady,
  listEngineTorrents,
  pauseTorrent,
  resumeTorrent,
} from '../engine/index.ts'
import { diskUsage } from './disk.ts'
import { evictionQueue, planEviction } from './eviction.ts'
import { getPolicy, GIB, savePolicy } from './policy.ts'
import { isStreaming } from './streams.ts'

export { GIB } from './policy.ts'
export type { StoragePolicy } from './policy.ts'
export { isStreaming, trackStream } from './streams.ts'

// Только что смотрели — плеер на паузе или переключает серию: не вытесняем
const RECENT_USE_MS = 10 * 60 * 1000
// Пауза из-за места снимается с запасом, иначе загрузки дёргались бы
// на границе порога каждую минуту
const RESUME_MARGIN = GIB
const QUEUE_PREVIEW = 10

/** Просмотр не начнётся: места не хватит даже после вытеснения кэша */
export class InsufficientStorageError extends Error {
  readonly kind: ShortageKind
  readonly needed: number
  readonly available: number

  constructor(kind: ShortageKind, needed: number, available: number) {
    super(
      kind === 'no_space'
        ? 'Not enough free disk space'
        : 'Cache limit is too small for this file',
    )
    this.name = 'InsufficientStorageError'
    this.kind = kind
    this.needed = needed
    this.available = available
  }
}

interface Snapshot {
  rows: Torrent[]
  live: Map<string, EngineTorrentState>
  total: number
  free: number
}

async function snapshot(): Promise<Snapshot> {
  const [disk, list] = await Promise.all([
    diskUsage(config.downloadsPath),
    listEngineTorrents(),
  ])

  return {
    rows: getDb().select().from(torrents).all(),
    live: new Map(list.map(item => [item.infoHash, item])),
    total: disk.total,
    free: disk.free,
  }
}

function storedOf(
  rows: Torrent[],
  live: Map<string, EngineTorrentState>,
  now: number,
) {
  const stored: StoredTorrent[] = []

  for (const row of rows) {
    const state = live.get(row.infoHash)

    if (!state)
      continue

    const lastUsedAt = (row.lastAccessAt ?? row.addedAt).getTime()

    stored.push({
      id: row.id,
      retention: row.retention,
      size: state.bytesCompleted,
      lastUsedAt,
      protected: isStreaming(row.id) || now - lastUsedAt < RECENT_USE_MS,
    })
  }

  return stored
}

function update(id: string, values: Partial<typeof torrents.$inferInsert>) {
  getDb().update(torrents).set(values).where(eq(torrents.id, id)).run()
}

/** Убирает раздачу из движка вместе с файлами; строка и позиция просмотра остаются */
async function evict(row: Torrent) {
  try {
    await forgetTorrent(row.infoHash, { deleteFiles: true })
  }
  catch (err) {
    if (!(err instanceof EngineError) || err.kind !== 'not_found')
      throw err
  }

  update(row.id, { inEngine: false, selectedFiles: null, pauseReason: null })
}

/**
 * Пауза при нехватке места: свободного меньше запаса, а вытеснять нечего —
 * встают все раздачи, которые ещё качают. Место появилось — сервер снимает
 * только свою паузу, паузу владельца не трогает.
 */
async function balanceDownloads(
  state: Snapshot,
  free: number,
  minFree: number,
) {
  for (const row of state.rows) {
    const live = state.live.get(row.infoHash)

    if (!live)
      continue

    // Просмотру место уже выделено перед стартом: его поток не останавливаем
    const downloading
      = !live.paused
        && live.wantedCompleted < live.bytesWanted
        && !isStreaming(row.id)

    if (free < minFree && downloading) {
      await pauseTorrent(row.infoHash)
      update(row.id, { pauseReason: 'storage' })
    }
    else if (
      free >= minFree + RESUME_MARGIN
      && row.pauseReason === 'storage'
    ) {
      await resumeTorrent(row.infoHash)
      update(row.id, { pauseReason: null })
    }
  }
}

export interface SpaceRequest {
  torrent: Torrent
  /** Сколько ещё скачает просмотр */
  bytes: number
}

export interface EnforceResult {
  evicted: string[]
  ok: boolean
  shortage?: ShortageKind
  available: number
}

async function runEnforce(request?: SpaceRequest): Promise<EnforceResult> {
  const state = await snapshot()
  const policy = getPolicy(state.total)
  const now = Date.now()
  const plan = planEviction({
    torrents: storedOf(state.rows, state.live, now),
    cacheLimit: policy.cacheLimit,
    minFree: policy.minFree,
    free: state.free,
    need: request && {
      bytes: request.bytes,
      torrentId: request.torrent.id,
      cache: request.torrent.retention === 'cache',
    },
  })

  const byId = new Map(state.rows.map(row => [row.id, row]))

  for (const id of plan.evict) {
    const row = byId.get(id)

    if (row)
      await evict(row)
  }

  // Пауза из-за места решается по реальному остатку, без будущего просмотра
  await balanceDownloads(state, plan.free, policy.minFree)

  return {
    evicted: plan.evict,
    ok: plan.ok,
    shortage: plan.shortage,
    available: plan.available,
  }
}

let queue: Promise<unknown> = Promise.resolve()

/**
 * Соблюдает лимит кэша и запас свободного места. Проверки идут по одной:
 * два просмотра одновременно не решат, что им обоим хватает одного места.
 */
export function enforceStorage(request?: SpaceRequest): Promise<EnforceResult> {
  const task = queue.then(() => runEnforce(request))

  queue = task.catch(() => {})
  return task
}

/** Перед просмотром: освобождает место под остаток файла или объясняет, почему нельзя */
export async function ensureSpaceFor(request: SpaceRequest) {
  if (!isEngineReady())
    return

  const result = await enforceStorage(request)

  if (!result.ok) {
    throw new InsufficientStorageError(
      result.shortage ?? 'no_space',
      request.bytes,
      result.available,
    )
  }
}

export interface StorageOverview {
  path: string
  total: number
  free: number
  cacheUsed: number
  keptUsed: number
  /** Занято на томе не загрузками Torsher (или файлами, которые он не знает) */
  other: number
  policy: { cacheLimit: number, minFree: number, custom: boolean }
  queue: Array<{ torrent: Torrent, size: number }>
}

export async function getStorageOverview(): Promise<StorageOverview> {
  const disk = await diskUsage(config.downloadsPath)
  const rows = getDb().select().from(torrents).all()
  const live = isEngineReady()
    ? new Map((await listEngineTorrents()).map(item => [item.infoHash, item]))
    : new Map<string, EngineTorrentState>()
  const stored = storedOf(rows, live, Date.now())
  const byId = new Map(rows.map(row => [row.id, row]))
  const sum = (retention: StoredTorrent['retention']) =>
    stored
      .filter(item => item.retention === retention)
      .reduce((total, item) => total + item.size, 0)
  const cacheUsed = sum('cache')
  const keptUsed = sum('keep')

  return {
    path: config.downloadsPath,
    total: disk.total,
    free: disk.free,
    cacheUsed,
    keptUsed,
    other: Math.max(0, disk.total - disk.free - cacheUsed - keptUsed),
    policy: getPolicy(disk.total),
    queue: evictionQueue(stored)
      .slice(0, QUEUE_PREVIEW)
      .flatMap((item) => {
        const torrent = byId.get(item.id)
        return torrent ? [{ torrent, size: item.size }] : []
      }),
  }
}

/** Сохраняет политику и сразу применяет её: новый лимит может требовать вытеснения */
export async function updatePolicy(values: {
  cacheLimit: number
  minFree: number
}) {
  savePolicy(values)

  if (isEngineReady())
    await enforceStorage()

  return getStorageOverview()
}

/** Сколько занято кэшем и каков лимит — для строки фильтров загрузок */
export async function cacheSummary(live: Map<string, EngineTorrentState>) {
  const disk = await diskUsage(config.downloadsPath)
  const rows = getDb().select().from(torrents).all()
  const used = storedOf(rows, live, Date.now())
    .filter(item => item.retention === 'cache')
    .reduce((total, item) => total + item.size, 0)

  return { used, limit: getPolicy(disk.total).cacheLimit }
}
