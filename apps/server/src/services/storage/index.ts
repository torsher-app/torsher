import type { Torrent } from '../../db/schema.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import type {
  EvictionInput,
  EvictionPlan,
  ShortageKind,
  StoredTorrent,
} from './eviction.ts'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { storagePath, torrentDir } from './paths.ts'
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
import type { StorageFolder } from './folders.ts'
import type { StorageKind } from './paths.ts'
import { diskUsage } from './disk.ts'
import { storageFolder, volumeKey } from './folders.ts'
import { evictionQueue, planEviction, withoutSkipped } from './eviction.ts'
import { defaultPolicy, getPolicy, GIB, savePolicy } from './policy.ts'
import { isMovingTorrent } from './moving.ts'
import { isStreaming } from './streams.ts'

export { GIB } from './policy.ts'
export type { StoragePolicy } from './policy.ts'
export { isStreaming, streamingCount, trackStream } from './streams.ts'

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

interface Volume {
  total: number
  free: number
}

interface Snapshot {
  rows: Torrent[]
  live: Map<string, EngineTorrentState>
  /** Тома по ключу: каталоги раздач и действующий каталог загрузок */
  volumes: Map<string, Volume>
  /** Том раздачи: у раздач в движке и у раздачи запроса */
  volumeOf: Map<string, string>
  /** Том действующего каталога загрузок */
  current: string
}

async function snapshot(request?: SpaceRequest): Promise<Snapshot> {
  const list = await listEngineTorrents()
  const rows = getDb().select().from(torrents).all()
  const live = new Map(list.map(item => [item.infoHash, item]))
  const current = resolve(storagePath('downloads'))
  const dirOf = new Map<string, string>()

  for (const row of rows) {
    if (live.has(row.infoHash))
      dirOf.set(row.id, resolve(torrentDir(row)))
  }

  // Раздача не в движке ляжет в действующий каталог загрузок
  if (request && !dirOf.has(request.torrent.id)) {
    dirOf.set(
      request.torrent.id,
      request.torrent.inEngine ? resolve(torrentDir(request.torrent)) : current,
    )
  }

  const keys = new Map<string, string>()
  const volumes = new Map<string, Volume>()
  const requestDir = request && dirOf.get(request.torrent.id)
  const unavailable = new Set<string>()

  for (const dir of new Set([current, ...dirOf.values()])) {
    try {
      const key = (await volumeKey(dir)) ?? dir

      keys.set(dir, key)

      if (!volumes.has(key))
        volumes.set(key, await diskUsage(dir))
    }
    catch (err) {
      // Без действующего тома и тома запроса решать нечего; отвалившийся
      // чужой том (сетевой экспорт, снятый диск) не должен останавливать
      // учёт места на остальных
      if (dir === current || dir === requestDir)
        throw err

      unavailable.add(dir)
      warnUnavailable(dir, err)
    }
  }

  // Раздачи недоступного тома не вытесняются, не встают на паузу и не входят
  // в лимит кэша: их размер и место под ними сейчас не узнать
  const skipped = new Set(
    [...dirOf].filter(([, dir]) => unavailable.has(dir)).map(([id]) => id),
  )
  const visibleRows = rows.filter(row => !skipped.has(row.id))
  const visibleLive = new Map(live)

  for (const row of rows) {
    if (skipped.has(row.id))
      visibleLive.delete(row.infoHash)
  }

  return {
    rows: visibleRows,
    live: visibleLive,
    volumes,
    volumeOf: new Map(
      [...dirOf]
        .filter(([id]) => !skipped.has(id))
        .map(([id, dir]) => [id, keys.get(dir)!] as const),
    ),
    current: keys.get(current)!,
  }
}

const UNAVAILABLE_WARN_MS = 10 * 60 * 1000
const unavailableWarnedAt = new Map<string, number>()

// Учёт идёт раз в минуту: без ограничения журнал забило бы одним и тем же
function warnUnavailable(dir: string, err: unknown) {
  const now = Date.now()
  const last = unavailableWarnedAt.get(dir)

  if (last !== undefined && now - last < UNAVAILABLE_WARN_MS)
    return

  unavailableWarnedAt.set(dir, now)
  logFor('storage').warn(
    { err },
    'Storage volume is unavailable: its torrents are skipped',
  )
}

interface VolumeTorrent extends StoredTorrent {
  /** Ключ тома; без снимка томов — не задан */
  volume?: string
}

/**
 * Раздачи на диске. Размер — без байт, на которые есть хардлинк или reflink
 * из библиотеки: удаление раздачи их не освободит.
 */
function storedOf(
  rows: Torrent[],
  live: Map<string, EngineTorrentState>,
  now: number,
  volumeOf?: Map<string, string>,
) {
  const stored: VolumeTorrent[] = []
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
      protected:
        isStreaming(row.id)
        || isMovingTorrent(row.id)
        || now - lastUsedAt < RECENT_USE_MS,
      volume: volumeOf?.get(row.id),
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
  if (isStreaming(row.id) || isMovingTorrent(row.id))
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

/**
 * Раздачу могли убрать из движка мимо снимка или она переезжает в другую
 * папку: для паузы это не ошибка
 */
async function ignoreMissing(action: Promise<void>) {
  try {
    await action
    return true
  }
  catch (err) {
    if (
      err instanceof EngineError
      && (err.kind === 'not_found' || err.kind === 'moving')
    ) {
      return false
    }
    throw err
  }
}

/**
 * Пауза при нехватке места: свободного меньше запаса, а вытеснять нечего —
 * встают все раздачи, которые ещё качают. Место появилось — сервер снимает
 * только свою паузу, паузу владельца не трогает.
 */
async function balanceDownloads(
  rows: Torrent[],
  lives: Map<string, EngineTorrentState>,
  free: number,
  minFree: number,
  evicted: Set<string>,
) {
  const paused: string[] = []
  const resumed: string[] = []

  for (const row of rows) {
    const live = lives.get(row.infoHash)

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

function sizeOf(items: StoredTorrent[]) {
  return items.reduce((total, item) => total + item.size, 0)
}

/**
 * Лимит кэша — один на все тома, запас свободного места — на каждом томе
 * свой: удаление кэша с другого тома место на этом не освобождает
 */
async function runEnforce(request?: SpaceRequest): Promise<EnforceResult> {
  const state = await snapshot(request)
  const policy = getPolicy(state.volumes.get(state.current)!.total)
  const minFreeOf = (volume: Volume) =>
    policy.custom ? policy.minFree : defaultPolicy(volume.total).minFree
  const stored = storedOf(state.rows, state.live, Date.now(), state.volumeOf)
  const need = request && {
    bytes: request.bytes,
    torrentId: request.torrent.id,
    cache: request.torrent.retention === 'cache',
  }
  const needVolume = request
    ? state.volumeOf.get(request.torrent.id)!
    : state.current

  const cacheInput: EvictionInput = {
    torrents: stored,
    cacheLimit: policy.cacheLimit,
    minFree: 0,
    free: Number.POSITIVE_INFINITY,
    need,
  }
  const cachePlan = planEviction(cacheInput)
  const fromCache = new Set(cachePlan.evict)
  const volumes = [...state.volumes].map(([key, volume]) => {
    const onVolume = stored.filter(item => item.volume === key)
    const input: EvictionInput = {
      torrents: onVolume.filter(item => !fromCache.has(item.id)),
      cacheLimit: Number.POSITIVE_INFINITY,
      minFree: minFreeOf(volume),
      free:
        volume.free + sizeOf(onVolume.filter(item => fromCache.has(item.id))),
      need: key === needVolume ? need : undefined,
    }

    return { key, volume, onVolume, input, plan: planEviction(input) }
  })

  const lastUsed = new Map(stored.map(item => [item.id, item.lastUsedAt]))
  const planned = [
    ...new Set([
      ...cachePlan.evict,
      ...volumes.flatMap(item => item.plan.evict),
    ]),
  ].sort((a, b) => lastUsed.get(a)! - lastUsed.get(b)!)

  const byId = new Map(state.rows.map(row => [row.id, row]))
  const evicted = new Set<string>()
  const skipped = new Set<string>()

  for (const id of planned) {
    const row = byId.get(id)

    if (row && (await evict(row)))
      evicted.add(id)
    else skipped.add(id)
  }

  const plannedIds = new Set(planned)
  const plannedSize = sizeOf(stored.filter(item => plannedIds.has(item.id)))
  const cache = withoutSkipped(
    cacheInput,
    {
      ...cachePlan,
      evict: planned,
      cacheUsed:
        cachePlan.cacheUsed
        - (plannedSize - sizeOf(stored.filter(item => fromCache.has(item.id)))),
    },
    skipped,
  )
  const plans = new Map<string, { plan: EvictionPlan, minFree: number }>()

  for (const item of volumes) {
    // Вердикт тома со всем вытесненным на нём, включая проход по лимиту кэша
    const plan = withoutSkipped(
      { ...item.input, torrents: item.onVolume, free: item.volume.free },
      {
        ...item.plan,
        evict: item.onVolume
          .filter(entry => fromCache.has(entry.id))
          .map(entry => entry.id)
          .concat(item.plan.evict),
      },
      skipped,
    )

    plans.set(item.key, { plan, minFree: item.input.minFree })
  }

  const target = plans.get(needVolume)!

  // Вытеснение удаляет файлы раздач: без записи его не отличить от потери данных
  if (evicted.size) {
    const freed = sizeOf(stored.filter(item => evicted.has(item.id)))

    logFor('storage').warn(
      {
        count: evicted.size,
        torrentIds: [...evicted],
        freed,
        free: target.plan.free,
      },
      'Cache evicted',
    )
  }

  // Пауза из-за места решается по реальному остатку тома, без будущего просмотра
  for (const [key, { plan, minFree }] of plans) {
    await balanceDownloads(
      state.rows.filter(row => state.volumeOf.get(row.id) === key),
      state.live,
      plan.free,
      minFree,
      evicted,
    )
  }

  const shortage = !target.plan.ok ? target.plan : cache.ok ? undefined : cache

  return {
    evicted: [...evicted],
    ok: target.plan.ok && cache.ok,
    shortage: shortage?.shortage,
    available: (shortage ?? target.plan).available,
    free: target.plan.free,
    minFree: target.minFree,
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
  folders: Record<StorageKind, StorageFolder>
}

export async function getStorageOverview(): Promise<StorageOverview> {
  const disk = await diskUsage(storagePath('downloads'))
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
    path: storagePath('downloads'),
    total: disk.total,
    free: disk.free,
    cacheUsed,
    keptUsed,
    library: { path: storagePath('library'), ...library, own: libraryOwn },
    other: Math.max(
      0,
      disk.total - disk.free - cacheUsed - keptUsed - libraryOwn,
    ),
    policy: getPolicy(disk.total),
    folders: {
      downloads: await storageFolder('downloads', live),
      library: await storageFolder('library', live),
    },
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
  const disk = await diskUsage(storagePath('downloads'))
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
