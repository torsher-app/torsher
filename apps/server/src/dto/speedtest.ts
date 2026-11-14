import { z } from 'zod'

const amount = z.number().finite().nonnegative()
export const speedtestStart = z.strictObject({}).meta({ id: 'speedtestStart' })
export const speedtestId = z.strictObject({ id: z.string().uuid() })
export const speedtestDownloadQuery = z.strictObject({
  bytes: z.coerce
    .number()
    .int()
    .min(1)
    .max(64 * 1024 * 1024),
  seq: z.coerce.number().int().min(0).max(4095),
})
export const speedtestReasons = [
  'complete',
  'byte_limit',
  'traffic_limit',
  'request_limit',
  'cancelled',
  'deadline',
  'lease_expired',
  'route_changed',
  'revoked',
  'shutdown',
  'provider_http_error',
  'provider_protocol_error',
  'provider_unavailable',
] as const
export const speedtestPhase = z
  .object({
    bytesPerSecond: amount.nullable(),
    durationMs: amount,
    payloadBytes: amount,
    confirmedBytes: amount,
    reservedBytes: amount,
    shortened: z.boolean(),
  })
  .meta({ id: 'speedtestPhase' })
export const speedtestSample = z
  .object({
    // Periodic current speed estimate; points are not independent HTTP statistical samples.
    seconds: amount,
    bytesPerSecond: amount,
    phase: z.enum(['download', 'upload']),
  })
  .meta({ id: 'speedtestSample' })
export const localSpeedtest = z
  .object({
    id: z.string().uuid(),
    startedAt: z.string(),
    deadlineMs: amount,
    durationMs: amount,
    maxBytes: amount,
    maxRequestBytes: amount,
    maxRequests: amount,
  })
  .meta({ id: 'localSpeedtest' })
export const internetSpeedtest = z
  .object({
    id: z.string().uuid(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    state: z.enum(['running', 'complete', 'cancelled', 'error']),
    phase: z.enum(['latency', 'download', 'upload', 'finished']),
    reason: z.enum(speedtestReasons).nullable(),
    provider: z.literal('Cloudflare'),
    providerHttpStatus: z.number().int().min(100).max(599).optional(),
    providerRetryAt: z.iso.datetime().optional(),
    route: z.enum(['direct', 'http_proxy', 'socks5_proxy', 'env_proxy']),
    dns: z.enum(['system', 'doh', 'proxy']),
    latencyMs: amount.nullable(),
    download: speedtestPhase,
    upload: speedtestPhase,
    samples: z.array(speedtestSample).max(102),
  })
  .meta({ id: 'internetSpeedtest' })
