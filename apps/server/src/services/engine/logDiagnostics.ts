import { z } from 'zod'

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const duration = z.number().int().min(0).max(31_536_000_000)
const infoHash = z.string().regex(/^[a-f0-9]{40}$/)
const peers = {
  peers: count,
  found: count,
  seeders: count,
  halfOpen: count,
}
const stream = {
  infoHash,
  fileIndex: count,
  piece: count,
  elapsedMs: duration,
}
const operation = z.enum([
  'GET /health',
  'POST /torrents/inspect',
  'POST /torrents/resolve',
  'GET /torrents',
  'GET /torrents/storage',
  'POST /torrents',
  'PUT /torrents/{hash}/files',
  'POST /torrents/{hash}/pause',
  'POST /torrents/{hash}/resume',
  'DELETE /torrents/{hash}',
  'POST /torrents/{hash}/move',
  'GET /torrents/{hash}/move',
  'GET /torrents/{hash}/stats',
  'GET /torrents/{hash}/files/{index}/stream',
  'PUT /torrents/{hash}/seed',
  'GET /settings',
  'PUT /settings',
  'GET /maintenance',
  'GET /maintenance/{id}',
  'POST /maintenance/{id}/prepare',
  'POST /maintenance/{id}/unlink',
  'POST /maintenance/{id}/finalize',
  'POST /maintenance/{id}/cancel',
  'unknown',
])

// Один словарь для границы Go logfmt и отдельной safe projection отчёта.
// Свободный текст, err, URL, пути и details в этот контракт не входят.
export const engineDiagnosticEvents = {
  'engine.network': {
    message: 'engine network configured',
    level: 'INFO',
    schema: z.object({
      peerPort: z.number().int().min(0).max(65535),
      dht: z.boolean(),
      pex: z.boolean(),
      upnp: z.boolean(),
      encryption: z.enum(['prefer', 'require']),
      connsPerTorrent: count,
      connsTotal: count,
    }),
    numbers: ['peerPort', 'connsPerTorrent', 'connsTotal'],
    booleans: ['dht', 'pex', 'upnp'],
  },
  'engine.stream_wait': {
    message: 'stream read stalled',
    level: 'WARN',
    schema: z.discriminatedUnion('statsKnown', [
      z.object({ ...stream, statsKnown: z.literal(false) }),
      z.object({
        ...stream,
        statsKnown: z.literal(true),
        statsAgeMs: duration,
        ...peers,
        downRate: count,
      }),
    ]),
    numbers: [
      'fileIndex',
      'piece',
      'elapsedMs',
      'statsAgeMs',
      'peers',
      'found',
      'seeders',
      'halfOpen',
      'downRate',
    ],
    booleans: ['statsKnown'],
  },
  'engine.stream_resumed': {
    message: 'stream read resumed',
    level: 'INFO',
    schema: z.object(stream),
    numbers: ['fileIndex', 'piece', 'elapsedMs'],
    booleans: [],
  },
  'engine.metadata_timeout': {
    message: 'metadata resolution timed out',
    level: 'WARN',
    schema: z.discriminatedUnion('statsKnown', [
      z.object({ infoHash, elapsedMs: duration, statsKnown: z.literal(false) }),
      z.object({
        infoHash,
        elapsedMs: duration,
        statsKnown: z.literal(true),
        statsAgeMs: duration,
        ...peers,
        downRate: count,
      }),
    ]),
    numbers: [
      'elapsedMs',
      'peers',
      'found',
      'seeders',
      'halfOpen',
      'statsAgeMs',
      'downRate',
    ],
    booleans: ['statsKnown'],
  },
  'engine.api_error': {
    message: 'engine API failed',
    level: 'ERROR',
    schema: z.object({
      operation,
      statusCode: z.number().int().min(500).max(599),
      errorKind: z.enum(['storage', 'timeout', 'other']),
      infoHash: infoHash.optional(),
    }),
    numbers: ['statusCode'],
    booleans: [],
  },
  'engine.storage_write_failed': {
    message: 'storage write failed',
    level: 'ERROR',
    schema: z.object({
      infoHash,
      piece: count,
      errorKind: z.enum(['ENOSPC', 'EACCES', 'EROFS', 'EDQUOT', 'other']),
      shortWrite: z.boolean(),
    }),
    numbers: ['piece'],
    booleans: ['shortWrite'],
  },
} satisfies Record<
  string,
  {
    message: string
    level: string
    schema: z.ZodType
    numbers: string[]
    booleans: string[]
  }
>

export function engineDiagnosticRule(event: unknown) {
  return typeof event === 'string'
    && Object.hasOwn(engineDiagnosticEvents, event)
    ? engineDiagnosticEvents[event as keyof typeof engineDiagnosticEvents]
    : undefined
}

export function parseEngineDiagnostic(pairs: Map<string, string>) {
  const rule = engineDiagnosticRule(pairs.get('event'))
  if (!rule)
    return undefined
  if (pairs.get('msg') !== rule.message || pairs.get('level') !== rule.level)
    return { message: 'Invalid engine diagnostic', fields: {} }

  const input: Record<string, unknown> = Object.fromEntries(pairs)
  for (const key of rule.numbers) {
    const value = pairs.get(key)
    if (value !== undefined && /^(?:0|[1-9]\d{0,15})$/.test(value))
      input[key] = Number(value)
  }
  for (const key of rule.booleans) {
    const value = pairs.get(key)
    if (value === 'true' || value === 'false')
      input[key] = value === 'true'
  }
  const result = rule.schema.safeParse(input)
  return result.success
    ? {
        message: rule.message,
        fields: {
          ...result.data,
          event: pairs.get('event')!,
          origin: 'server',
        },
      }
    : { message: 'Invalid engine diagnostic', fields: {} }
}
