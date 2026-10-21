import type { FastifyReply } from 'fastify'
import type { Torrent } from '../db/schema.ts'
import { EngineError } from '../services/engine/index.ts'
import { isVideoFile } from '../services/torrents/index.ts'

/**
 * Ошибка движка → статус: недоступен — 503 с видом причины для текста клиента,
 * отклонил запрос — 400, не дождались — 504, ответил ошибкой — 502.
 */
export function sendEngineError(reply: FastifyReply, err: unknown) {
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
    default:
      return reply.code(502).send({ message: err.message })
  }
}

// Наружу — явно собранный объект: `.torrent` и magnet в ответ не попадают
export function toTorrentResponse(torrent: Torrent) {
  const files = (torrent.files ?? [])
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => !file.padding)

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
    })),
    totalSize: files.reduce((sum, { file }) => sum + file.size, 0),
    addedAt: torrent.addedAt.toISOString(),
    lastAccessAt: torrent.lastAccessAt?.toISOString() ?? null,
  }
}
