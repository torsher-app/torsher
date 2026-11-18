import type { Torrent } from '../../db/schema.ts'
import type { MatroskaCues, RangeReader } from './matroska.ts'
import { open, stat } from 'node:fs/promises'
import { libraryProbeKey } from '../library/playedSource.ts'
import { acquireMaintenanceLease } from '../libraryMaintenance/admission.ts'
import { trackStream } from '../storage/index.ts'
import { engineStreamUrl, torrentStats } from '../engine/index.ts'
import {
  verifiedBufferedAheadBytes,
  verifiedFileOffsets,
} from '../torrents/playback.ts'
import { readMatroskaCues } from './matroska.ts'
import { probePacketEnds } from './probe.ts'

const MAX_ENTRIES = 100
const MAX_POINTS = 200_000
const MAX_PENDING = 4
const MAX_RANGE_BYTES = 8 * 1024 * 1024
const MAX_READ_BYTES = 12 * 1024 * 1024
const LOAD_TIMEOUT_MS = 30_000

interface Pending {
  controller: AbortController
  subscribers: Map<AbortSignal, boolean>
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

export function peekPacketEnds(
  infoHash: string,
  fileIndex: number,
  size: number,
) {
  return ready.get(cueCacheKey(infoHash, fileIndex, size))?.packetEnds
}

function pointCount(value: MatroskaCues | null) {
  return (
    (value?.times.length ?? 0)
    + (value?.playbackIndex?.length ?? 0)
    + (value?.packetEnds?.size ?? 0)
  )
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

function boundedCueReader(
  size: number,
  signal: AbortSignal,
  read: RangeReader,
) {
  let total = 0
  return async (start: number, requestedEnd: number) => {
    signal.throwIfAborted()
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
    return read(start, end)
  }
}

/** Engine Range responses are bounded even when an upstream ignores Range. */
export function cueRangeReader(url: string, size: number, signal: AbortSignal) {
  return boundedCueReader(size, signal, async (start, end) => {
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
  })
}

type CueResult = MatroskaCues | null
type ReadEndpoints = () => Promise<CueResult>
type Finish = (
  index: CueResult,
  readEndpoints: ReadEndpoints | undefined,
  publish: (result: CueResult) => CueResult,
) => CueResult | Promise<CueResult>

/** One preparation per immutable file, with independent lifetime from any viewer. */
function loadCues(
  key: string,
  size: number,
  signal: AbortSignal,
  measureEndpoints: boolean,
  prepare: (signal: AbortSignal, finish: Finish) => Promise<CueResult>,
): Promise<MatroskaCues | null> {
  if (signal.aborted || !Number.isSafeInteger(size) || size <= 0)
    return Promise.resolve(null)
  const cached = ready.get(key)
  if (cached !== undefined && (!measureEndpoints || cached?.packetEnds)) {
    ready.delete(key)
    ready.set(key, cached)
    return Promise.resolve(cached)
  }
  let entry = pending.get(key)
  if (!entry) {
    if (activeLoads >= MAX_PENDING)
      return Promise.resolve(null)
    const controller = new AbortController()
    const deadline = AbortSignal.timeout(LOAD_TIMEOUT_MS)
    entry = {
      controller,
      subscribers: new Map(),
      promise: Promise.resolve(null),
    }
    const own = entry
    pending.set(key, own)
    activeLoads++
    const remove = () => {
      if (pending.get(key) === own)
        pending.delete(key)
    }
    const loadSignal = AbortSignal.any([controller.signal, deadline])
    const finish: Finish = (index, readEndpoints, publish) => {
      const seal = (result: CueResult) => {
        loadSignal.throwIfAborted()
        // Publish and remove the pending entry together. An index-only result
        // must never leave behind an observable load that can no longer upgrade.
        const published = publish(result)
        remove()
        return published
      }
      if (readEndpoints && [...own.subscribers.values()].includes(true))
        return readEndpoints().then(seal)
      return seal(index)
    }
    own.promise = Promise.resolve()
      .then(() => prepare(loadSignal, finish))
      .catch(() => null)
      .finally(() => {
        remove()
        activeLoads--
      })
  }
  const own = entry
  own.subscribers.set(
    signal,
    measureEndpoints || own.subscribers.get(signal) === true,
  )
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

export function loadTorrentCues(
  torrent: Torrent,
  fileIndex: number,
  signal: AbortSignal,
  measureEndpoints = false,
) {
  const size = torrent.files?.[fileIndex]?.size ?? 0
  const key = cueCacheKey(torrent.infoHash, fileIndex, size)
  return loadCues(
    key,
    size,
    signal,
    measureEndpoints,
    async (loadSignal, finish) => {
      const releaseMaintenance = acquireMaintenanceLease({
        torrentId: torrent.id,
      })
      const releaseStream = trackStream(torrent.id)
      try {
        const read = cueRangeReader(
          engineStreamUrl(torrent.infoHash, fileIndex),
          size,
          loadSignal,
        )
        let trusted = true
        let readEndpoints: ReadEndpoints | undefined
        const result = await readMatroskaCues(
          async (start, end) => {
            loadSignal.throwIfAborted()
            // Responsive readers can expose bytes before hashing. Verification must
            // precede the read to use them for strict bounds or measured endpoints.
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
          },
          size,
          {
            maxBytes: MAX_RANGE_BYTES,
            measure: async fragment =>
              trusted ? probePacketEnds(fragment, loadSignal) : null,
            defer: (read) => {
              readEndpoints = read
            },
          },
        )
        const indexTrusted = trusted
        return await finish(result, readEndpoints, (cues) => {
          // An unverified tail cannot supply endpoints. The verified index
          // from before that optional read remains usable independently.
          if (indexTrusted && (cues !== null || !ready.has(key)))
            remember(key, cues)
          return indexTrusted || cues === null
            ? cues
            : { times: cues.times, playbackIndex: null }
        })
      }
      finally {
        releaseStream()
        releaseMaintenance()
      }
    },
  )
}

export async function loadLibraryCues(
  source: { id: string, path: string, size: number },
  key: string,
  signal: AbortSignal,
  measureEndpoints: boolean,
) {
  const { id, path, size } = source
  if (signal.aborted)
    return null
  const current = await stat(path).catch(() => null)
  if (!current || libraryProbeKey(id, current) !== key)
    return null
  return loadCues(
    key,
    size,
    signal,
    measureEndpoints,
    async (loadSignal, finish) => {
      const file = await open(path, 'r')
      try {
        const identity = async () => libraryProbeKey(id, await file.stat())
        const unchanged = async () =>
          (await identity()) === key
          && libraryProbeKey(id, await stat(path)) === key
        if ((await identity()) !== key)
          return null
        let readEndpoints: ReadEndpoints | undefined
        const result = await readMatroskaCues(
          boundedCueReader(size, loadSignal, async (start, end) => {
            const buffer = new Uint8Array(end - start)
            let offset = 0
            while (offset < buffer.length) {
              const { bytesRead } = await file.read(
                buffer,
                offset,
                buffer.length - offset,
                start + offset,
              )
              if (bytesRead === 0)
                throw new Error('Truncated cue range')
              offset += bytesRead
              loadSignal.throwIfAborted()
            }
            return buffer
          }),
          size,
          {
            maxBytes: MAX_RANGE_BYTES,
            measure: fragment => probePacketEnds(fragment, loadSignal),
            defer: (read) => {
              readEndpoints = async () => {
                const cues = await read()
                if (!(await unchanged()))
                  throw new Error('Library source changed while reading cues')
                return cues
              }
            },
          },
        )
        if (!(await unchanged()))
          return null
        return await finish(result, readEndpoints, (cues) => {
          remember(key, cues)
          return cues
        })
      }
      finally {
        await file.close()
      }
    },
  )
}

export function clearCueCache() {
  for (const entry of pending.values()) entry.controller.abort()
  pending.clear()
  ready.clear()
}
