import { Buffer } from 'node:buffer'

/**
 * Синтетические ответы HTTP API движка той же формы, что у закреплённой версии.
 * Названия вымышленные, infohash — не настоящие раздачи.
 */
export const INFO_HASH = '0123456789abcdef0123456789abcdef01234567'

export const movieDetails = {
  info_hash: INFO_HASH,
  name: 'Sample Movie (2008)',
  output_folder: '/data/downloads',
  total_pieces: 41,
  files: [
    {
      name: 'Sample Movie (2008)/Sample.Movie.2008.1080p.mkv',
      components: ['Sample Movie (2008)', 'Sample.Movie.2008.1080p.mkv'],
      length: 9_437_184,
      included: true,
      attributes: {
        symlink: false,
        hidden: false,
        padding: false,
        executable: false,
      },
    },
    {
      name: 'Sample Movie (2008)/.pad/0',
      components: ['Sample Movie (2008)', '.pad', '0'],
      length: 1_048_576,
      included: true,
      attributes: {
        symlink: false,
        hidden: true,
        padding: true,
        executable: false,
      },
    },
    {
      name: 'Sample Movie (2008)/Sample.Movie.2008.srt',
      components: ['Sample Movie (2008)', 'Sample.Movie.2008.srt'],
      length: 20_480,
      included: true,
      attributes: {
        symlink: false,
        hidden: false,
        padding: false,
        executable: false,
      },
    },
  ],
}

export function addResponse(details = movieDetails, id: number | null = null) {
  return {
    id,
    details,
    output_folder: '/data/downloads',
    seen_peers: id === null ? [] : null,
  }
}

export const liveStats = {
  state: 'live',
  file_progress: [3_145_728, 0, 0],
  error: null,
  progress_bytes: 3_145_728,
  uploaded_bytes: 0,
  total_bytes: 10_506_240,
  finished: false,
  live: {
    snapshot: {
      downloaded_and_checked_bytes: 3_145_728,
      fetched_bytes: 3_200_000,
      uploaded_bytes: 0,
      downloaded_and_checked_pieces: 12,
      total_piece_download_ms: 4800,
      peer_stats: {
        queued: 3,
        connecting: 2,
        live: 7,
        live_tcp: 5,
        live_utp: 2,
        live_socks: 0,
        seen: 41,
        dead: 4,
        not_needed: 0,
        steals: 0,
      },
    },
    average_piece_download_time: { secs: 0, nanos: 400_000_000 },
    download_speed: { mbps: 2.5, human_readable: '2.50 MiB/s' },
    upload_speed: { mbps: 0.25, human_readable: '0.25 MiB/s' },
    time_remaining: { human_readable: '3s', duration: { secs: 3 } },
  },
}

export const initializingStats = {
  state: 'initializing',
  initializing_paused: false,
  file_progress: [0, 0, 0],
  error: null,
  progress_bytes: 0,
  uploaded_bytes: 0,
  total_bytes: 10_506_240,
  finished: false,
  live: null,
}

export function engineError(status: number, kind: string, text: string) {
  return {
    error_kind: kind,
    human_readable: text,
    status,
    status_text: String(status),
  }
}

type Bencodable
  = number | string | Uint8Array | Bencodable[] | { [key: string]: Bencodable }

function bencode(value: Bencodable): Uint8Array {
  const encoder = new TextEncoder()

  if (typeof value === 'number')
    return encoder.encode(`i${value}e`)

  if (typeof value === 'string' || value instanceof Uint8Array) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value

    return Buffer.concat([encoder.encode(`${bytes.length}:`), bytes])
  }

  if (Array.isArray(value)) {
    return Buffer.concat([
      encoder.encode('l'),
      ...value.map(bencode),
      encoder.encode('e'),
    ])
  }

  const keys = Object.keys(value).sort()

  return Buffer.concat([
    encoder.encode('d'),
    ...keys.flatMap(key => [bencode(key), bencode(value[key]!)]),
    encoder.encode('e'),
  ])
}

/** `.torrent` с вымышленной раздачей: ядру из него нужен только размер куска */
export function sampleTorrentFile(pieceLength = 262_144) {
  return bencode({
    announce: 'http://tracker.example/announce',
    info: {
      'name': 'Sample Movie (2008)',
      'piece length': pieceLength,
      'pieces': new Uint8Array(20 * 40),
      'files': movieDetails.files.map(file => ({
        length: file.length,
        path: file.components.slice(1),
      })),
    },
  })
}
