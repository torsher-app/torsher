import type { FastifyReply } from 'fastify'
import type { Torrent } from '../db/schema.ts'
import type { EngineTorrentState } from '../services/engine/index.ts'
import { EngineError } from '../services/engine/index.ts'
import { isStreaming } from '../services/storage/index.ts'
import {
  downloadStateOf,
  InsufficientStorageError,
  isVideoFile,
} from '../services/torrents/index.ts'

/**
 * Ошибка движка → статус: недоступен — 503 с видом причины для текста клиента,
 * отклонил запрос — 400, не дождались — 504, раздача переезжает в другую
 * папку — 409, ответил ошибкой — 502.
 */
export function sendEngineError(reply: FastifyReply, err: unknown) {
  if (err instanceof InsufficientStorageError) {
    return reply.code(507).send({ message: err.message, ...err.shortage })
  }

  if (!(err instanceof EngineError))
    throw err

  switch (err.kind) {
    case 'unavailable':
      return reply.code(503).send({
        message: err.message,
        kind: err.unavailable ?? 'starting',
      })
    case 'rejected':
      return reply.code(400).send({ message: err.message })
    case 'timeout':
      return reply.code(504).send({ message: err.message })
    case 'moving':
      return reply.code(409).send({ message: err.message })
    default:
      return reply.code(502).send({ message: err.message })
  }
}

// Наружу — явно собранный объект: `.torrent` и magnet в ответ не попадают.
// `live` — раздача в движке; нет — данных на диске нет. `placed` — индексы
// файлов, которые лежат в библиотеке
export function toTorrentResponse(
  torrent: Torrent,
  live?: EngineTorrentState,
  placed: Set<number> = new Set(),
) {
  const files = (torrent.files ?? [])
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => !file.padding)
  const selected = new Set(live?.selected ?? torrent.selectedFiles ?? [])
  const streaming = isStreaming(torrent.id)
  const waiting = files.some(
    ({ file, index }) =>
      selected.has(index) && isVideoFile(file.path) && !placed.has(index),
  )

  return {
    id: torrent.id,
    infoHash: torrent.infoHash,
    name: torrent.name,
    source: torrent.source,
    status: torrent.status,
    error: torrent.error,
    files: files.map(({ file, index }) => ({
      index,
      path: file.path,
      size: file.size,
      isVideo: isVideoFile(file.path),
      downloaded: live?.fileProgress[index] ?? 0,
      selected: selected.has(index),
      inLibrary: placed.has(index),
    })),
    totalSize: files.reduce((sum, { file }) => sum + file.size, 0),
    addedAt: torrent.addedAt.toISOString(),
    lastAccessAt: torrent.lastAccessAt?.toISOString() ?? null,
    titleId: torrent.titleId,
    matchStatus: torrent.matchStatus,
    matchSuggestion: torrent.matchSuggestion,
    retention: torrent.retention,
    inLibrary: placed.size > 0 && !waiting,
    pauseReason: live?.paused ? (torrent.pauseReason ?? 'user') : null,
    state: downloadStateOf(live, streaming),
    streaming,
    progress: {
      downloaded: live?.wantedCompleted ?? 0,
      wanted: live?.bytesWanted ?? 0,
    },
    sizeOnDisk: live?.bytesCompleted ?? 0,
    downloadSpeed: live?.downloadSpeed ?? 0,
    uploadSpeed: live?.uploadSpeed ?? 0,
    peers: live?.peers ?? { connected: 0, found: 0 },
  }
}
