import { z } from 'zod'
import { internetSpeedtest } from '../../dto/speedtest.ts'
import { logFor } from '../logs/index.ts'
import { parseRetryAfter } from './retryAfter.ts'

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const cfRay = z.string().regex(/^[a-f\d]{16,32}(?:-[A-Z\d]{3,10})?$/i)
const cfErrorType = z.string().regex(/^\d{3,5}$/)
const transportCodes = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
] as const
const serverKinds = ['cloudflare', 'envoy', 'nginx', 'squid', 'other'] as const
const mimeTypes = [
  'text/html',
  'text/plain',
  'application/json',
  'application/octet-stream',
  'other',
] as const
const responseFields = {
  statusCode: z.number().int().min(100).max(599).optional(),
  responseServer: z.enum(serverKinds).optional(),
  responseType: z.enum(mimeTypes).optional(),
  cfRay: cfRay.optional(),
  cfMitigated: z.literal('challenge').optional(),
  cfErrorType: cfErrorType.optional(),
  providerRetryAt: z.iso.datetime().optional(),
  viaPresent: z.boolean().optional(),
}

// Shared by the emitter and the safe problem-report projection; no raw header,
// error, URL, request identity or provider body crosses this boundary.
export const speedtestFailure = internetSpeedtest
  .pick({
    provider: true,
    route: true,
    dns: true,
  })
  .extend({
    testId: z.string().uuid(),
    phase: z.enum(['latency', 'download', 'upload']),
    reason: z.enum([
      'provider_http_error',
      'provider_protocol_error',
      'provider_unavailable',
      'deadline',
      'traffic_limit',
      'request_limit',
    ]),
    elapsedMs: z.number().finite().nonnegative(),
    downloadBytes: count,
    uploadBytes: count,
    operation: z.enum(['GET /__down', 'POST /__up']).optional(),
    requestBytes: z.number().int().min(0).max(250_000_000).optional(),
    transportCode: z.enum(transportCodes).optional(),
    ...responseFields,
  })

export function providerResponseFacts(response: Response) {
  const headers = response.headers
  const server = headers.get('server')?.trim().toLowerCase()
  const mime = headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  const ray = cfRay.safeParse(headers.get('cf-ray'))
  const errorType = cfErrorType.safeParse(headers.get('cf-error-type'))
  return {
    statusCode: response.status,
    responseServer:
      server == null
        ? undefined
        : (serverKinds.find(
            kind =>
              kind !== 'other'
              && (server === kind || new RegExp(`^${kind}/[\\d.]+$`).test(server)),
          ) ?? 'other'),
    responseType:
      mime == null
        ? undefined
        : (mimeTypes.find(type => type === mime) ?? 'other'),
    cfRay: ray.success ? ray.data : undefined,
    cfMitigated:
      headers.get('cf-mitigated') === 'challenge'
        ? ('challenge' as const)
        : undefined,
    cfErrorType: errorType.success ? errorType.data : undefined,
    providerRetryAt: parseRetryAfter(headers.get('retry-after')),
    viaPresent: headers.has('via'),
  }
}

export function transportErrorCode(error: unknown) {
  const seen = new Set<unknown>()
  let current = error
  for (
    let depth = 0;
    depth < 5 && current && typeof current === 'object' && !seen.has(current);
    depth++
  ) {
    seen.add(current)
    if ('code' in current) {
      const rawCode = current.code
      const code = transportCodes.find(code => code === rawCode)
      if (code)
        return code
    }
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}

export function logSpeedtestFailure(value: unknown) {
  const parsed = speedtestFailure.safeParse(value)
  if (!parsed.success)
    return
  logFor('network').warn(
    {
      event: 'speedtest.failed',
      origin: 'server',
      ...parsed.data,
    },
    'Server internet speed check failed',
  )
}
