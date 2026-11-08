import type { FastifyRequest } from 'fastify'
import type { Device } from '../../db/schema.ts'
import { z } from 'zod'
import { diagnosticId } from '../../dto/diagnostics.ts'
import { logFor, throttleLog } from '../logs/index.ts'
import { sessionRejectionReason } from '../users/session.ts'

const WINDOW_MS = 10 * 60 * 1000
const type = z.enum(['tv', 'browser', 'other', 'unknown'])
const operations = z.enum([
  'postAuthSignup',
  'postAuthSignin',
  'postAuthRefresh',
  'postAuthLogout',
  'postDevicePairing',
  'getDevicePairing',
  'postDevicePairingConfirm',
  'getDevices',
  'patchDevice',
  'deleteDevice',
  'postPlayback',
  'streamTorrentFile',
  'putStoragePath',
  'putStoragePolicy',
  'postStorageMove',
  'putTorrentRetention',
  'postTorrentDownload',
  'unknown',
])
// IP остаётся только в локальном журнале, в safe report его нет.
export const authDiagnosticEvents = {
  'auth.pairing_started': z.object({ type }),
  'auth.device_paired': z.object({ deviceId: diagnosticId, type }),
  'auth.pairing_rejected': z.object({
    step: z.enum(['poll', 'confirm']),
    reason: z.enum(['invalid', 'expired']),
  }),
  'auth.rate_limited': z.object({
    limit: z.enum(['start', 'poll', 'active', 'signin']),
  }),
  'auth.token_rejected': z.object({
    tokenKind: z.enum(['device_cookie', 'device_stream']),
    reason: z.enum(['unknown', 'purpose']),
    type,
    deviceId: diagnosticId.optional(),
  }),
  'auth.session_rejected': z.object({
    sessionKind: z.enum(['access', 'refresh', 'stream']),
    reason: z.enum([
      'purpose',
      'expired',
      'invalid',
      'revoked',
      'missing',
      'unknown',
    ]),
  }),
  'auth.cross_site': z.object({
    originKind: z.enum(['same', 'different', 'opaque', 'missing', 'invalid']),
    fetchSite: z.enum([
      'same-origin',
      'same-site',
      'cross-site',
      'none',
      'unknown',
    ]),
    operation: operations,
  }),
  'auth.signin_failed': z.object({
    reason: z.enum([
      'no_user',
      'invalid_credentials',
      'inactive',
      'unavailable',
    ]),
  }),
}
export function authDiagnosticRule(event: unknown) {
  return typeof event === 'string' && Object.hasOwn(authDiagnosticEvents, event)
    ? authDiagnosticEvents[event as keyof typeof authDiagnosticEvents]
    : undefined
}
export function logAuthRateLimited(
  ip: string,
  limit: 'start' | 'poll' | 'active' | 'signin',
) {
  if (throttleLog(`auth-limit:${limit}:${ip}`, WINDOW_MS)) {
    logFor('auth').warn(
      { event: 'auth.rate_limited', origin: 'server', ip, limit },
      'Authentication rate limited',
    )
  }
}
export function logPairingRejected(
  ip: string,
  reason: 'invalid' | 'expired',
  step: 'poll' | 'confirm',
) {
  if (throttleLog(`auth-pairing:${step}:${reason}:${ip}`, WINDOW_MS)) {
    logFor('auth').warn(
      { event: 'auth.pairing_rejected', origin: 'server', ip, reason, step },
      'Device pairing rejected',
    )
  }
}
export function logDeviceTokenRejected(
  request: FastifyRequest,
  tokenKind: 'device_cookie' | 'device_stream',
  reason: 'unknown' | 'purpose',
  device?: Pick<Device, 'id' | 'type'>,
  signedId?: string,
) {
  const verifiedId = diagnosticId.safeParse(signedId).data
  if (
    throttleLog(`auth-token:${tokenKind}:${reason}:${request.ip}`, WINDOW_MS)
  ) {
    logFor('auth').warn(
      {
        event: 'auth.token_rejected',
        origin: 'server',
        ip: request.ip,
        tokenKind,
        reason,
        type: device?.type ?? 'unknown',
        ...(device
          ? { deviceId: device.id }
          : verifiedId
            ? { deviceId: verifiedId }
            : {}),
      },
      'Device token rejected',
    )
  }
}
export function logSessionRejected(
  request: FastifyRequest,
  sessionKind: 'access' | 'refresh' | 'stream',
  error: unknown,
  missing = false,
) {
  const reason = missing ? 'missing' : sessionRejectionReason(error)
  if (
    throttleLog(
      `auth-session:${sessionKind}:${reason}:${request.ip}`,
      WINDOW_MS,
    )
  ) {
    logFor('auth').warn(
      {
        event: 'auth.session_rejected',
        origin: 'server',
        ip: request.ip,
        sessionKind,
        reason,
      },
      'Session token rejected',
    )
  }
}
export function logSigninFailed(
  ip: string,
  reason: 'no_user' | 'invalid_credentials' | 'inactive' | 'unavailable',
) {
  if (throttleLog(`auth-signin:${reason}:${ip}`, WINDOW_MS)) {
    logFor('auth').warn(
      { event: 'auth.signin_failed', origin: 'server', ip, reason },
      'Sign-in failed',
    )
  }
}
export function logCrossSite(request: FastifyRequest) {
  let originKind: 'same' | 'different' | 'opaque' | 'missing' | 'invalid'
    = 'missing'
  const origin = request.headers.origin
  if (origin === 'null') {
    originKind = 'opaque'
  }
  else if (origin) {
    try {
      const value = new URL(origin)
      originKind = ['http:', 'https:'].includes(value.protocol)
        ? value.origin
        === new URL(`${request.protocol}://${request.host}`).origin
          ? 'same'
          : 'different'
        : 'invalid'
    }
    catch {
      originKind = 'invalid'
    }
  }
  const site = request.headers['sec-fetch-site']
  const fetchSite
    = typeof site === 'string'
      && ['same-origin', 'same-site', 'cross-site', 'none'].includes(site)
      ? site
      : 'unknown'
  const schema = request.routeOptions.schema as
    { operationId?: unknown } | undefined
  const operation = operations.safeParse(schema?.operationId).data ?? 'unknown'
  if (
    throttleLog(
      `auth-cross-site:${request.ip}:${operation}:${originKind}:${fetchSite}`,
      WINDOW_MS,
    )
  ) {
    logFor('auth').warn(
      {
        event: 'auth.cross_site',
        origin: 'server',
        ip: request.ip,
        originKind,
        fetchSite,
        operation,
      },
      'Cross-site request rejected',
    )
  }
}
