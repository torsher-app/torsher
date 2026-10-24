import type { Torrent, TorrentFileEntry, WatchState } from '../../db/schema.ts'
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
import { enforceStorage, ensureSpaceFor } from '../storage/index.ts'
import { isMovingTorrent } from '../storage/moving.ts'
import { downloadDirValue, storagePath, torrentDir } from '../storage/paths.ts'
import { parseMagnet } from './magnet.ts'
import { isVideoFile } from './media.ts'
import { bufferedAheadBytes, fileOffsetOf } from './playback.ts'

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

async function runResolve(id: string) {
  const torrent = getTorrent(id)

  if (!torrent?.magnet || torrent.status !== 'resolving')
    return

  try {
    const bytes = await resolveMagnet(
      torrent.magnet,
      MAGNET_RESOLVE_TIMEOUT_MS,
    )
    const details = await inspectTorrent(bytes)

    if (details.infoHash.toLowerCase() !== torrent.infoHash) {
      update(id, { status: 'failed', error: 'rejected' })
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

    update(id, {
      status: 'failed',
      error:
        err.kind === 'timeout' || err.kind === 'rejected' ? err.kind : 'failed',
    })
  }
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
export async function addMagnet(input: string): Promise<AddResult> {
  const magnet = parseMagnet(input)

  if (!magnet)
    throw new InvalidMagnetError()

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
export async function addTorrentFile(bytes: Uint8Array): Promise<AddResult> {
  const details = await inspectTorrent(bytes)
  const infoHash = details.infoHash.toLowerCase()
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
export async function deleteTorrent(
  torrent: Torrent,
  options: { deleteFiles?: boolean } = {},
) {
  if (torrent.inEngine) {
    try {
      await forgetTorrent(torrent.infoHash, options)
    }
    catch (err) {
      if (!(err instanceof EngineError) || err.kind !== 'not_found')
        throw err
    }
  }

  getDb().delete(torrents).where(eq(torrents.id, torrent.id)).run()
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
  return torrent.titleId === titleId
    ? torrent
    : update(torrent.id, { titleId })
}

/**
 * Добавляет раздачу в движок в её каталоге. Раздача, которой в движке нет,
 * на диске ничего не хранит и получает действующий каталог загрузок: так
 * выбранная в панели папка действует с первой новой закачки.
 */
async function addToEngine(torrent: Torrent, files: number[]) {
  if (!torrent.torrentFile)
    throw new NotReadyError()

  if (isMovingTorrent(torrent.id))
    throw new EngineError('moving', 'Torrent is being moved')

  if (!torrent.inEngine) {
    const downloadDir = downloadDirValue(storagePath('downloads'))

    if (downloadDir !== torrent.downloadDir) {
      update(torrent.id, { downloadDir })
      torrent = { ...torrent, downloadDir }
    }
  }

  await addTorrent(
    torrent.torrentFile!,
    files,
    torrent.downloadDir ? torrentDir(torrent) : undefined,
  )
}

/**
 * Скачать выбранные файлы целиком сейчас. Скачанное руками закрепляется
 * («Оставить»): само оно не удалится. Места мало — сервер сразу ставит
 * загрузку на паузу, и раздача попадает в «Требуют внимания».
 */
export async function downloadFiles(torrent: Torrent, chosen: number[]) {
  if (!torrent.torrentFile)
    throw new NotReadyError()

  const files = withSubtitles(torrent, chosen)

  await addToEngine(torrent, files)

  if (torrent.pauseReason)
    await resumeTorrent(torrent.infoHash)

  update(torrent.id, {
    inEngine: true,
    selectedFiles: files,
    retention: 'keep',
    pauseReason: null,
  })

  await enforceStorage()

  return getTorrent(torrent.id) ?? torrent
}

export async function pauseDownload(torrent: Torrent) {
  if (!torrent.inEngine)
    throw new NotInEngineError()

  await pauseTorrent(torrent.infoHash)

  return update(torrent.id, { pauseReason: 'user' })
}

/** Снимает любую паузу; если места всё ещё мало, сервер поставит свою снова */
export async function resumeDownload(torrent: Torrent) {
  if (!torrent.inEngine)
    throw new NotInEngineError()

  await resumeTorrent(torrent.infoHash)
  update(torrent.id, { pauseReason: null })
  await enforceStorage()

  return getTorrent(torrent.id) ?? torrent
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
export async function setRetention(
  torrent: Torrent,
  retention: Torrent['retention'],
) {
  if (!isEngineReady())
    return update(torrent.id, { retention })

  const selected
    = retention === 'keep'
      ? withSubtitles(
          torrent,
          withFiles(torrent.selectedFiles, await startedVideos(torrent)),
        )
      : []

  if (torrent.inEngine)
    await ignoreMissing(selectFiles(torrent.infoHash, selected))

  const updated = update(torrent.id, {
    retention,
    selectedFiles: selected.length ? selected : null,
  })

  await enforceStorage()

  return getTorrent(torrent.id) ?? updated
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

    update(row.id, { selectedFiles: null })
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
export async function prepareStream(torrent: Torrent, fileIndex: number) {
  if (!torrent.torrentFile)
    throw new EngineError('rejected', 'Torrent metadata is not ready')

  const size = torrent.files?.[fileIndex]?.size ?? 0
  const downloaded = await downloadedOf(torrent, fileIndex)

  await ensureSpaceFor({ torrent, bytes: Math.max(0, size - downloaded) })

  const selected = streamSelection(torrent, fileIndex)

  await addToEngine(torrent, selected)

  if (torrent.pauseReason)
    await resumeTorrent(torrent.infoHash)

  return update(torrent.id, {
    inEngine: true,
    selectedFiles: selected.length ? selected : null,
    pauseReason: null,
    lastAccessAt: new Date(),
  })
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
    await addToEngine(torrent, streamSelection(torrent, fileIndex))
    update(torrent.id, { inEngine: true })

    return openStream(torrent.infoHash, fileIndex, range, signal, window)
  }
}

export function touchTorrent(id: string) {
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
  peers: { connected: number, found: number }
  downloadSpeed: number
  uploadSpeed: number
  file: { size: number, downloaded: number, bufferedAhead: number }
}

/**
 * Статистика для экрана буферизации и OSD: пиры, скорость и сколько файла
 * скачано подряд от позиции чтения. Раздачи нет в движке — `idle`.
 */
export async function streamStats(
  torrent: Torrent,
  fileIndex: number,
  position: number,
): Promise<StreamStats> {
  const files = torrent.files ?? []
  const size = files[fileIndex]?.size ?? 0
  const idle: StreamStats = {
    activity: 'idle',
    peers: { connected: 0, found: 0 },
    downloadSpeed: 0,
    uploadSpeed: 0,
    file: { size, downloaded: 0, bufferedAhead: 0 },
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
    },
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
) {
  const updatedAt = new Date()

  return getDb()
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
}
