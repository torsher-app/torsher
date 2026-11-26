import type { Torrent } from '../../db/schema.ts'
import type { MatroskaCues, RangeReader } from './matroska.ts'
import { Buffer } from 'node:buffer'
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
import { probePacketEnds, probeVideoStart } from './probe.ts'

const MAX_ENTRIES = 100
const MAX_POINTS = 200_000
const MAX_PENDING = 4
const MAX_RANGE_BYTES = 8 * 1024 * 1024
const MAX_READ_BYTES = 12 * 1024 * 1024
const LOAD_TIMEOUT_MS = 30_000

interface Pending {
  controller: AbortController
  subscribers: Map<AbortSignal, { ends: boolean, video?: number }>
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
    + (value?.videoStart ? 1 : 0)
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
type ReadVideoStart = (stream: number) => Promise<number | undefined>
type Finish = (
  index: CueResult,
  readEndpoints: ReadEndpoints | undefined,
  publish: (result: CueResult) => CueResult,
  readVideoStart: ReadVideoStart,
) => CueResult | Promise<CueResult>

/** Reuse the index prefix and extend it contiguously within the same read budget. */
function videoStartReader(
  size: number,
  signal: AbortSignal,
  read: RangeReader,
  prefix: () => Uint8Array | undefined,
  verified?: (start: number, end: number) => Promise<boolean>,
): ReadVideoStart {
  return async (stream) => {
    let bytes = prefix()
    if (!bytes) {
      const end = Math.min(size, 32 * 1024)
      if (verified && !(await verified(0, end)))
        return undefined
      bytes = await read(0, end)
    }
    const limit = Math.min(size, MAX_RANGE_BYTES)
    for (;;) {
      signal.throwIfAborted()
      const time = await probeVideoStart(bytes, stream, signal)
      if (time !== undefined || bytes.length >= limit)
        return time
      const end = Math.min(limit, bytes.length * 2)
      if (verified && !(await verified(bytes.length, end)))
        return undefined
      bytes = Buffer.concat([bytes, await read(bytes.length, end)])
    }
  }
}

/** One preparation per immutable file, with independent lifetime from any viewer. */
function loadCues(
  key: string,
  size: number,
  signal: AbortSignal,
  measureEndpoints: boolean,
  videoStream: number | undefined,
  prepare: (signal: AbortSignal, finish: Finish) => Promise<CueResult>,
): Promise<MatroskaCues | null> {
  if (signal.aborted || !Number.isSafeInteger(size) || size <= 0)
    return Promise.resolve(null)
  const cached = ready.get(key)
  if (
    cached !== undefined
    && (!measureEndpoints || cached?.packetEnds)
    && (videoStream === undefined || cached?.videoStart?.stream === videoStream)
  ) {
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
    const finish: Finish = (index, readEndpoints, publish, readVideoStart) => {
      const seal = (result: CueResult) => {
        loadSignal.throwIfAborted()
        // Publish and remove the pending entry together. An index-only result
        // must never leave behind an observable load that can no longer upgrade.
        const published = publish(result && { ...cached, ...result })
        remove()
        return published
      }
      const requests = () => [...own.subscribers.values()]
      const needsEnds = () =>
        readEndpoints && requests().some(request => request.ends)
      const videoToMeasure = () =>
        requests().find(request => request.video !== undefined)?.video
      if (needsEnds() || videoToMeasure() !== undefined) {
        return (async () => {
          const endsFirst = needsEnds()
          let result = endsFirst ? await readEndpoints!() : index
          const stream = videoToMeasure()
          if (stream !== undefined) {
            const time
              = cached?.videoStart?.stream === stream
                ? cached.videoStart.time
                : await readVideoStart(stream).catch(() => undefined)
            // Endpoint viewers can still join while the prefix is being measured.
            if (!endsFirst && needsEnds())
              result = await readEndpoints!()
            if (time !== undefined) {
              result = {
                ...(result ?? { times: [], playbackIndex: null }),
                videoStart: { stream, time },
              }
            }
          }
          return seal(result)
        })()
      }
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
  const previous = own.subscribers.get(signal)
  own.subscribers.set(signal, {
    ends: measureEndpoints || previous?.ends === true,
    video: videoStream ?? previous?.video,
  })
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
  videoStream?: number,
) {
  const size = torrent.files?.[fileIndex]?.size ?? 0
  const key = cueCacheKey(torrent.infoHash, fileIndex, size)
  return loadCues(
    key,
    size,
    signal,
    measureEndpoints,
    videoStream,
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
        let prefix: Uint8Array | undefined
        let readEndpoints: ReadEndpoints | undefined
        const verified = async (start: number, end: number) => {
          loadSignal.throwIfAborted()
          if (!torrent.pieceLength)
            return false
          try {
            const stats = await torrentStats(torrent.infoHash, loadSignal)
            return (
              (verifiedBufferedAheadBytes(
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
            )
          }
          catch {
            loadSignal.throwIfAborted()
            return false
          }
        }
        const result = await readMatroskaCues(
          async (start, end) => {
            // Responsive readers can expose bytes before hashing. Verification must
            // precede the read to use them for strict bounds or measured endpoints.
            const trustedRange = await verified(start, end)
            trusted &&= trustedRange
            const bytes = await read(start, end)
            if (start === 0 && trustedRange)
              prefix = bytes
            return bytes
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
        return await finish(
          result,
          readEndpoints,
          (cues) => {
            // An unverified tail cannot supply endpoints. The verified index
            // from before that optional read remains usable independently.
            if (indexTrusted && (cues !== null || !ready.has(key)))
              remember(key, cues)
            return indexTrusted || cues === null
              ? cues
              : {
                  times: cues.times,
                  playbackIndex: null,
                  ...(cues.videoStart ? { videoStart: cues.videoStart } : {}),
                }
          },
          videoStartReader(size, loadSignal, read, () => prefix, verified),
        )
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
  videoStream?: number,
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
    videoStream,
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
        let prefix: Uint8Array | undefined
        const read = boundedCueReader(size, loadSignal, async (start, end) => {
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
          if (start === 0)
            prefix = buffer
          return buffer
        })
        const result = await readMatroskaCues(read, size, {
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
        })
        if (!(await unchanged()))
          return null
        return await finish(
          result,
          readEndpoints,
          (cues) => {
            remember(key, cues)
            return cues
          },
          async (stream) => {
            const time = await videoStartReader(
              size,
              loadSignal,
              read,
              () => prefix,
            )(stream)
            if (!(await unchanged()))
              return undefined
            return time
          },
        )
      }
      finally {
        await file.close()
      }
    },
  )
}

/** Session-scoped immutable remote input. All reads use the guarded Range transport. */
export function loadAddonCues(
  key: string,
  size: number,
  readSource: (
    start: number,
    end: number,
    signal: AbortSignal,
  ) => Promise<Uint8Array>,
  signal: AbortSignal,
  measureEndpoints: boolean,
  videoStream?: number,
) {
  return loadCues(
    key,
    size,
    signal,
    measureEndpoints,
    videoStream,
    async (loadSignal, finish) => {
      let readEndpoints: ReadEndpoints | undefined
      let prefix: Uint8Array | undefined
      const read = boundedCueReader(size, loadSignal, async (start, end) => {
        const bytes = await readSource(start, end, loadSignal)
        if (start === 0)
          prefix = bytes
        return bytes
      })
      const result = await readMatroskaCues(read, size, {
        maxBytes: MAX_RANGE_BYTES,
        measure: fragment => probePacketEnds(fragment, loadSignal),
        defer: (read) => {
          readEndpoints = read
        },
      })
      return await finish(
        result,
        readEndpoints,
        (cues) => {
          remember(key, cues)
          return cues
        },
        videoStartReader(size, loadSignal, read, () => prefix),
      )
    },
  )
}

export function clearCueCache() {
  for (const entry of pending.values()) entry.controller.abort()
  pending.clear()
  ready.clear()
}
