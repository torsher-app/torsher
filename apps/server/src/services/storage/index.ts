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
import { libraryUsage, linkedBytesByTorrent } from '../library/files.ts'
import { librarySharesVolume } from '../library/link.ts'
import { logFor } from '../logs/index.ts'
import { diskUsage } from './disk.ts'
import { evictionQueue, planEviction, withoutSkipped } from './eviction.ts'
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

export interface StorageShortage {
  kind: ShortageKind
  /** Сколько ещё скачает просмотр */
  needed: number
  /** Сколько можно скачать, не нарушив ограничение из `kind` */
  available: number
  /** Свободно на томе после вытеснения кэша */
  free: number
  minFree: number
  cacheLimit: number
}

/** Просмотр не начнётся: места не хватит даже после вытеснения кэша */
export class InsufficientStorageError extends Error {
  readonly shortage: StorageShortage

  constructor(shortage: StorageShortage) {
    super(
      shortage.kind === 'no_space'
        ? 'Not enough free disk space'
        : 'Cache limit is too small for this file',
    )
    this.name = 'InsufficientStorageError'
    this.shortage = shortage
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

/**
 * Раздачи на диске. Размер — без байт, на которые есть хардлинк или reflink
 * из библиотеки: удаление раздачи их не освободит.
 */
function storedOf(
  rows: Torrent[],
  live: Map<string, EngineTorrentState>,
  now: number,
) {
  const stored: StoredTorrent[] = []
  const linked = linkedBytesByTorrent()

  for (const row of rows) {
    const state = live.get(row.infoHash)

    if (!state)
      continue

    const lastUsedAt = (row.lastAccessAt ?? row.addedAt).getTime()

    stored.push({
      id: row.id,
      retention: row.retention,
      size: Math.max(0, state.bytesCompleted - (linked.get(row.id) ?? 0)),
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
  // План строился по снимку, а поток мог открыться, пока вытеснялись другие
  if (isStreaming(row.id))
    return false

  try {
    await forgetTorrent(row.infoHash, { deleteFiles: true })
  }
  catch (err) {
    if (!(err instanceof EngineError) || err.kind !== 'not_found')
      throw err
  }

  update(row.id, { inEngine: false, selectedFiles: null, pauseReason: null })
  return true
}

/** Раздачу могли убрать из движка мимо снимка: для паузы это не ошибка */
async function ignoreMissing(action: Promise<void>) {
  try {
    await action
    return true
  }
  catch (err) {
    if (err instanceof EngineError && err.kind === 'not_found')
      return false
    throw err
  }
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
  evicted: Set<string>,
) {
  const paused: string[] = []
  const resumed: string[] = []

  for (const row of state.rows) {
    const live = state.live.get(row.infoHash)

    if (!live || evicted.has(row.id))
      continue

    // Просмотру место уже выделено перед стартом: его поток не останавливаем
    const downloading
      = !live.paused
        && live.wantedCompleted < live.bytesWanted
        && !isStreaming(row.id)

    if (free < minFree && downloading) {
      if (await ignoreMissing(pauseTorrent(row.infoHash))) {
        update(row.id, { pauseReason: 'storage' })
        paused.push(row.id)
      }
    }
    else if (
      free >= minFree + RESUME_MARGIN
      && row.pauseReason === 'storage'
    ) {
      if (await ignoreMissing(resumeTorrent(row.infoHash))) {
        update(row.id, { pauseReason: null })
        resumed.push(row.id)
      }
    }
  }

  if (paused.length) {
    logFor('storage').warn(
      { count: paused.length, torrentIds: paused, free, minFree },
      'Downloads paused: low disk space',
    )
  }

  if (resumed.length) {
    logFor('storage').info(
      { count: resumed.length, torrentIds: resumed, free, minFree },
      'Downloads resumed: disk space is back',
    )
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
  free: number
  minFree: number
  cacheLimit: number
}

async function runEnforce(request?: SpaceRequest): Promise<EnforceResult> {
  const state = await snapshot()
  const policy = getPolicy(state.total)
  const now = Date.now()
  const input = {
    torrents: storedOf(state.rows, state.live, now),
    cacheLimit: policy.cacheLimit,
    minFree: policy.minFree,
    free: state.free,
    need: request && {
      bytes: request.bytes,
      torrentId: request.torrent.id,
      cache: request.torrent.retention === 'cache',
    },
  }
  const planned = planEviction(input)

  const byId = new Map(state.rows.map(row => [row.id, row]))
  const evicted = new Set<string>()
  const skipped = new Set<string>()

  for (const id of planned.evict) {
    const row = byId.get(id)

    if (row && (await evict(row)))
      evicted.add(id)
    else skipped.add(id)
  }

  const plan = withoutSkipped(input, planned, skipped)

  // Вытеснение удаляет файлы раздач: без записи его не отличить от потери данных
  if (evicted.size) {
    const freed = input.torrents
      .filter(item => evicted.has(item.id))
      .reduce((total, item) => total + item.size, 0)

    logFor('storage').warn(
      { count: evicted.size, torrentIds: [...evicted], freed, free: plan.free },
      'Cache evicted',
    )
  }

  // Пауза из-за места решается по реальному остатку, без будущего просмотра
  await balanceDownloads(state, plan.free, policy.minFree, evicted)

  return {
    evicted: [...evicted],
    ok: plan.ok,
    shortage: plan.shortage,
    available: plan.available,
    free: plan.free,
    minFree: policy.minFree,
    cacheLimit: policy.cacheLimit,
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
    throw new InsufficientStorageError({
      kind: result.shortage ?? 'no_space',
      needed: request.bytes,
      available: result.available,
      free: result.free,
      minFree: result.minFree,
      cacheLimit: result.cacheLimit,
    })
  }
}

export interface StorageOverview {
  path: string
  total: number
  free: number
  cacheUsed: number
  keptUsed: number
  /** Своя раскладка библиотеки; `shared` — общие с раздачами байты */
  library: { path: string, used: number, shared: number, own: number }
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
  const library = libraryUsage()
  // Библиотека на другом томе место загрузок не занимает
  const libraryOwn = librarySharesVolume() ? library.used - library.shared : 0

  return {
    path: config.downloadsPath,
    total: disk.total,
    free: disk.free,
    cacheUsed,
    keptUsed,
    library: { path: config.libraryPath, ...library, own: libraryOwn },
    other: Math.max(
      0,
      disk.total - disk.free - cacheUsed - keptUsed - libraryOwn,
    ),
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
  logFor('storage').info(values, 'Storage policy changed')

  if (isEngineReady())
    await enforceStorage()

  return getStorageOverview()
}

/** Том, кэш и политика без очереди вытеснения — для «Обзора» */
export async function storageSummary(live: Map<string, EngineTorrentState>) {
  const disk = await diskUsage(config.downloadsPath)
  const rows = getDb().select().from(torrents).all()
  const cacheUsed = storedOf(rows, live, Date.now())
    .filter(item => item.retention === 'cache')
    .reduce((total, item) => total + item.size, 0)
  const policy = getPolicy(disk.total)

  return {
    total: disk.total,
    free: disk.free,
    cacheUsed,
    cacheLimit: policy.cacheLimit,
    minFree: policy.minFree,
  }
}

/** Сколько занято кэшем и каков лимит — для строки фильтров загрузок */
export async function cacheSummary(live: Map<string, EngineTorrentState>) {
  const summary = await storageSummary(live)

  return { used: summary.cacheUsed, limit: summary.cacheLimit }
}
