import { config } from '../../config.ts'

const API_URL = 'https://api.themoviedb.org/3'
const IMAGE_URL = 'https://image.tmdb.org/t/p'
// При DNS-подмене соединение может висеть долго — ждём ограниченно
const API_TIMEOUT_MS = 10_000
const IMAGE_TIMEOUT_MS = 30_000

/**
 * `config` — токена нет или TMDB его не принял, `not_found` — нет такой
 * сущности, `unavailable` — сеть или сам TMDB.
 */
export type TmdbErrorKind = 'config' | 'not_found' | 'unavailable'

export class TmdbError extends Error {
  readonly kind: TmdbErrorKind

  constructor(kind: TmdbErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TmdbError'
    this.kind = kind
  }
}

// Все запросы к TMDB выходят в сеть только отсюда
async function send(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
) {
  try {
    return await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
  }
  catch (err) {
    throw new TmdbError('unavailable', 'TMDB is unreachable', { cause: err })
  }
}

export async function tmdbGet<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const token = config.tmdbAccessToken

  if (!token) {
    throw new TmdbError(
      'config',
      'TMDB access token is not configured on the server',
    )
  }

  const url = new URL(`${API_URL}${path}`)

  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value)

  const res = await send(url.href, API_TIMEOUT_MS, {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  })

  if (res.status === 401)
    throw new TmdbError('config', 'TMDB rejected the access token')

  if (res.status === 404)
    throw new TmdbError('not_found', 'Not found in TMDB')

  if (!res.ok)
    throw new TmdbError('unavailable', `TMDB responded with ${res.status}`)

  try {
    return (await res.json()) as T
  }
  catch (err) {
    throw new TmdbError('unavailable', 'TMDB sent a broken response', {
      cause: err,
    })
  }
}

export function fetchTmdbImage(size: string, file: string) {
  return send(`${IMAGE_URL}/${size}/${file}`, IMAGE_TIMEOUT_MS)
}
