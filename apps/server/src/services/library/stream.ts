import type { FastifyReply, FastifyRequest } from 'fastify'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { acquireMaintenanceLease } from '../libraryMaintenance/admission.ts'
import { recordMediaActivity } from '../libraryMaintenance/provenance.ts'
import { trackPlayback } from '../segments/activity.ts'
import { contentTypeOf } from '../torrents/index.ts'
import { playableMediaFile } from './folders.ts'

/** `bytes=start-end` → границы; `undefined` — заголовка нет, `null` — вне файла */
export function parseRange(header: string | undefined, size: number) {
  if (!header)
    return undefined

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())

  if (!match || (!match[1] && !match[2]))
    return null

  let start: number
  let end: number

  if (!match[1]) {
    // `bytes=-500` — последние 500 байт
    start = Math.max(0, size - Number(match[2]))
    end = size - 1
  }
  else {
    start = Number(match[1])
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  }

  return start <= end && start < size ? { start, end } : null
}

/** Native and compatibility streams share visibility, stat, MIME and Range semantics. */
export async function sendLibraryFile(
  request: FastifyRequest,
  reply: FastifyReply,
  id: string,
  profileId: string,
) {
  reply.raw.once('close', acquireMaintenanceLease({ mediaFileId: id }))
  const found = playableMediaFile(id, profileId)
  const info
    = found
      && found.folder.status === 'ok'
      && (await stat(found.path).catch(() => undefined))
  if (!found || !info || !info.isFile())
    return reply.code(404).send({ message: 'File not found' })
  reply.raw.once('close', trackPlayback())
  const size = info.size
  const range = parseRange(request.headers.range, size)
  if (range === null) {
    return reply
      .code(416)
      .header('Content-Range', `bytes */${size}`)
      .send({ message: 'Range not satisfiable' })
  }
  recordMediaActivity(found.file.id)
  reply
    .header('Accept-Ranges', 'bytes')
    .header('Content-Type', contentTypeOf(found.file.relPath))
    .header('Cache-Control', 'no-store')
  if (range) {
    reply
      .code(206)
      .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  }
  reply.header('Content-Length', range ? range.end - range.start + 1 : size)
  return request.method === 'HEAD'
    ? reply.send(Readable.from([]))
    : reply.send(createReadStream(found.path, range ?? undefined))
}
