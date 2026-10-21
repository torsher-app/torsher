import type { Torrent, TorrentFileEntry, WatchState } from '../../db/schema.ts'
import type { EngineTorrentDetails } from '../engine/index.ts'
import { Buffer } from 'node:buffer'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { torrents, watchStates } from '../../db/schema.ts'
import {
  addTorrent,
  EngineError,
  engineUnavailableError,
  forgetTorrent,
  inspectTorrent,
  isEngineReady,
  openStream,
  resolveMagnet,
  torrentStats,
} from '../engine/index.ts'
import { parseMagnet } from './magnet.ts'
import { bufferedAheadBytes, fileOffsetOf } from './playback.ts'

export { parseMagnet } from './magnet.ts'
export { contentTypeOf, fileNameOf, isVideoFile } from './media.ts'

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

export function listTorrents() {
  return getDb().select().from(torrents).orderBy(desc(torrents.addedAt)).all()
}

export function getTorrent(id: string) {
  return getDb().select().from(torrents).where(eq(torrents.id, id)).get()
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

    update(id, {
      ...readyFields(bytes, details),
      name: details.name || torrent.name,
    })
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
    return {
      torrent: update(existing.id, { ...readyFields(bytes, details), name }),
      created: false,
    }
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

  return { torrent, created: true }
}

/** Убирает раздачу из списка и из движка; скачанные файлы остаются на диске */
export async function deleteTorrent(torrent: Torrent) {
  if (torrent.inEngine) {
    try {
      await forgetTorrent(torrent.infoHash)
    }
    catch (err) {
      if (!(err instanceof EngineError) || err.kind !== 'not_found')
        throw err
    }
  }

  getDb().delete(torrents).where(eq(torrents.id, torrent.id)).run()
}

export function playableFile(torrent: Torrent, fileIndex: number) {
  const file = torrent.files?.[fileIndex]

  return file && !file.padding ? file : undefined
}

/**
 * Готовит файл к просмотру: добавляет раздачу в движок (или находит её там)
 * и выбирает только этот файл — пак сезона не скачивается целиком из-за одной серии.
 */
export async function prepareStream(torrent: Torrent, fileIndex: number) {
  if (!torrent.torrentFile)
    throw new EngineError('rejected', 'Torrent metadata is not ready')

  await addTorrent(torrent.torrentFile, [fileIndex])

  return update(torrent.id, { inEngine: true, lastAccessAt: new Date() })
}

/**
 * Открывает поток файла в движке. Раздачу, которую движок забыл (новый
 * каталог данных, сброс состояния), добавляет заново.
 */
export async function openFileStream(
  torrent: Torrent,
  fileIndex: number,
  range: string | undefined,
  signal: AbortSignal,
) {
  try {
    return await openStream(torrent.infoHash, fileIndex, range, signal)
  }
  catch (err) {
    if (!(err instanceof EngineError) || err.kind !== 'not_found')
      throw err

    await prepareStream(torrent, fileIndex)

    return openStream(torrent.infoHash, fileIndex, range, signal)
  }
}

export function touchTorrent(id: string) {
  getDb()
    .update(torrents)
    .set({ lastAccessAt: new Date() })
    .where(eq(torrents.id, id))
    .run()
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

export function getWatchState(torrentId: string, fileIndex: number) {
  return getDb()
    .select()
    .from(watchStates)
    .where(
      and(
        eq(watchStates.torrentId, torrentId),
        eq(watchStates.fileIndex, fileIndex),
      ),
    )
    .get()
}

export function saveWatchState(
  values: Pick<WatchState, 'torrentId' | 'fileIndex' | 'position' | 'duration'>,
) {
  const updatedAt = new Date()

  return getDb()
    .insert(watchStates)
    .values({ ...values, updatedAt })
    .onConflictDoUpdate({
      target: [watchStates.torrentId, watchStates.fileIndex],
      set: { position: values.position, duration: values.duration, updatedAt },
    })
    .returning()
    .get()
}
