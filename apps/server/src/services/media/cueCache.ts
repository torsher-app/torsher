import type { Torrent } from '../../db/schema.ts'
import type { MatroskaCues } from './matroska.ts'
import { acquireMaintenanceLease } from '../libraryMaintenance/admission.ts'
import { trackStream } from '../storage/index.ts'
import { engineStreamUrl, torrentStats } from '../engine/index.ts'
import {
  verifiedBufferedAheadBytes,
  verifiedFileOffsets,
} from '../torrents/playback.ts'
import { readMatroskaCues } from './matroska.ts'

const MAX_ENTRIES = 100
const MAX_POINTS = 200_000
const MAX_PENDING = 4
const MAX_RANGE_BYTES = 8 * 1024 * 1024
const MAX_READ_BYTES = 12 * 1024 * 1024
const LOAD_TIMEOUT_MS = 30_000

interface Pending {
  controller: AbortController
  subscribers: Set<AbortSignal>
  promise: Promise<MatroskaCues | null>
}
const ready = new Map<string, MatroskaCues | null>()
const pending = new Map<string, Pending>()
let activeLoads = 0

export function cueCacheKey(infoHash: string, fileIndex: number, size: number) {
  return `${infoHash}:${fileIndex}:${size}`
}

/** No IO and no waiting: a stats poll observes only a completed preparation. */
export function peekPlaybackIndex(
  infoHash: string,
  fileIndex: number,
  size: number,
) {
  return (
    ready.get(cueCacheKey(infoHash, fileIndex, size))?.playbackIndex ?? null
  )
}

function pointCount(value: MatroskaCues | null) {
  return (value?.times.length ?? 0) + (value?.playbackIndex?.length ?? 0)
}

function remember(key: string, value: MatroskaCues | null) {
  ready.delete(key)
  if (pointCount(value) > MAX_POINTS)
    value = null
  ready.set(key, value)
  let points = [...ready.values()].reduce(
    (sum, entry) => sum + pointCount(entry),
    0,
  )
  while (ready.size > MAX_ENTRIES || points > MAX_POINTS) {
    const oldest = ready.keys().next().value!
    points -= pointCount(ready.get(oldest) ?? null)
    ready.delete(oldest)
  }
}

/** Engine Range responses are bounded even when an upstream ignores Range. */
export function cueRangeReader(url: string, size: number, signal: AbortSignal) {
  let total = 0
  return async (start: number, requestedEnd: number) => {
    const end = Math.min(size, requestedEnd)
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || start < 0
      || end <= start
      || start >= size
      || end - start > MAX_RANGE_BYTES
      || total + end - start > MAX_READ_BYTES
    ) {
      throw new Error('Cue range exceeds read budget')
    }
    total += end - start
    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end - 1}` },
      signal,
    })
    const expected = `bytes ${start}-${end - 1}/${size}`
    if (
      response.status !== 206
      || response.headers.get('content-range') !== expected
    ) {
      await response.body?.cancel()
      throw new Error('Invalid cue range response')
    }
    const reader = response.body?.getReader()
    if (!reader)
      throw new Error('Missing cue range body')
    const result = new Uint8Array(end - start)
    let length = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done)
          break
        if (length + chunk.value.length > result.length)
          throw new Error('Cue range body exceeds requested length')
        result.set(chunk.value, length)
        length += chunk.value.length
      }
      if (length !== result.length)
        throw new Error('Truncated cue range body')
      return result
    }
    finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
}

/** One preparation per immutable file, with independent lifetime from any viewer. */
export function loadTorrentCues(
  torrent: Torrent,
  fileIndex: number,
  signal: AbortSignal,
) {
  const size = torrent.files?.[fileIndex]?.size ?? 0
  const key = cueCacheKey(torrent.infoHash, fileIndex, size)
  if (signal.aborted || !Number.isSafeInteger(size) || size <= 0)
    return Promise.resolve(null)
  if (ready.has(key)) {
    const value = ready.get(key)!
    ready.delete(key)
    ready.set(key, value)
    return Promise.resolve(value)
  }
  let entry = pending.get(key)
  if (!entry) {
    if (activeLoads >= MAX_PENDING)
      return Promise.resolve(null)
    const controller = new AbortController()
    const deadline = AbortSignal.timeout(LOAD_TIMEOUT_MS)
    const releaseMaintenance = acquireMaintenanceLease({
      torrentId: torrent.id,
    })
    const releaseStream = trackStream(torrent.id)
    entry = {
      controller,
      subscribers: new Set(),
      promise: Promise.resolve(null),
    }
    const own = entry
    pending.set(key, own)
    activeLoads++
    own.promise = Promise.resolve()
      .then(async () => {
        const loadSignal = AbortSignal.any([controller.signal, deadline])
        const read = cueRangeReader(
          engineStreamUrl(torrent.infoHash, fileIndex),
          size,
          loadSignal,
        )
        let trusted = true
        const result = await readMatroskaCues(async (start, end) => {
          loadSignal.throwIfAborted()
          // Responsive torrent readers may supply bytes before their hash check.
          // Only a range already verified BEFORE this read can define a strict index
          // (or a permanent structural negative). Otherwise HLS keeps best-effort
          // times, and the next preparation retries after verification.
          let verified = false
          if (torrent.pieceLength) {
            try {
              const stats = await torrentStats(torrent.infoHash, loadSignal)
              verified
                = (verifiedBufferedAheadBytes(
                  {
                    pieces: stats.pieces,
                    pieceLength: torrent.pieceLength,
                    fileOffsets: verifiedFileOffsets(
                      torrent.files ?? [],
                      fileIndex,
                      torrent.pieceLength,
                      stats.pieces.length,
                    ),
                    fileSize: size,
                  },
                  start,
                ) ?? 0)
                >= Math.min(end, size) - start
            }
            catch {
              loadSignal.throwIfAborted()
            }
          }
          trusted &&= verified
          return read(start, end)
        }, size)
        if (trusted && !loadSignal.aborted)
          remember(key, result)
        return trusted || result === null
          ? result
          : { ...result, playbackIndex: null }
      })
      .catch(() => null)
      .finally(() => {
        if (pending.get(key) === own)
          pending.delete(key)
        activeLoads--
        releaseStream()
        releaseMaintenance()
      })
  }
  const own = entry
  own.subscribers.add(signal)
  const unsubscribe = () => {
    own.subscribers.delete(signal)
    if (!own.subscribers.size) {
      own.controller.abort()
      if (pending.get(key) === own)
        pending.delete(key)
    }
  }
  signal.addEventListener('abort', unsubscribe, { once: true })
  return own.promise.finally(() => {
    signal.removeEventListener('abort', unsubscribe)
    own.subscribers.delete(signal)
  })
}

export function clearCueCache() {
  for (const entry of pending.values()) entry.controller.abort()
  pending.clear()
  ready.clear()
}
