import { Buffer } from 'node:buffer'

/**
 * Синтетические ответы HTTP API движка. Названия вымышленные,
 * infohash — не настоящие раздачи.
 */
export const INFO_HASH = '0123456789abcdef0123456789abcdef01234567'

export const movieDetails = {
  infoHash: INFO_HASH,
  name: 'Sample Movie (2008)',
  pieceLength: 262_144,
  pieceCount: 41,
  files: [
    {
      path: 'Sample.Movie.2008.1080p.mkv',
      length: 9_437_184,
      padding: false,
    },
    {
      path: '.pad/0',
      length: 1_048_576,
      padding: true,
    },
    {
      path: 'Sample.Movie.2008.srt',
      length: 20_480,
      padding: false,
    },
  ],
}

/** Сверка с каталогом (`inspect?dir=`): видео совпало, субтитры перезалиты */
export const comparedDetails = {
  ...movieDetails,
  files: [
    { ...movieDetails.files[0]!, onDisk: 'match' },
    { ...movieDetails.files[1]!, onDisk: 'missing' },
    { ...movieDetails.files[2]!, onDisk: 'differs' },
  ],
}

/** Скачаны первые `count` кусков из 41 */
export function piecesDone(count: number) {
  return '1'.repeat(count) + '0'.repeat(41 - count)
}

export const liveState = {
  infoHash: INFO_HASH,
  paused: false,
  selected: [0],
  bytesCompleted: 3_145_728,
  bytesWanted: 9_437_184,
  wantedCompleted: 3_145_728,
  queued: false,
  seeding: true,
  uploaded: 1_048_576,
  peers: { connected: 7, found: 41, seeders: 3 },
  downloadSpeed: 2_621_440,
  uploadSpeed: 262_144,
  fileProgress: [3_145_728, 0, 0],
}

export const liveStats = {
  ...liveState,
  pieces: piecesDone(12),
}

export function engineError(kind: string, message: string) {
  return { kind, message }
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

/** `.torrent` с вымышленной раздачей: ядро передаёт его движку как есть */
export function sampleTorrentFile(pieceLength = 262_144) {
  return bencode({
    announce: 'http://tracker.example/announce',
    info: {
      'name': 'Sample Movie (2008)',
      'piece length': pieceLength,
      'pieces': new Uint8Array(20 * 40),
      'files': movieDetails.files.map(file => ({
        length: file.length,
        path: file.path.split('/'),
      })),
    },
  })
}

/** Ход переноса раздачи в другой каталог */
export function moveState(
  dir: string,
  state: 'running' | 'done' | 'failed' = 'done',
  error?: string,
  kind?: string,
) {
  return {
    dir,
    state,
    bytesTotal: 3_145_728,
    bytesDone: state === 'running' ? 1_048_576 : 3_145_728,
    ...(error ? { error } : {}),
    ...(kind ? { kind } : {}),
  }
}
