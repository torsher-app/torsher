import type { SubtitleProviderStatus } from '../../dto/subtitles.ts'
import { config } from '../../config.ts'
import { netFetch } from '../net/index.ts'
import { readBodyLimited } from '../net/body.ts'
import { MAX_SUBTITLE_BYTES } from '../media/subtitles.ts'

export type ProviderIssue = Exclude<SubtitleProviderStatus['kind'], 'ready'>

export class SubtitleProviderError extends Error {
  readonly kind: ProviderIssue
  readonly resetAt?: string

  constructor(kind: ProviderIssue, resetAt?: string) {
    super(kind)
    this.kind = kind
    this.resetAt = resetAt
  }
}

export function providerError(error: unknown) {
  return error instanceof SubtitleProviderError
    ? error
    : new SubtitleProviderError('unavailable')
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function rows(value: unknown) {
  return Array.isArray(value) ? value.slice(0, 200).map(record) : []
}

export function count(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

export function isoDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim())
    return undefined
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined
}

function resetOf(headers: Headers) {
  const retry = headers.get('retry-after')
  if (retry && /^\d+$/.test(retry)) {
    return new Date(
      Date.now() + Math.min(Number(retry), 86400) * 1000,
    ).toISOString()
  }
  const reset = headers.get('x-ratelimit-reset')
  if (reset && /^\d{10}$/.test(reset))
    return new Date(Number(reset) * 1000).toISOString()
  return isoDate(retry)
}

export function providerUrl(
  url: string,
  origins: readonly string[],
  defaultOrigin?: string,
) {
  let parsed: URL
  try {
    parsed = new URL(url, defaultOrigin)
  }
  catch {
    throw new SubtitleProviderError('unavailable')
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || !origins.includes(parsed.origin)
    || parsed.hash
  ) {
    throw new SubtitleProviderError('unavailable')
  }
  return parsed
}

async function rejectResponse(response: Response): Promise<never> {
  await response.body?.cancel().catch(() => {})
  if (response.status === 429 || response.status === 406)
    throw new SubtitleProviderError('quota', resetOf(response.headers))
  if (response.status === 401 || response.status === 403)
    throw new SubtitleProviderError('auth')
  throw new SubtitleProviderError('unavailable')
}

function headersOf(extra: Record<string, string> = {}) {
  return { 'User-Agent': `Torsher v${config.version}`, ...extra }
}

export async function providerJson(
  url: URL,
  init: {
    headers?: Record<string, string>
    body?: object
    signal: AbortSignal
  },
) {
  try {
    const response = await netFetch(url, {
      method: init.body ? 'POST' : 'GET',
      redirect: 'error',
      headers: headersOf({
        ...init.headers,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      }),
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    })
    if (!response.ok)
      return await rejectResponse(response)
    const body = JSON.parse(
      (await readBodyLimited(response as Response, 1024 * 1024)).toString(
        'utf8',
      ),
    )
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new SubtitleProviderError('unavailable')
    return record(body)
  }
  catch (error) {
    throw providerError(error)
  }
}

export async function providerFile(
  input: string,
  origins: readonly string[],
  signal: AbortSignal,
  authenticated?: { origin: string, headers: Record<string, string> },
  defaultOrigin?: string,
) {
  let url = providerUrl(input, origins, defaultOrigin)
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const response = await netFetch(url, {
        redirect: 'manual',
        headers: headersOf(
          hop === 0 && url.origin === authenticated?.origin
            ? authenticated.headers
            : {},
        ),
        signal,
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => {})
        if (!location)
          throw new SubtitleProviderError('unavailable')
        url = providerUrl(location, origins, url.href)
        continue
      }
      if (!response.ok)
        return await rejectResponse(response)
      if (
        /html|json|zip|gzip/i.test(response.headers.get('content-type') ?? '')
      ) {
        await response.body?.cancel().catch(() => {})
        throw new SubtitleProviderError('unavailable')
      }
      return await readBodyLimited(response as Response, MAX_SUBTITLE_BYTES)
    }
    throw new SubtitleProviderError('unavailable')
  }
  catch (error) {
    throw providerError(error)
  }
}
