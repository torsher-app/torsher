import { reconcileSourceEviction } from '../libraryMaintenance/provenance.ts'
import {
  acquireMaintenanceLease,
  MaintenanceBusyError,
  withMaintenanceLease,
} from '../libraryMaintenance/admission.ts'
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
import { storageLocation, storagePath, torrentDir } from './paths.ts'
import { getDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import {
  EngineError,
  engineGeneration,
  engineUnavailableError,
  forgetTorrent,
  isEngineReady,
  listEngineTorrents,
  pauseTorrent,
  torrentStats,
} from '../engine/index.ts'
import { libraryUsage, linkedBytesByTorrent } from '../library/files.ts'
import { librarySharesVolume } from '../library/link.ts'
import { logFor, throttleLog } from '../logs/index.ts'
import type { StorageFolder } from './folders.ts'
import type { StorageKind } from './paths.ts'
import { diskUsage } from './disk.ts'
import { storageFolder, volumeKey } from './folders.ts'
import { evictionQueue, planEviction, withoutSkipped } from './eviction.ts'
import { defaultPolicy, getPolicy, GIB, savePolicy } from './policy.ts'
import { isMovingTorrent, tryTorrentStorageMutation } from './moving.ts'
import { isSeedObligationMet } from '../torrents/seeding.ts'
import { resumeStorageDownload } from '../torrents/index.ts'
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

interface PendingSpace {
  torrent: Torrent
  dir: string
  volume: string
  generation: number
  bytes: number
  files?: number[]
  verifiedFiles?: number[]
  full: boolean
  cache: boolean
  state: 'inflight' | 'confirmed' | 'uncertain'
  playbackLastSeen?: number
}

const pending = new Map<string, PendingSpace>()

interface Snapshot {
  rows: Torrent[]
  live: Map<string, EngineTorrentState>
  /** Тома по ключу: каталоги раздач и действующий каталог загрузок */
  volumes: Map<string, Volume>
  /** Том раздачи: у раздач в движке и у раздачи запроса */
  volumeOf: Map<string, string>
  /** Том действующего каталога загрузок */
  current: string
  dirKeys: Map<string, string>
  requestDir?: string
}

async function snapshot(request?: SpaceRequest): Promise<Snapshot> {
  const list = await listEngineTorrents()
  const rows = getDb().select().from(torrents).all()
  const live = new Map(list.map(item => [item.infoHash, item]))
  const current = resolve(storagePath('downloads'))
  const dirOf = new Map<string, string>()

  for (const row of rows) {
    const state = live.get(row.infoHash)
    if (state)
      dirOf.set(row.id, resolve(state.dir ?? torrentDir(row)))
  }

  const liveDir = request?.forceDirectory
    ? undefined
    : request && live.get(request.torrent.infoHash)?.dir
  const requestDir
    = request
      && resolve(
        liveDir
        ?? request.downloadDir
        ?? (request.torrent.inEngine || request.torrent.downloadDir
          ? torrentDir(request.torrent)
          : current),
      )
  const keys = new Map<string, string>()
  const volumes = new Map<string, Volume>()
  const unavailable = new Set<string>()

  for (const dir of new Set([
    current,
    ...(requestDir ? [requestDir] : []),
    ...dirOf.values(),
    ...[...pending.values()].map(item => item.dir),
  ])) {
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
    dirKeys: keys,
    requestDir,
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
        || pending.has(row.id)
        || !isSeedObligationMet(row, state)
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
async function evictImpl(id: string, live?: EngineTorrentState) {
  const row = getDb().select().from(torrents).where(eq(torrents.id, id)).get()
  if (
    !row
    || row.retention !== 'cache'
    || isStreaming(id)
    || isMovingTorrent(id)
  ) {
    return false
  }

  try {
    if (
      (row.isPrivate || live?.isPrivate)
      && !isSeedObligationMet(row, await torrentStats(row.infoHash))
    ) {
      return false
    }
  }
  catch (err) {
    if (
      !(err instanceof EngineError)
      || err.kind !== 'not_found'
      || row.isPrivate
    ) {
      return false
    }
  }

  try {
    await forgetTorrent(row.infoHash, {
      deleteFiles: true,
      requireVerified: row.isPrivate || live?.isPrivate,
    })
  }
  catch (err) {
    if (
      err instanceof EngineError
      && err.engineCode === 'torrent_obligation_unmet'
    ) {
      return false
    }
    if (!(err instanceof EngineError) || err.kind !== 'not_found')
      throw err
  }

  await reconcileSourceEviction(row.id)
  update(row.id, {
    inEngine: false,
    selectedFiles: null,
    firstFiles: null,
    lowFiles: null,
    pauseReason: null,
  })
  return true
}
async function evict(id: string, live?: EngineTorrentState) {
  return (
    (await tryTorrentStorageMutation(id, () =>
      withMaintenanceLease({ torrentId: id, producer: true }, () =>
        evictImpl(id, live)).catch((error) => {
        if (error instanceof MaintenanceBusyError)
          return false
        throw error
      }))) ?? false
  )
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
  resume: Set<string> | undefined,
) {
  const paused: string[] = []
  for (const row of rows) {
    const live = lives.get(row.infoHash)
    if (!live || evicted.has(row.id))
      continue

    if (free >= minFree + RESUME_MARGIN && row.pauseReason === 'storage')
      resume?.add(row.id)

    const downloading = !live.paused && live.wantedCompleted < live.bytesWanted
    if (free >= minFree || !downloading || isStreaming(row.id))
      continue

    const changed = await tryTorrentStorageMutation(row.id, async () => {
      let release: () => void
      try {
        release = acquireMaintenanceLease({
          torrentId: row.id,
          producer: true,
        })
      }
      catch (error) {
        if (error instanceof MaintenanceBusyError)
          return false
        throw error
      }
      try {
        const current = getDb()
          .select()
          .from(torrents)
          .where(eq(torrents.id, row.id))
          .get()
        if (
          !current?.inEngine
          || current.pauseReason
          || isStreaming(row.id)
          || isMovingTorrent(row.id)
        ) {
          return false
        }
        if (!(await ignoreMissing(pauseTorrent(row.infoHash))))
          return false
        pending.delete(row.id)
        update(row.id, { pauseReason: 'storage' })
        return true
      }
      finally {
        release()
      }
    })
    if (changed)
      paused.push(row.id)
  }

  if (paused.length) {
    logFor('storage').warn(
      { count: paused.length, torrentIds: paused, free, minFree },
      'Downloads paused: low disk space',
    )
  }
}

export interface SpaceRequest {
  /** Наблюдательный контекст: не влияет на admission и число байт. */
  kind?: 'stream' | 'download' | 'unknown'
  torrent: Torrent
  /** Preliminary remaining bytes when detailed targets are unavailable. */
  bytes: number
  files?: number[]
  downloadDir?: string
  forceDirectory?: boolean
  diskProgress?: { dir: string, files: number[] }
  retention?: Torrent['retention']
}

function diskProgress(
  entry: Pick<PendingSpace, 'torrent' | 'dir'>,
  state?: EngineTorrentState,
) {
  if (!state || resolve(state.dir ?? torrentDir(entry.torrent)) !== entry.dir)
    return undefined
  return state
}

function remainingSpace(
  entry: Pick<
    PendingSpace,
    'torrent' | 'files' | 'full' | 'bytes' | 'verifiedFiles'
  >,
  live?: EngineTorrentState,
) {
  if (entry.full) {
    const size
      = entry.torrent.files?.reduce((sum, file) => sum + file.size, 0) ?? 0
    const verifiedBytes
      = entry.verifiedFiles?.reduce((total, bytes) => total + bytes, 0) ?? 0
    return Math.max(
      0,
      size - Math.max(live?.bytesCompleted ?? 0, verifiedBytes),
    )
  }
  if (entry.files) {
    return entry.files.reduce(
      (sum, index) =>
        sum
        + Math.max(
          0,
          (entry.torrent.files?.[index]?.size ?? 0)
          - Math.max(
            live?.fileProgress[index] ?? 0,
            entry.verifiedFiles?.[index] ?? 0,
          ),
        ),
      0,
    )
  }
  return entry.bytes
}

function reservations(state: Snapshot, excludeId?: string) {
  const volumes = new Map<string, number>()
  const rows = new Map(state.rows.map(row => [row.id, row]))
  let cache = 0
  const add = (volume: string, bytes: number, cached: boolean) => {
    volumes.set(volume, (volumes.get(volume) ?? 0) + bytes)
    if (cached)
      cache += bytes
  }
  for (const row of rows.values()) {
    const live = state.live.get(row.infoHash)
    const volume = state.volumeOf.get(row.id)
    if (row.id !== excludeId && volume && live && !live.paused) {
      add(
        volume,
        Math.max(0, live.bytesWanted - live.wantedCompleted),
        row.retention === 'cache',
      )
    }
  }
  for (const [id, reservation] of pending) {
    const live = diskProgress(
      reservation,
      state.live.get(reservation.torrent.infoHash),
    )
    const remaining = remainingSpace(reservation, live)
    if (reservation.playbackLastSeen !== undefined && isStreaming(id))
      reservation.playbackLastSeen = Date.now()
    const covered
      = live
        && !live.paused
        && ((reservation.full && live.fullDownload === true)
          || reservation.files?.every(
            index =>
              live.selected.includes(index)
              || (live.fileProgress[index] ?? 0)
              >= (reservation.torrent.files?.[index]?.size ?? 0),
          ))
    if (
      reservation.generation !== engineGeneration()
      || (reservation.state !== 'inflight'
        && (covered || (live && remaining === 0)))
      || (reservation.state === 'confirmed'
        && (live?.paused
          || (reservation.playbackLastSeen !== undefined
            && Date.now() - reservation.playbackLastSeen > RECENT_USE_MS)))
    ) {
      pending.delete(id)
      continue
    }
    if (id === excludeId)
      continue

    // Active selection already reserves its remaining files on this volume.
    const overlap
      = live && !live.paused
        ? reservation.full
          ? Math.min(
              remaining,
              Math.max(0, live.bytesWanted - live.wantedCompleted),
            )
          : reservation.files
            ? remainingSpace(
                {
                  ...reservation,
                  files: reservation.files.filter(index =>
                    live.selected.includes(index),
                  ),
                },
                live,
              )
            : 0
        : 0
    add(
      state.dirKeys.get(reservation.dir) ?? reservation.volume,
      remaining - overlap,
      reservation.cache,
    )
  }
  return { volumes, cache }
}

export interface EnforceResult {
  evicted: string[]
  ok: boolean
  shortage?: ShortageKind
  available: number
  free: number
  minFree: number
  cacheLimit: number
  needed?: number
}

function sizeOf(items: StoredTorrent[]) {
  return items.reduce((total, item) => total + item.size, 0)
}

/**
 * Лимит кэша — один на все тома, запас свободного места — на каждом томе
 * свой: удаление кэша с другого тома место на этом не освобождает
 */
async function runEnforce(
  request?: SpaceRequest,
  publish?: (entry: PendingSpace) => void,
  resume?: Set<string>,
): Promise<EnforceResult> {
  const generation = engineGeneration()
  const state = await snapshot(request)
  if (generation !== engineGeneration())
    throw engineUnavailableError()
  const policy = getPolicy(state.volumes.get(state.current)!.total)
  const minFreeOf = (volume: Volume) =>
    policy.custom ? policy.minFree : defaultPolicy(volume.total).minFree
  const stored = storedOf(state.rows, state.live, Date.now(), state.volumeOf)
  const outstanding = reservations(state, request?.torrent.id)
  const dir = state.requestDir
  const needVolume = dir ? state.dirKeys.get(dir)! : state.current
  const previous = request && pending.get(request.torrent.id)
  const entry: PendingSpace | undefined
    = request && dir
      ? {
          torrent: request.torrent,
          dir,
          volume: needVolume,
          generation,
          bytes: Math.max(
            request.bytes,
            previous?.dir === dir ? previous.bytes : 0,
          ),
          files: request.files && [
            ...new Set([
              ...request.files,
              ...(previous?.dir === dir ? (previous.files ?? []) : []),
            ]),
          ],
          verifiedFiles:
            request.diskProgress?.dir === dir
              ? request.diskProgress.files
              : undefined,
          full: request.torrent.fullDownload || request.torrent.isPrivate,
          cache: (request.retention ?? request.torrent.retention) === 'cache',
          state: 'inflight',
          ...(request.kind === 'stream' && { playbackLastSeen: Date.now() }),
        }
      : undefined
  const need = entry && {
    bytes: remainingSpace(
      entry,
      diskProgress(entry, state.live.get(entry.torrent.infoHash)),
    ),
    torrentId: entry.torrent.id,
    cache: entry.cache,
  }
  if (publish && previous && entry && previous.dir !== entry.dir) {
    // An unresolved start in a different directory can still publish. Do not
    // overwrite its reservation with a different destination.
    throw new EngineError(
      'moving',
      'Previous download start is still unconfirmed',
    )
  }

  const cacheInput: EvictionInput = {
    torrents: stored,
    cacheLimit: policy.cacheLimit - outstanding.cache,
    minFree: 0,
    free: Number.POSITIVE_INFINITY,
    need,
  }
  const cachePlan = planEviction(cacheInput)
  const fromCache = new Set(cachePlan.evict)
  const volumes = [...state.volumes].map(([key, volume]) => {
    const reserved = outstanding.volumes.get(key) ?? 0
    volume = { ...volume, free: volume.free - reserved }
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

    if (row && (await evict(row.id, state.live.get(row.infoHash))))
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
      plan.free + (outstanding.volumes.get(key) ?? 0),
      minFree,
      evicted,
      resume,
    )
  }

  const shortage
    = publish && need?.bytes === 0
      ? undefined
      : !target.plan.ok
          ? target.plan
          : cache.ok
            ? undefined
            : cache
  if (!shortage && entry)
    publish?.(entry)

  return {
    evicted: [...evicted],
    ok: shortage === undefined,
    shortage: shortage?.shortage,
    needed: need?.bytes,
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
function inStorageQueue<T>(run: () => Promise<T> | T) {
  const task = queue.then(run)
  queue = task.catch(() => {})
  return task
}

const automaticResumes = new Set<string>()

export function enforceStorage(request?: SpaceRequest): Promise<EnforceResult> {
  const candidates = new Set<string>()
  const task = inStorageQueue(() =>
    runEnforce(request, undefined, request ? undefined : candidates),
  )
  void task
    .then(async () => {
      const resumed = await Promise.all(
        [...candidates].map(async (id) => {
          if (automaticResumes.has(id))
            return undefined
          automaticResumes.add(id)
          try {
            return (await resumeStorageDownload(id)) ? id : undefined
          }
          catch (err) {
            if (!(
              err instanceof InsufficientStorageError
              || err instanceof MaintenanceBusyError
            )) {
              logFor('storage').warn(
                { err, torrentId: id },
                'Download resume deferred',
              )
            }
            return undefined
          }
          finally {
            automaticResumes.delete(id)
          }
        }),
      )
      const torrentIds = resumed.filter(id => id !== undefined)
      if (torrentIds.length) {
        logFor('storage').info(
          { count: torrentIds.length, torrentIds },
          'Downloads resumed: disk space is back',
        )
      }
    })
    .catch(() => {})
  return task
}

export function hasPendingTorrentSpace(id: string) {
  return pending.has(id)
}

export function releaseTorrentSpace(id: string) {
  return inStorageQueue(() => {
    pending.delete(id)
  })
}

/** The pending download must be visible to the next admission before engine I/O. */
export async function admitTorrentSpace<T>(
  request: SpaceRequest,
  start: (dir: string) => Promise<T>,
) {
  if (!isEngineReady())
    throw engineUnavailableError()

  let reservation: PendingSpace | undefined
  let previous: PendingSpace | undefined
  const result = await inStorageQueue(() =>
    runEnforce(request, (entry) => {
      reservation = entry
      previous = pending.get(entry.torrent.id)
      pending.set(entry.torrent.id, entry)
    }),
  )
  requireSpace(request, result)

  try {
    if (reservation?.generation !== engineGeneration())
      throw engineUnavailableError()
    const result = await start(reservation.dir)
    await inStorageQueue(() => {
      // Older snapshots may still see the previous paused selection.
      if (reservation && pending.get(request.torrent.id) === reservation)
        reservation.state = 'confirmed'
    })
    return result
  }
  catch (err) {
    await inStorageQueue(() => {
      const id = request.torrent.id
      if (!reservation || pending.get(id) !== reservation)
        return
      if (
        err instanceof EngineError
        && ['rejected', 'not_found', 'moving'].includes(err.kind)
      ) {
        if (previous)
          pending.set(id, previous)
        else pending.delete(id)
      }
      else {
        reservation.state = 'uncertain'
      }
    })
    throw err
  }
}

/** Preliminary check for callers without a validated metainfo/selection. */
export async function ensureSpaceFor(request: SpaceRequest) {
  if (isEngineReady())
    requireSpace(request, await enforceStorage(request))
}

function requireSpace(request: SpaceRequest, result: EnforceResult) {
  if (!result.ok) {
    const shortage: StorageShortage = {
      kind: result.shortage ?? 'no_space',
      needed: result.needed ?? request.bytes,
      available: result.available,
      free: result.free,
      minFree: result.minFree,
      cacheLimit: result.cacheLimit,
    }
    const kind = request.kind ?? 'unknown'
    if (throttleLog(`storage-space:${request.torrent.id}:${kind}`, 60_000)) {
      const { kind: shortageKind, ...numbers } = shortage
      logFor('storage').warn(
        {
          event: 'storage.insufficient_space',
          origin: 'server',
          torrentId: request.torrent.id,
          infoHash: request.torrent.infoHash,
          kind,
          shortage: shortageKind,
          ...numbers,
        },
        'Not enough storage space',
      )
    }
    throw new InsufficientStorageError(shortage)
  }
}

export interface StorageOverview {
  path: string
  total: number
  free: number
  cacheUsed: number
  keptUsed: number
  obligatedUsed: number
  /** Своя раскладка библиотеки; `shared` — общие с раздачами байты */
  library: { path: string, used: number, shared: number, own: number }
  /** Занято на томе не загрузками Torsher (или файлами, которые он не знает) */
  other: number
  policy: { cacheLimit: number, minFree: number, custom: boolean }
  queue: Array<{ torrent: Torrent, size: number }>
  folders: Record<StorageKind, StorageFolder>
}

interface StorageOverviewSnapshot {
  downloads: ReturnType<typeof storageLocation>
  library: ReturnType<typeof storageLocation>
  live: Map<string, EngineTorrentState>
  disks: Map<string, Awaited<ReturnType<typeof diskUsage>>>
  librarySharesVolume: boolean
}

export async function getStorageOverview(
  snapshot?: StorageOverviewSnapshot,
): Promise<StorageOverview> {
  const downloads = snapshot?.downloads ?? storageLocation('downloads')
  const libraryLocation = snapshot?.library ?? storageLocation('library')
  const disk
    = snapshot?.disks.get(downloads.path) ?? (await diskUsage(downloads.path))
  const rows = getDb().select().from(torrents).all()
  const live
    = snapshot?.live
      ?? (isEngineReady()
        ? new Map(
            (await listEngineTorrents()).map(item => [item.infoHash, item]),
          )
        : new Map<string, EngineTorrentState>())
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
  const libraryOwn
    = (snapshot?.librarySharesVolume ?? librarySharesVolume())
      ? library.used - library.shared
      : 0

  return {
    path: downloads.path,
    total: disk.total,
    free: disk.free,
    cacheUsed,
    keptUsed,
    obligatedUsed: rows.reduce((sum, row) => {
      const state = live.get(row.infoHash)
      return (
        sum
        + (isSeedObligationMet(row, state) ? 0 : (state?.bytesCompleted ?? 0))
      )
    }, 0),
    library: { path: libraryLocation.path, ...library, own: libraryOwn },
    other: Math.max(
      0,
      disk.total - disk.free - cacheUsed - keptUsed - libraryOwn,
    ),
    policy: getPolicy(disk.total),
    folders: {
      downloads: await storageFolder('downloads', live, downloads, disk),
      library: await storageFolder(
        'library',
        live,
        libraryLocation,
        snapshot?.disks.get(libraryLocation.path),
      ),
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

function cacheUsedOf(live: Map<string, EngineTorrentState>) {
  const rows = getDb().select().from(torrents).all()
  return storedOf(rows, live, Date.now())
    .filter(item => item.retention === 'cache')
    .reduce((total, item) => total + item.size, 0)
}

/** Read-only overview: a failed disk probe must not hide independent metrics. */
export async function overviewStorageSummary(
  live: Map<string, EngineTorrentState>,
) {
  const disk = await diskUsage(storagePath('downloads')).catch((err) => {
    if (throttleLog('overview-disk-unavailable', 60_000))
      logFor('storage').warn({ err }, 'Overview disk metric unavailable')
    return null
  })
  const policy = getPolicy(disk?.total ?? 0)
  const policyKnown = disk !== null || policy.custom

  return {
    total: disk?.total ?? null,
    free: disk?.free ?? null,
    cacheUsed: cacheUsedOf(live),
    cacheLimit: policyKnown ? policy.cacheLimit : null,
    minFree: policyKnown ? policy.minFree : null,
  }
}

/** Строгая сводка кэша: политика по умолчанию требует измеренного размера тома. */
export async function storageSummary(live: Map<string, EngineTorrentState>) {
  const disk = await diskUsage(storagePath('downloads'))
  const cacheUsed = cacheUsedOf(live)
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
