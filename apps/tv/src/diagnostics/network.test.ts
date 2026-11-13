import type {
  DiagnosticMediaSnapshot,
  TorrentStats,
} from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { networkSnapshot } from './network.ts'

const media: DiagnosticMediaSnapshot = {
  state: 'available',
  source: 'html_video',
  position: 100,
  buffered: [
    { start: 90, end: 107 },
    { start: 120, end: 180 },
  ],
}
const stats: TorrentStats = {
  activity: 'downloading',
  peers: { connected: 8, seeders: 3, found: 40 },
  downloadSpeed: 4_000_000,
  uploadSpeed: 0,
  badPieces: 0,
  file: {
    size: 1_000_000_000,
    downloaded: 800_000_000,
    bufferedAhead: 60_000_000,
  },
}
const input = {
  media,
  stats,
  receivedAt: 100_000,
  now: 101_000,
  offset: 100_000_000,
  failed: false,
  library: false,
  torrentId: 'torrent-0001',
  fileIndex: 2,
  size: 1_000_000_000,
  duration: 1000,
}

describe('playback network observation', () => {
  it('keeps server download rate, connected seeders, engine estimate and actual client buffer separate', () => {
    expect(networkSnapshot(input)).toEqual({
      torrentId: 'torrent-0001',
      fileIndex: 2,
      stats: {
        state: 'fresh',
        ageMs: 1000,
        offsetBytes: 100_000_000,
        downloadBytesPerSecond: 4_000_000,
        peersConnected: 8,
        seedersConnected: 3,
        peersFound: 40,
        bufferedAheadBytes: 60_000_000,
        estimatedBufferedAheadSeconds: 60,
      },
      clientBuffer: { state: 'available', aheadSeconds: 7 },
    })
  })
  it('marks stale and failed responses without advancing their sample or substituting zero', () => {
    expect(networkSnapshot({ ...input, now: 116_000 }).stats).toMatchObject({
      state: 'stale',
      ageMs: 16_000,
      downloadBytesPerSecond: 4_000_000,
    })
    expect(networkSnapshot({ ...input, failed: true }).stats).toMatchObject({
      state: 'error',
      ageMs: 1000,
      bufferedAheadBytes: 60_000_000,
    })
    expect(networkSnapshot({ ...input, stats: undefined }).stats).toEqual({
      state: 'unavailable',
    })
    expect(
      networkSnapshot({ ...input, receivedAt: 0, failed: true }).stats,
    ).toEqual({ state: 'error' })
    expect(networkSnapshot({ ...input, receivedAt: 102_000 }).stats).toEqual({
      state: 'unavailable',
    })
  })
  it('preserves real zeros but omits estimates without a known positive duration/size', () => {
    const zero = {
      ...stats,
      downloadSpeed: 0,
      peers: { connected: 0, seeders: 0, found: 0 },
      file: { ...stats.file, bufferedAhead: 0 },
    }
    expect(networkSnapshot({ ...input, stats: zero }).stats).toMatchObject({
      state: 'fresh',
      downloadBytesPerSecond: 0,
      seedersConnected: 0,
      peersConnected: 0,
      peersFound: 0,
      bufferedAheadBytes: 0,
      estimatedBufferedAheadSeconds: 0,
    })
    expect(
      networkSnapshot({ ...input, duration: 0 }).stats
        .estimatedBufferedAheadSeconds,
    ).toBeUndefined()
    expect(
      networkSnapshot({ ...input, size: undefined }).stats
        .estimatedBufferedAheadSeconds,
    ).toBeUndefined()
  })
  it('omits unsafe numeric values and never copies non-allowlisted stats properties', () => {
    const invalid = {
      ...stats,
      downloadSpeed: Infinity,
      url: 'SECRET',
      peers: { connected: -1, seeders: NaN, found: 1_000_001 },
      file: { ...stats.file, bufferedAhead: -1 },
    }
    const observed = networkSnapshot({ ...input, stats: invalid, offset: NaN })
    expect(JSON.parse(JSON.stringify(observed.stats))).toEqual({
      state: 'fresh',
      ageMs: 1000,
    })
    expect(JSON.stringify(observed)).not.toContain('SECRET')
  })
  it('distinguishes a measured empty range from unavailable/unsupported client buffering', () => {
    expect(
      networkSnapshot({ ...input, media: { ...media, buffered: [] } })
        .clientBuffer,
    ).toEqual({ state: 'available', aheadSeconds: 0 })
    expect(
      networkSnapshot({ ...input, media: { ...media, buffered: undefined } })
        .clientBuffer,
    ).toEqual({ state: 'unknown' })
    expect(
      networkSnapshot({ ...input, media: { ...media, state: 'unknown' } })
        .clientBuffer,
    ).toEqual({ state: 'unknown' })
    expect(
      networkSnapshot({ ...input, media: { ...media, source: 'native' } })
        .clientBuffer,
    ).toEqual({ state: 'unsupported' })
    expect(networkSnapshot({ ...input, library: true })).toEqual({
      stats: { state: 'not_applicable' },
      clientBuffer: { state: 'available', aheadSeconds: 7 },
    })
  })
})
