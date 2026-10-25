const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5
const CREDENTIAL_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
]

/** Адрес в сообщение не попадает: в query бывает ключ */
export class NetRedirectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetRedirectError'
  }
}

export type HopSender = (url: URL, init: RequestInit) => Promise<Response>

/**
 * Ключи уходят только на тот же хост и порт; переход с http на https
 * того же хоста на стандартных портах — тоже свой (reverse proxy с 301).
 */
function keepsCredentials(from: URL, to: URL) {
  if (from.hostname !== to.hostname)
    return false

  if (from.protocol === to.protocol)
    return from.port === to.port

  return from.protocol === 'http:' && from.port === '' && to.port === ''
}

function nextInit(
  init: RequestInit,
  status: number,
  from: URL,
  to: URL,
): RequestInit {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  const becomesGet
    = (status === 303 && method !== 'GET' && method !== 'HEAD')
      || ((status === 301 || status === 302) && method === 'POST')

  if (!keepsCredentials(from, to)) {
    for (const name of CREDENTIAL_HEADERS) headers.delete(name)
  }

  if (becomesGet) {
    headers.delete('content-type')
    headers.delete('content-length')

    return { ...init, method: 'GET', body: undefined, headers }
  }

  if (init.body instanceof ReadableStream)
    throw new NetRedirectError('Cannot repeat a streamed body on redirect')

  return { ...init, headers }
}

/**
 * Редиректы идут вручную: на каждом шаге `send` заново выбирает маршрут
 * по хосту, а ключи уходят только туда, где их оставляет `keepsCredentials`.
 * `redirect: 'manual'` отдаёт 3xx как есть, `'error'` бросает на любом
 * статусе редиректа.
 */
export async function followRedirects(
  start: URL,
  init: RequestInit,
  send: HopSender,
) {
  const mode = init.redirect ?? 'follow'
  let url = start
  let hopInit = init

  for (let hop = 0; ; hop++) {
    const res = await send(url, hopInit)
    const location = res.headers.get('location')

    if (mode === 'manual' || !REDIRECT_STATUSES.has(res.status))
      return res

    if (mode === 'error') {
      await res.body?.cancel().catch(() => {})
      throw new NetRedirectError('Unexpected redirect')
    }

    if (location === null)
      return res

    await res.body?.cancel().catch(() => {})

    if (hop >= MAX_REDIRECTS)
      throw new NetRedirectError('Too many redirects')

    let next: URL

    try {
      next = new URL(location, url)
    }
    catch {
      throw new NetRedirectError('Invalid redirect location')
    }

    if (next.protocol !== 'http:' && next.protocol !== 'https:')
      throw new NetRedirectError('Unsupported redirect scheme')

    if (url.protocol === 'https:' && next.protocol === 'http:')
      throw new NetRedirectError('Redirect from https to http')

    hopInit = nextInit(hopInit, res.status, url, next)
    url = next
  }
}
