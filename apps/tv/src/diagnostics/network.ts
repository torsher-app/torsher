import type {
  DiagnosticMediaSnapshot,
  DiagnosticPlaybackNetwork,
  TorrentStats,
} from '@torsher/api-client'
import { STATS_STALE_MS } from '../lib/player.ts'

function number(value: unknown, max: number, integer = false) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= max
    && (!integer || Number.isInteger(value))
    ? value
    : undefined
}

/** Actual client ranges only; native diagnostic capability remains unsupported. */
function clientBuffer(
  media: DiagnosticMediaSnapshot,
): DiagnosticPlaybackNetwork['clientBuffer'] {
  if (media.source === 'native' || media.state === 'unsupported')
    return { state: 'unsupported' }
  if (
    media.state !== 'available'
    || media.position === undefined
    || !media.buffered
  ) {
    return { state: 'unknown' }
  }
  let ahead = 0
  for (const range of media.buffered) {
    if (range.start <= media.position && range.end >= media.position)
      ahead = Math.max(ahead, range.end - media.position)
  }
  return { state: 'available', aheadSeconds: number(ahead, 31_536_000) }
}

/** One synchronous observation of the player's last HTTP stats response, never authoritative engine facts. */
export function networkSnapshot(input: {
  media: DiagnosticMediaSnapshot
  stats?: TorrentStats
  receivedAt: number
  offset?: number
  failed: boolean
  now: number
  library: boolean
  torrentId?: string
  fileIndex?: number
  size?: number
  duration: number
}): DiagnosticPlaybackNetwork {
  const result: DiagnosticPlaybackNetwork = {
    stats: {
      state: input.library
        ? 'not_applicable'
        : input.failed
          ? 'error'
          : 'unavailable',
    },
    clientBuffer: clientBuffer(input.media),
  }
  if (input.library)
    return result
  result.torrentId = input.torrentId
  result.fileIndex = number(input.fileIndex, 1_000_000, true)
  const age
    = input.receivedAt > 0
      ? number(input.now - input.receivedAt, 31_536_000_000)
      : undefined
  if (!input.stats || age === undefined)
    return result
  const stats = input.stats
  const bytes = number(stats.file.bufferedAhead, Number.MAX_SAFE_INTEGER, true)
  const offset = number(input.offset, Number.MAX_SAFE_INTEGER, true)
  result.stats = {
    state: input.failed ? 'error' : age > STATS_STALE_MS ? 'stale' : 'fresh',
    ageMs: age,
    offsetBytes: bytes === undefined ? undefined : offset,
    downloadBytesPerSecond: number(stats.downloadSpeed, 1_000_000_000_000),
    peersConnected: number(stats.peers.connected, 1_000_000, true),
    seedersConnected: number(stats.peers.seeders, 1_000_000, true),
    peersFound: number(stats.peers.found, 1_000_000, true),
    bufferedAheadBytes: offset === undefined ? undefined : bytes,
  }
  return result
}
