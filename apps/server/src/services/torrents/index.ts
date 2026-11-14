import type { DiagnosticContext } from '../diagnostics/index.ts'
import { recordCheckpoint } from '../diagnostics/index.ts'
import {
  groupForTorrent,
  protectTorrent,
  reconcileSourceEviction,
  recordActivity,
  recordDownload,
  recordTitleLink,
} from '../libraryMaintenance/provenance.ts'
import {
  acquireMaintenanceLease,
  assertMaintenanceMutation,
  MaintenanceBusyError,
  withMaintenanceLease,
} from '../libraryMaintenance/admission.ts'
import type {
  Torrent,
  TorrentFileEntry,
  TorrentOrigin,
  WatchState,
} from '../../db/schema.ts'
import type {
  EngineTorrentDetails,
  EngineTorrentState,
} from '../engine/index.ts'
import { Buffer } from 'node:buffer'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { torrents, watchStates } from '../../db/schema.ts'
import {
  addTorrent,
  EngineError,
  engineStorageInventory,
  engineUnavailableError,
  forgetTorrent,
  inspectTorrent,
  isEngineReady,
  listEngineTorrents,
  openStream,
  pauseTorrent,
  resolveMagnet,
  resumeTorrent,
  selectFiles,
  torrentStats,
} from '../engine/index.ts'
import { findSidecars } from '../media/subtitles.ts'
import { logFor } from '../logs/index.ts'
import { enforceStorage, ensureSpaceFor } from '../storage/index.ts'
import {
  isMovingTorrent,
  withTorrentStorageMutation as withEngineMutation,
} from '../storage/moving.ts'
import {
  downloadDirValue,
  isolatedTorrentDir,
  storagePath,
  torrentDir,
} from '../storage/paths.ts'
import { parseMagnet } from './magnet.ts'
import { isVideoFile } from './media.ts'
import { downloadOrder } from './order.ts'
import type { PlaybackCache } from './playback.ts'
import {
  bufferedAheadBytes,
  fileOffsetOf,
  playbackCacheAt,
  verifiedFileOffsets,
} from './playback.ts'
import { peekPlaybackIndex } from '../media/cueCache.ts'
import { peekMediaProbe } from '../media/probe.ts'

export { InsufficientStorageError } from '../storage/index.ts'

export { parseMagnet } from './magnet.ts'
export { contentTypeOf, fileNameOf, isVideoFile } from './media.ts'
export { streamWindowOf } from './playback.ts'
export { downloadStateOf } from './state.ts'
export type { DownloadState } from './state.ts'

// Метаданные magnet приходят от пиров: у живой раздачи за секунды,
// у редкой — долго. Дальше считаем, что пиров нет
const MAGNET_RESOLVE_TIMEOUT_MS = 5 * 60 * 1000
// Столько ответ на добавление ждёт метаданные, прежде чем вернуть раздачу
// в статусе `resolving`: панель ждёт ответ не дольше 10 с
const ADD_WAIT_MS = 4000

/** Магнет не разобрался в infohash v1 */
export class InvalidMagnetError extends Error {
  constructor() {
    super('Invalid magnet link')
    this.name = 'InvalidMagnetError'
  }
}

export interface AddResult {
  torrent: Torrent
  created: boolean
}

const resolving = new Map<string, Promise<void>>()
const readyListeners = new Set<(torrent: Torrent) => void>()

/**
 * Раздача получила список файлов (magnet дождался пиров или добавлен
 * `.torrent`). Подписчик — распознавание тайтла по имени для раздач без него.
 */
export function onTorrentReady(listener: (torrent: Torrent) => void) {
  readyListeners.add(listener)

  return () => readyListeners.delete(listener)
}

function notifyReady(torrent: Torrent) {
  for (const listener of readyListeners) listener(torrent)
}

export function listTorrents() {
  return getDb().select().from(torrents).orderBy(desc(torrents.addedAt)).all()
}

export function getTorrent(id: string) {
  return getDb().select().from(torrents).where(eq(torrents.id, id)).get()
}

/** Раздачи, которые уже добавляли для тайтла: «Источники» помечают их */
export function titleTorrents(titleId: string) {
  return getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.titleId, titleId))
    .all()
}

function findByInfoHash(infoHash: string) {
  return getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.infoHash, infoHash))
    .get()
}

function toFileEntries(details: EngineTorrentDetails): TorrentFileEntry[] {
  return details.files.map(file => ({
    path: file.path,
    size: file.length,
    padding: file.padding,
  }))
}

function readyFields(bytes: Uint8Array, details: EngineTorrentDetails) {
  return {
    torrentFile: Buffer.from(bytes),
    files: toFileEntries(details),
    pieceLength: details.pieceLength,
    status: 'ready' as const,
    error: null,
  }
}

function update(id: string, values: Partial<typeof torrents.$inferInsert>) {
  return getDb()
    .update(torrents)
    .set(values)
    .where(eq(torrents.id, id))
    .returning()
    .get()
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runResolveImpl(id: string) {
  const torrent = getTorrent(id)

  if (!torrent?.magnet || torrent.status !== 'resolving')
    return

  const startedAt = Date.now()
  const logFailed = (
    reason: 'timeout' | 'rejected' | 'failed' | 'hash_mismatch',
  ) => {
    logFor('storage').warn(
      {
        event: 'storage.metadata_failed',
        origin: 'server',
        torrentId: torrent.id,
        infoHash: torrent.infoHash,
        reason,
        elapsedMs: Date.now() - startedAt,
      },
      'Torrent metadata failed',
    )
  }
  try {
    const bytes = await resolveMagnet(
      torrent.magnet,
      MAGNET_RESOLVE_TIMEOUT_MS,
    )
    const details = await inspectTorrent(bytes)

    if (details.infoHash.toLowerCase() !== torrent.infoHash) {
      if (update(id, { status: 'failed', error: 'rejected' }))
        logFailed('hash_mismatch')
      return
    }

    notifyReady(
      update(id, {
        ...readyFields(bytes, details),
        name: details.name || torrent.name,
      }),
    )
  }
  catch (err) {
    if (!(err instanceof EngineError))
      throw err

    // Движок перезапускается: раздача останется `resolving` и продолжит,
    // когда он снова ответит (`resumeResolving`)
    if (err.kind === 'unavailable')
      return

    // Раздачу удалили, пока ждали метаданные
    if (!getTorrent(id))
      return

    const reason
      = err.kind === 'timeout' || err.kind === 'rejected' ? err.kind : 'failed'
    if (update(id, { status: 'failed', error: reason }))
      logFailed(reason)
  }
}
function runResolve(...args: Parameters<typeof runResolveImpl>) {
  return withMaintenanceLease({ torrentId: args[0], producer: true }, () =>
    runResolveImpl(...args))
}

/** Одна загрузка метаданных на раздачу, сколько бы раз её ни запускали */
export function resolveTorrent(id: string) {
  const running = resolving.get(id)

  if (running)
    return running

  const task = runResolve(id).finally(() => resolving.delete(id))

  resolving.set(id, task)
  return task
}

/** После старта движка дожидаемся метаданных раздач, начатых до перезапуска */
export function resumeResolving() {
  const pending = getDb()
    .select({ id: torrents.id })
    .from(torrents)
    .where(eq(torrents.status, 'resolving'))
    .all()

  return Promise.all(pending.map(({ id }) => resolveTorrent(id)))
}

/**
 * Раздача по magnet. Метаданные (список файлов) приходят от пиров, поэтому
 * ответ ждёт их недолго, а дальше раздача остаётся `resolving` и дозагружается
 * в фоне. Повторное добавление раздачи, которая не дождалась пиров, — повтор.
 */
export async function addMagnet(
  input: string,
  origin: TorrentOrigin = 'search',
): Promise<AddResult> {
  const magnet = parseMagnet(input)

  if (!magnet)
    throw new InvalidMagnetError()

  assertMaintenanceMutation({ infoHash: magnet.infoHash })
  const existing = findByInfoHash(magnet.infoHash)

  if (existing && existing.status !== 'failed')
    return { torrent: existing, created: false }

  if (!isEngineReady())
    throw engineUnavailableError()

  const torrent = existing
    ? update(existing.id, {
        status: 'resolving',
        error: null,
        magnet: input.trim(),
      })
    : getDb()
        .insert(torrents)
        .values({
          infoHash: magnet.infoHash,
          name: magnet.name ?? magnet.infoHash,
          source: 'magnet',
          magnet: input.trim(),
          status: 'resolving',
          origin,
        })
        .returning()
        .get()

  await Promise.race([resolveTorrent(torrent.id), sleep(ADD_WAIT_MS)])

  return { torrent: getTorrent(torrent.id) ?? torrent, created: !existing }
}

/** Повтор magnet, который не дождался пиров */
export async function retryTorrent(torrent: Torrent) {
  if (torrent.status !== 'failed' || !torrent.magnet)
    return torrent

  return (await addMagnet(torrent.magnet)).torrent
}

/** Раздача из `.torrent`: файлы известны сразу, движок только проверяет файл */
export async function addTorrentFile(
  bytes: Uint8Array,
  origin: TorrentOrigin = 'search',
): Promise<AddResult> {
  const details = await inspectTorrent(bytes)
  const infoHash = details.infoHash.toLowerCase()
  assertMaintenanceMutation({ infoHash })
  const existing = findByInfoHash(infoHash)
  const name = details.name || infoHash

  if (existing) {
    if (existing.status === 'ready')
      return { torrent: existing, created: false }

    // Magnet так и не дождался пиров — файл даёт то же самое сразу
    const ready = update(existing.id, { ...readyFields(bytes, details), name })

    notifyReady(ready)
    return { torrent: ready, created: false }
  }

  const torrent = getDb()
    .insert(torrents)
    .values({
      infoHash,
      name,
      source: 'file',
      origin,
      ...readyFields(bytes, details),
    })
    .returning()
    .get()

  notifyReady(torrent)
  return { torrent, created: true }
}

/**
 * Убирает раздачу из списка и из движка. С `deleteFiles` движок удаляет и её
 * файлы, иначе скачанное остаётся на диске.
 */
async function deleteTorrentImpl(
  torrent: Torrent,
  options: { deleteFiles?: boolean } = {},
) {
  const current = getTorrent(torrent.id)
  if (!current)
    return
  torrent = current
  if (torrent.inEngine) {
    try {
      await forgetTorrent(torrent.infoHash, options)
    }
    catch (err) {
      if (!(err instanceof EngineError) || err.kind !== 'not_found')
        throw err
    }
  }

  if (options.deleteFiles)
    await reconcileSourceEviction(torrent.id)
  getDb().delete(torrents).where(eq(torrents.id, torrent.id)).run()
}
export function deleteTorrent(...args: Parameters<typeof deleteTorrentImpl>) {
  return withMaintenanceLease({ torrentId: args[0].id }, () =>
    withEngineMutation(args[0].id, () => deleteTorrentImpl(...args)))
}

let lastLive = new Map<string, EngineTorrentState>()

/**
 * Последний известный список раздач движка: им пользуются значки на постерах,
 * чтобы списки карточек не ходили в движок. Обновляется каждым `liveTorrents`,
 * а связыватель библиотеки зовёт его раз в минуту.
 */
export function lastLiveTorrents() {
  return lastLive
}

/** Раздачи движка по infohash; без движка или при его ошибке — пусто */
export async function liveTorrents() {
  if (!isEngineReady())
    return new Map<string, EngineTorrentState>()

  try {
    const list = await listEngineTorrents()

    lastLive = new Map(list.map(item => [item.infoHash, item]))
    return lastLive
  }
  catch (err) {
    if (err instanceof EngineError)
      return new Map<string, EngineTorrentState>()

    throw err
  }
}

/** Сколько файла уже скачано: раздачи нет в движке — ничего */
async function downloadedOf(torrent: Torrent, fileIndex: number) {
  if (!torrent.inEngine)
    return 0

  try {
    return (await torrentStats(torrent.infoHash)).fileProgress[fileIndex] ?? 0
  }
  catch (err) {
    if (err instanceof EngineError && err.kind === 'not_found')
      return 0

    throw err
  }
}

function withFiles(selected: number[] | null, added: number[]) {
  const files = selected ?? []

  return [...files, ...added.filter(index => !files.includes(index))]
}

/**
 * Выбор плюс внешние субтитры выбранных видео: они весят килобайты, а в
 * библиотеке ложатся рядом с серией. Дорожки не добавляются — их выбирают
 * руками: у раздачи их бывает на десятки гигабайт.
 */
function withSubtitles(torrent: Torrent, files: number[]) {
  const all = torrent.files ?? []
  const subtitles = files.flatMap(index =>
    isVideoFile(all[index]?.path ?? '')
      ? findSidecars(all, index)
          .filter(sidecar => sidecar.kind === 'subtitle')
          .map(sidecar => sidecar.fileIndex)
      : [],
  )

  return withFiles(files, subtitles)
}

/**
 * Что качается целиком, пока смотрят файл. Раздача из кэша — только явный
 * выбор: просмотр качает окно впереди позиции. Закреплённая — «моё»: файл,
 * который начали смотреть, скачивается целиком.
 */
function streamSelection(torrent: Torrent, fileIndex: number) {
  return torrent.retention === 'keep'
    ? withFiles(torrent.selectedFiles, [fileIndex])
    : (torrent.selectedFiles ?? [])
}

/** Ручные уровни — только для выбранных файлов. */
function priorityWithin(
  torrent: Pick<Torrent, 'firstFiles' | 'lowFiles'>,
  selected: number[],
  key: 'firstFiles' | 'lowFiles',
) {
  const indices = (torrent[key] ?? []).filter(index =>
    selected.includes(index),
  )

  return indices.length ? indices : null
}

/** Раздачу убрали из движка мимо базы: менять выбор не у кого */
async function ignoreMissing(action: Promise<void>) {
  try {
    await action
  }
  catch (err) {
    if (!(err instanceof EngineError) || err.kind !== 'not_found')
      throw err
  }
}

/** Метаданных magnet ещё нет — скачивать и смотреть нечего */
export class NotReadyError extends Error {
  constructor() {
    super('Torrent metadata is not ready')
    this.name = 'NotReadyError'
  }
}

/** Раздачи нет в движке — ставить на паузу нечего */
export class NotInEngineError extends Error {
  constructor() {
    super('Torrent is not downloading')
    this.name = 'NotInEngineError'
  }
}

/** Раздача выбрана из карточки тайтла: «Загрузки» показывают его постер и название */
export function linkTitle(torrent: Torrent, titleId: string) {
  assertMaintenanceMutation({ torrentId: torrent.id, titleId })
  recordTitleLink(torrent.id, titleId)
  return torrent.titleId === titleId
    ? torrent
    : update(torrent.id, { titleId })
}

/**
 * Добавляет раздачу в сохранённом каталоге. Новая без своего каталога получает
 * действующий путь; изоляция переживает даже падение до сохранения engine session.
 */
async function addToEngineImpl(
  torrent: Torrent,
  files: number[],
  dir?: Torrent['downloadDir'],
  requiredBytes?: number,
  paused = false,
  spaceKind: 'stream' | 'download' | 'unknown' = 'unknown',
  priorities?: Pick<Torrent, 'firstFiles' | 'lowFiles'>,
) {
  const current = getTorrent(torrent.id)
  if (!current)
    throw new NotReadyError()
  torrent = current
  if (!torrent.torrentFile)
    throw new NotReadyError()

  if (isMovingTorrent(torrent.id))
    throw new EngineError('moving', 'Torrent is being moved')

  if ((!torrent.inEngine && !torrent.downloadDir) || dir !== undefined) {
    const downloadDir
      = dir !== undefined ? dir : downloadDirValue(storagePath('downloads'))

    if (downloadDir !== torrent.downloadDir) {
      update(torrent.id, { downloadDir })
      torrent = { ...torrent, downloadDir }
    }
  }

  const add = () =>
    addTorrent(
      torrent.torrentFile!,
      downloadOrder(torrent, files),
      torrent.downloadDir ? torrentDir(torrent) : undefined,
      priorityWithin(priorities ?? torrent, files, 'firstFiles') ?? [],
      priorityWithin(priorities ?? torrent, files, 'lowFiles') ?? [],
      paused,
    )
  let details
  try {
    details = await add()
  }
  catch (error) {
    if (
      !(error instanceof EngineError)
      || error.engineCode !== 'storage_path_conflict'
    ) {
      throw error
    }
    const isolated = isolatedTorrentDir(torrentDir(torrent), torrent.infoHash)
    if (isolated === torrentDir(torrent))
      throw error
    // До retry: restart не возвращает раздачу в общий каталог даже при потере ответа.
    torrent = update(torrent.id, { downloadDir: isolated })
    await ensureSpaceFor({
      torrent,
      kind: spaceKind,
      bytes:
        requiredBytes
        ?? files.reduce(
          (sum, index) => sum + (torrent.files?.[index]?.size ?? 0),
          0,
        ),
    })
    details = await add()
  }
  // Engine мог уже принять предыдущий запрос, пока сервер потерял ответ.
  const updated = update(torrent.id, {
    inEngine: true,
    ...(details.dir && { downloadDir: downloadDirValue(details.dir) }),
  })
  // Recovery мог прерваться после durable paused add. Явные PLAY/download
  // снимают эту техническую паузу, даже если в DB pauseReason отсутствует.
  if (!paused && details.paused && !updated.pauseReason)
    await resumeTorrent(updated.infoHash)
  return updated
}
function addToEngine(...args: Parameters<typeof addToEngineImpl>) {
  return withMaintenanceLease({ torrentId: args[0].id }, () =>
    addToEngineImpl(...args))
}

/**
 * Скачать выбранные файлы целиком сейчас. Скачанное руками закрепляется
 * («Оставить»): само оно не удалится. Места мало — сервер сразу ставит
 * загрузку на паузу, и раздача попадает в «Требуют внимания». `dir` —
 * свой каталог раздачи (`download_dir`): новая версия обновлённой темы
 * ложится туда, где лежит старая.
 */
async function downloadFilesImpl(
  torrent: Torrent,
  chosen: number[],
  options: {
    dir?: Torrent['downloadDir']
    origin?: 'follow' | 'manual' | 'preserve'
    priorities?: { index: number, priority: 'high' | 'medium' | 'low' }[]
  } = {},
) {
  torrent = getTorrent(torrent.id) ?? torrent
  if (!torrent.torrentFile)
    throw new NotReadyError()

  const files = withSubtitles(torrent, chosen)
  const overrides = new Map(
    options.priorities?.map(item => [item.index, item.priority]),
  )
  const priorityOf = (index: number) =>
    overrides.get(index)
    ?? (torrent.firstFiles?.includes(index)
      ? 'high'
      : torrent.lowFiles?.includes(index)
        ? 'low'
        : 'medium')
  const first = files.filter(index => priorityOf(index) === 'high')
  const low = files.filter(index => priorityOf(index) === 'low')
  const priorities = {
    firstFiles: first.length ? first : null,
    lowFiles: low.length ? low : null,
  }
  const origin = options.origin ?? 'manual'
  if (origin === 'manual')
    protectTorrent(torrent.id)

  torrent = await addToEngine(
    torrent,
    files,
    options.dir,
    undefined,
    false,
    'download',
    priorities,
  )

  if (torrent.pauseReason)
    await resumeTorrent(torrent.infoHash)

  update(torrent.id, {
    inEngine: true,
    selectedFiles: files,
    ...priorities,
    retention: 'keep',
    pauseReason: null,
  })

  const updated = getTorrent(torrent.id) ?? torrent
  if (origin !== 'preserve') {
    const legacyKeep
      = torrent.retention === 'keep' && !groupForTorrent(torrent.id)
    recordDownload(updated, legacyKeep ? 'manual' : origin)
  }
  await enforceStorage()

  return getTorrent(torrent.id) ?? torrent
}
export function downloadFiles(...args: Parameters<typeof downloadFilesImpl>) {
  return withMaintenanceLease({ torrentId: args[0].id }, () =>
    withEngineMutation(args[0].id, () => downloadFilesImpl(...args)))
}

async function pauseDownloadImpl(torrent: Torrent) {
  torrent = getTorrent(torrent.id) ?? torrent
  if (!torrent.inEngine)
    throw new NotInEngineError()

  await pauseTorrent(torrent.infoHash)

  return update(torrent.id, { pauseReason: 'user' })
}
export function pauseDownload(...args: Parameters<typeof pauseDownloadImpl>) {
  return withMaintenanceLease({ torrentId: args[0].id }, () =>
    withEngineMutation(args[0].id, () => pauseDownloadImpl(...args)))
}

/** Снимает любую паузу; если места всё ещё мало, сервер поставит свою снова */
async function resumeDownloadImpl(torrent: Torrent) {
  torrent = getTorrent(torrent.id) ?? torrent
  if (!torrent.inEngine)
    throw new NotInEngineError()

  await resumeTorrent(torrent.infoHash)
  update(torrent.id, { pauseReason: null })
  await enforceStorage()

  return getTorrent(torrent.id) ?? torrent
}
export function resumeDownload(...args: Parameters<typeof resumeDownloadImpl>) {
  return withMaintenanceLease({ torrentId: args[0].id }, () =>
    withEngineMutation(args[0].id, () => resumeDownloadImpl(...args)))
}

/** Приоритет меняется сразу, только у выбранных файлов. */
async function setFilePriorityImpl(
  torrent: Torrent,
  files: number[],
  priority: 'high' | 'medium' | 'low',
) {
  if (!torrent.inEngine)
    throw new NotInEngineError()

  const selected = torrent.selectedFiles ?? []
  const changed = new Set(files.filter(index => selected.includes(index)))
  const first = selected.filter(index =>
    changed.has(index)
      ? priority === 'high'
      : torrent.firstFiles?.includes(index),
  )
  const low = selected.filter(index =>
    changed.has(index) ? priority === 'low' : torrent.lowFiles?.includes(index),
  )

  await selectFiles(
    torrent.infoHash,
    downloadOrder(torrent, selected),
    first,
    low,
  )

  return update(torrent.id, {
    firstFiles: first.length ? first : null,
    lowFiles: low.length ? low : null,
  })
}
export function setFilePriority(
  ...args: Parameters<typeof setFilePriorityImpl>
) {
  return withMaintenanceLease({ torrentId: args[0].id }, () =>
    setFilePriorityImpl(...args))
}

/** Видеофайлы, которые начали смотреть: на диске уже что-то есть */
async function startedVideos(torrent: Torrent) {
  if (!torrent.inEngine)
    return []

  let progress: number[]

  try {
    progress = (await torrentStats(torrent.infoHash)).fileProgress
  }
  catch (err) {
    if (err instanceof EngineError && err.kind === 'not_found')
      return []

    throw err
  }

  return (torrent.files ?? []).flatMap((file, index) =>
    !file.padding && isVideoFile(file.path) && (progress[index] ?? 0) > 0
      ? [index]
      : [],
  )
}

/**
 * «Оставить» выводит раздачу из-под вытеснения и докачивает начатые
 * видеофайлы. «Не оставлять» возвращает её в кэш и останавливает полную
 * закачку: скачанное остаётся в кэше до вытеснения.
 */
async function setRetentionImpl(
  torrent: Torrent,
  retention: Torrent['retention'],
) {
  if (retention === 'keep')
    recordDownload(torrent, 'manual')
  if (!isEngineReady())
    return update(torrent.id, { retention })

  const selected
    = retention === 'keep'
      ? withSubtitles(
          torrent,
          withFiles(torrent.selectedFiles, await startedVideos(torrent)),
        )
      : []

  const first = priorityWithin(torrent, selected, 'firstFiles')
  const low = priorityWithin(torrent, selected, 'lowFiles')

  if (torrent.inEngine) {
    await ignoreMissing(
      selectFiles(
        torrent.infoHash,
        downloadOrder(torrent, selected),
        first ?? [],
        low ?? [],
      ),
    )
  }

  const updated = update(torrent.id, {
    retention,
    selectedFiles: selected.length ? selected : null,
    firstFiles: first,
    lowFiles: low,
  })

  await enforceStorage()

  return getTorrent(torrent.id) ?? updated
}
export function setRetention(...args: Parameters<typeof setRetentionImpl>) {
  return withMaintenanceLease({ torrentId: args[0].id }, () =>
    setRetentionImpl(...args))
}

/**
 * Выбор, накопленный просмотром до окна просмотра: раньше просмотр добавлял
 * файл к выбору, и раздачи из кэша докачивались целиком. Снимаем его после
 * старта движка; повторный запуск ничего не меняет.
 */
export async function clearStreamSelections() {
  const rows = getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.retention, 'cache'))
    .all()
    .filter(row => row.selectedFiles?.length)

  for (const row of rows) {
    let maintenanceRelease: () => void
    try {
      maintenanceRelease = acquireMaintenanceLease({
        torrentId: row.id,
        producer: true,
      })
    }
    catch (error) {
      if (error instanceof MaintenanceBusyError)
        continue
      throw error
    }
    try {
      if (row.inEngine) {
        try {
          await ignoreMissing(selectFiles(row.infoHash, []))
        }
        catch (err) {
          // Раздача переезжает: выбор снимется при следующем старте движка
          if (err instanceof EngineError && err.kind === 'moving')
            continue

          throw err
        }
      }

      update(row.id, { selectedFiles: null, firstFiles: null, lowFiles: null })
    }
    finally {
      maintenanceRelease()
    }
  }
}

export function playableFile(torrent: Torrent, fileIndex: number) {
  const file = torrent.files?.[fileIndex]

  return file && !file.padding ? file : undefined
}

/**
 * Готовит файл к просмотру: освобождает место под остаток файла (или
 * объясняет, почему не может) и добавляет раздачу в движок. Просмотр раздачи
 * из кэша качает только окно впереди позиции, закреплённой — файл целиком
 * (`streamSelection`). Просмотр снимает паузу: смотреть — значит качать.
 */
async function prepareStreamImpl(torrent: Torrent, fileIndex: number) {
  torrent = getTorrent(torrent.id) ?? torrent
  if (!torrent.torrentFile)
    throw new EngineError('rejected', 'Torrent metadata is not ready')

  const size = torrent.files?.[fileIndex]?.size ?? 0
  const downloaded = await downloadedOf(torrent, fileIndex)

  await ensureSpaceFor({
    torrent,
    kind: 'stream',
    bytes: Math.max(0, size - downloaded),
  })

  const selected = streamSelection(torrent, fileIndex)

  torrent = await addToEngine(
    torrent,
    selected,
    undefined,
    size,
    false,
    'stream',
  )

  if (torrent.pauseReason)
    await resumeTorrent(torrent.infoHash)

  return update(torrent.id, {
    inEngine: true,
    selectedFiles: selected.length ? selected : null,
    firstFiles: priorityWithin(torrent, selected, 'firstFiles'),
    lowFiles: priorityWithin(torrent, selected, 'lowFiles'),
    pauseReason: null,
    lastAccessAt: new Date(),
  })
}
export function prepareStream(...args: Parameters<typeof prepareStreamImpl>) {
  return withMaintenanceLease({ torrentId: args[0].id }, () =>
    withEngineMutation(args[0].id, () => prepareStreamImpl(...args)))
}

/**
 * Открывает поток файла в движке; `window` — сколько байт впереди позиции
 * качать, пока поток открыт. Раздачу, которую движок забыл (новый каталог
 * данных, сброс состояния), добавляет заново.
 */
export async function openFileStream(
  torrent: Torrent,
  fileIndex: number,
  range: string | undefined,
  signal: AbortSignal,
  window?: number,
) {
  try {
    return await openStream(torrent.infoHash, fileIndex, range, signal, window)
  }
  catch (err) {
    if (!(err instanceof EngineError) || err.kind !== 'not_found')
      throw err

    if (!torrent.torrentFile)
      throw new EngineError('rejected', 'Torrent metadata is not ready')

    // Движок потерял раздачу; место под неё проверялось при старте просмотра
    await withEngineMutation(torrent.id, async () => {
      torrent = getTorrent(torrent.id) ?? torrent
      await addToEngine(
        torrent,
        streamSelection(torrent, fileIndex),
        undefined,
        torrent.files?.[fileIndex]?.size ?? 0,
        false,
        'stream',
      )
    })

    return openStream(torrent.infoHash, fileIndex, range, signal, window)
  }
}

/** На каждом engine-ready, до библиотеки/переносов/follow. Неизвестные DB сессии не запускаем. */
async function reconcileEngineStorageImpl() {
  const inventory = await engineStorageInventory()
  for (let item of inventory) {
    const known = findByInfoHash(item.infoHash.toLowerCase())
    if (!known)
      continue
    try {
      await withMaintenanceLease({ torrentId: known.id }, () =>
        withEngineMutation(known.id, async () => {
          const torrent = getTorrent(known.id)
          if (!torrent)
            return
          // Playback мог успеть восстановить hash после первого снимка inventory.
          const current = (await engineStorageInventory()).find(
            entry => entry.infoHash === item.infoHash,
          )
          if (!current)
            return
          item = current
          if (item.state === 'active') {
            const active = update(torrent.id, {
              downloadDir: downloadDirValue(item.dir),
              inEngine: true,
            })
            if (item.paused && !active.pauseReason) {
              const stats = await torrentStats(active.infoHash)
              await ensureSpaceFor({
                torrent: active,
                bytes: (active.selectedFiles ?? []).reduce(
                  (sum, index) =>
                    sum
                    + Math.max(
                      0,
                      (active.files?.[index]?.size ?? 0)
                      - (stats.fileProgress[index] ?? 0),
                    ),
                  0,
                ),
              })
              await resumeTorrent(active.infoHash)
            }
            return
          }
          if (!torrent.torrentFile)
            return
          // Сначала paused add, даже если pauseReason пуст: ни одного байта до
          // восстановления selection/приоритетов. Старые общие файлы не трогаем.
          const isolated = isolatedTorrentDir(item.dir, torrent.infoHash)
          const recovering = update(torrent.id, { downloadDir: isolated })
          await ensureSpaceFor({
            torrent: recovering,
            bytes: (torrent.selectedFiles ?? []).reduce(
              (sum, index) => sum + (torrent.files?.[index]?.size ?? 0),
              0,
            ),
          })
          await addToEngine(
            torrent,
            torrent.selectedFiles ?? [],
            isolated,
            undefined,
            true,
          )
          if (!torrent.pauseReason)
            await resumeTorrent(torrent.infoHash)
        }))
    }
    catch (err) {
      // Одна раздача не держит всю библиотеку/follow. Inventory остаётся
      // источником незавершённой работы; очередная проверка места повторит её.
      logFor('engine').warn(
        { err, torrentId: known.id },
        'Torrent storage recovery deferred',
      )
    }
  }
}

let storageReconciliation: Promise<void> | undefined
export function reconcileEngineStorage() {
  storageReconciliation ??= reconcileEngineStorageImpl().finally(() => {
    storageReconciliation = undefined
  })
  return storageReconciliation
}

export function touchTorrent(id: string) {
  recordActivity(id)
  getDb()
    .update(torrents)
    .set({ lastAccessAt: new Date() })
    .where(eq(torrents.id, id))
    .run()
}

/** Кадр видео из пробы: раздача показывает точное разрешение в «Источниках» */
export function rememberVideoSize(
  torrent: Torrent,
  width: number,
  height: number,
) {
  if (torrent.videoWidth === width && torrent.videoHeight === height)
    return

  update(torrent.id, { videoWidth: width, videoHeight: height })
}

/** Уже добавленные раздачи по infohash (в нижнем регистре, как в базе) */
export function torrentsByInfoHash(infoHashes: string[]) {
  if (infoHashes.length === 0)
    return new Map<string, Torrent>()

  const rows = getDb()
    .select()
    .from(torrents)
    .where(inArray(torrents.infoHash, infoHashes))
    .all()

  return new Map(rows.map(row => [row.infoHash, row]))
}

// `idle` — раздачи нет в движке (файл не начинали смотреть)
export type TorrentActivity = 'idle' | 'downloading'

export interface StreamStats {
  activity: TorrentActivity
  peers: { connected: number, found: number, seeders: number }
  downloadSpeed: number
  uploadSpeed: number
  file: {
    size: number
    downloaded: number
    bufferedAhead: number
    playbackCache?: PlaybackCache | null
  }
  badPieces: number
}

/**
 * Статистика для экрана буферизации и OSD: пиры, скорость и сколько файла
 * скачано подряд от позиции чтения. Раздачи нет в движке — `idle`.
 */
export async function streamStats(
  torrent: Torrent,
  fileIndex: number,
  position: number,
  time?: number,
): Promise<StreamStats> {
  const files = torrent.files ?? []
  const size = files[fileIndex]?.size ?? 0
  const idle: StreamStats = {
    activity: 'idle',
    peers: { connected: 0, found: 0, seeders: 0 },
    downloadSpeed: 0,
    uploadSpeed: 0,
    file: {
      size,
      downloaded: 0,
      bufferedAhead: 0,
      ...(time === undefined ? {} : { playbackCache: null }),
    },
    badPieces: 0,
  }

  let stats

  try {
    stats = await torrentStats(torrent.infoHash)
  }
  catch (err) {
    if (err instanceof EngineError && err.kind === 'not_found')
      return idle

    throw err
  }

  const bufferedAhead = torrent.pieceLength
    ? bufferedAheadBytes({
        pieces: stats.pieces,
        pieceLength: torrent.pieceLength,
        fileOffset: fileOffsetOf(files, fileIndex),
        fileSize: size,
        position,
      })
    : 0

  return {
    activity: 'downloading',
    peers: stats.peers,
    downloadSpeed: stats.downloadSpeed,
    uploadSpeed: stats.uploadSpeed,
    file: {
      size,
      downloaded: stats.fileProgress[fileIndex] ?? 0,
      bufferedAhead,
      ...(time === undefined
        ? {}
        : {
            playbackCache: torrent.pieceLength
              ? playbackCacheAt(
                  {
                    pieces: stats.pieces,
                    pieceLength: torrent.pieceLength,
                    fileOffsets: verifiedFileOffsets(
                      files,
                      fileIndex,
                      torrent.pieceLength,
                      stats.pieces.length,
                    ),
                    fileSize: size,
                  },
                  time,
                  peekMediaProbe(`${torrent.infoHash}:${fileIndex}`)
                    ?.duration ?? null,
                  peekPlaybackIndex(torrent.infoHash, fileIndex, size),
                )
              : null,
          }),
    },
    badPieces: stats.badPieces,
  }
}

export function getWatchState(
  profileId: string,
  torrentId: string,
  fileIndex: number,
) {
  return getDb()
    .select()
    .from(watchStates)
    .where(
      and(
        eq(watchStates.profileId, profileId),
        eq(watchStates.torrentId, torrentId),
        eq(watchStates.fileIndex, fileIndex),
      ),
    )
    .get()
}

export function saveWatchState(
  values: Pick<
    WatchState,
    'profileId' | 'torrentId' | 'fileIndex' | 'position' | 'duration'
  >,
  context?: DiagnosticContext,
  titleProgressSaved = false,
) {
  const updatedAt = new Date()

  const saved = getDb()
    .insert(watchStates)
    .values({ ...values, updatedAt })
    .onConflictDoUpdate({
      target: [
        watchStates.profileId,
        watchStates.torrentId,
        watchStates.fileIndex,
      ],
      set: { position: values.position, duration: values.duration, updatedAt },
    })
    .returning()
    .get()
  if (
    !titleProgressSaved
    || (context?.saveReason && context.saveReason !== 'checkpoint')
  ) {
    recordCheckpoint('progress.file_saved', context, {
      ...values,
      committedAt: updatedAt.toISOString(),
    })
  }
  return saved
}
