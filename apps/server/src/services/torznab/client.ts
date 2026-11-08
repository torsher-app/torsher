import type { TorznabCaps } from './caps.ts'
import { isLocalHostname } from '../net/address.ts'
import { BodyTooLargeError, readBodyLimited } from '../net/body.ts'
import { netFetch, NetRedirectError, resolvesToLocal } from '../net/index.ts'
import { parseCaps } from './caps.ts'
import { child, parseXml, text } from './xml.ts'

// Индексатор за прокси или упавший трекер может держать соединение долго.
// Срок меньше таймаута API-клиента панели, чтобы проверка успела ответить
export const SOURCE_TIMEOUT_MS = 8000

/**
 * `auth` — ключ не принят, `timeout` и `unreachable` — сеть,
 * `bad_response` — ответ не Torznab (или не тот API менеджера),
 * `remote` — индексатор ответил ошибкой (отключён, лимит, сбой),
 * `unsupported` — версия менеджера не отдаёт ожидаемый API.
 */
export type SourceErrorKind
  = | 'auth'
    | 'timeout'
    | 'unreachable'
    | 'bad_response'
    | 'remote'
    | 'unsupported'

export class SourceError extends Error {
  readonly kind: SourceErrorKind
  /** Когда индексатор просит повторить: `Retry-After` ответа 429 или 503 */
  readonly retryAt?: Date
  /** Только фактически полученный HTTP status; сеть не выдумывает статус. */
  readonly status?: number

  constructor(
    kind: SourceErrorKind,
    message: string,
    options?: ErrorOptions & { retryAt?: Date, status?: number },
  ) {
    super(message, options)
    this.name = 'SourceError'
    this.kind = kind
    this.retryAt = options?.retryAt
    this.status = options?.status
  }
}

/** `Retry-After` — секунды или HTTP-дата; без заголовка или в прошлом — нет */
export function retryAtOf(res: Response, now = Date.now()) {
  const value = res.headers.get('retry-after')?.trim()

  if (!value)
    return undefined

  const at = /^\d+$/.test(value)
    ? now + Number(value) * 1000
    : new Date(value).getTime()

  return Number.isFinite(at) && at > now ? new Date(at) : undefined
}

function isTimeout(err: unknown) {
  return err instanceof Error && err.name === 'TimeoutError'
}

/**
 * Единственный выход в сеть к индексаторам и менеджерам. В сообщения ошибок
 * адрес не попадает: в нём может быть API-ключ.
 */
export async function sourceGet(
  url: URL,
  headers: Record<string, string> = {},
) {
  try {
    return await netFetch(url, {
      headers,
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    })
  }
  catch (err) {
    if (isTimeout(err)) {
      throw new SourceError('timeout', 'Source did not respond in time')
    }

    if (err instanceof NetRedirectError) {
      throw new SourceError('bad_response', 'Source redirect was refused')
    }

    throw new SourceError('unreachable', 'Source is unreachable')
  }
}

// Ответы Torznab и списки индексаторов менеджеров — килобайты, редко мегабайты
const SOURCE_RESPONSE_MAX_BYTES = 16 * 1024 * 1024

export async function readBody(res: Response) {
  try {
    return new TextDecoder().decode(
      await readBodyLimited(res, SOURCE_RESPONSE_MAX_BYTES),
    )
  }
  catch (err) {
    if (err instanceof BodyTooLargeError) {
      throw new SourceError('bad_response', 'Source response is too large', {
        status: res.status,
      })
    }

    throw new SourceError(
      isTimeout(err) ? 'timeout' : 'unreachable',
      'Source response was interrupted',
      { status: res.status },
    )
  }
}

/**
 * Адрес Torznab храним без завершающего `/api`: так его показывают
 * менеджеры, а пользователь может вставить адрес как с ним, так и без.
 */
export function normalizeTorznabUrl(input: string) {
  const url = new URL(input)

  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/api$/i, '')

  return url.href.replace(/\/+$/, '')
}

export function torznabRequestUrl(
  baseUrl: string,
  params: Record<string, string>,
  apiKey?: string,
) {
  const url = new URL(`${normalizeTorznabUrl(baseUrl)}/api`)

  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value)

  if (apiKey)
    url.searchParams.set('apikey', apiKey)

  return url
}

// Коды ошибок Torznab/Newznab: 100–102 — учётные данные и права
const AUTH_ERROR_CODES = new Set(['100', '101', '102'])

/** Разбирает ответ Torznab: ошибка в теле приходит и со статусом 200 */
export async function readTorznabXml(res: Response) {
  if (res.status === 401 || res.status === 403) {
    throw new SourceError('auth', 'Source rejected the credentials', {
      status: res.status,
    })
  }

  // Лимит запросов (у Prowlarr — `QueryLimit` и «disabled till»): тело
  // бывает и XML-ошибкой, срок важнее
  if (res.status === 429 || res.status === 503) {
    await res.body?.cancel().catch(() => {})

    throw new SourceError('remote', `Source responded with ${res.status}`, {
      retryAt: retryAtOf(res),
      status: res.status,
    })
  }

  const body = await readBody(res)
  let xml

  try {
    xml = parseXml(body)
  }
  catch {
    throw new SourceError(
      res.ok ? 'bad_response' : 'remote',
      res.ok
        ? 'Response is not Torznab XML'
        : `Source responded with ${res.status}`,
      { status: res.status },
    )
  }

  const error = child(xml, 'error')

  if (error) {
    const code = text(error, 'code') ?? ''

    throw new SourceError(
      AUTH_ERROR_CODES.has(code) ? 'auth' : 'remote',
      `Torznab request failed (${AUTH_ERROR_CODES.has(code) ? 'auth' : 'remote'})`,
      { status: res.status },
    )
  }

  if (!res.ok) {
    throw new SourceError('remote', `Source responded with ${res.status}`, {
      status: res.status,
    })
  }

  return xml
}

/** Проверка индексатора: `t=caps` отвечает и без поиска, ключ проверяется */
export async function fetchCaps(
  baseUrl: string,
  apiKey?: string,
  sessionCookie?: string,
): Promise<TorznabCaps> {
  const res = await sourceGet(
    torznabRequestUrl(baseUrl, { t: 'caps' }, apiKey),
    sessionCookie ? { Cookie: sessionCookie } : {},
  )
  const caps = parseCaps(child(await readTorznabXml(res), 'caps'))

  if (!caps) {
    throw new SourceError(
      'bad_response',
      'Response is not Torznab capabilities',
      { status: res.status },
    )
  }

  return caps
}

// Тот же предел, что у `.torrent`, загруженного в панели
export const TORRENT_FILE_MAX_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 3

export type DownloadedTorrent
  = { kind: 'file', bytes: Uint8Array } | { kind: 'magnet', magnet: string }

async function readLimited(res: Response) {
  try {
    return await readBodyLimited(res, TORRENT_FILE_MAX_BYTES)
  }
  catch (err) {
    if (err instanceof BodyTooLargeError)
      throw new SourceError('bad_response', 'Torrent file is too large')

    throw new SourceError(
      isTimeout(err) ? 'timeout' : 'unreachable',
      'Source response was interrupted',
    )
  }
}

/**
 * `.torrent` по ссылке индексатора. Индексаторы раздач только с magnet
 * отвечают на ссылку редиректом на `magnet:` — его и возвращаем.
 * Редиректы идут вручную: `fetch` не следует по схеме `magnet:`.
 *
 * Ссылка приходит в ответе индексатора, поэтому на loopback и link-local
 * (API движка, метаданные облака) запрос не уходит — ни по адресу, ни по
 * имени, которое туда разрешается, — кроме origin самого индексатора
 * (`trustedOrigin`).
 */
export async function downloadTorrent(
  link: string,
  timeoutMs = SOURCE_TIMEOUT_MS,
  options: { trustedOrigin?: string, sessionCookie?: string } = {},
): Promise<DownloadedTorrent> {
  let url: URL
  try {
    url = new URL(link)
  }
  catch {
    throw new SourceError('bad_response', 'Invalid torrent link')
  }
  let cookie
    = url.origin === options.trustedOrigin ? options.sessionCookie : undefined

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (
      url.origin !== options.trustedOrigin
      && (isLocalHostname(url.hostname) || (await resolvesToLocal(url.hostname)))
    ) {
      throw new SourceError(
        'bad_response',
        'Torrent link points to a local address',
      )
    }

    let res: Response

    try {
      res = await netFetch(url, {
        redirect: 'manual',
        headers: cookie ? { Cookie: cookie } : {},
        signal: AbortSignal.timeout(timeoutMs),
      })
    }
    catch (err) {
      throw new SourceError(
        isTimeout(err) ? 'timeout' : 'unreachable',
        isTimeout(err)
          ? 'Source did not respond in time'
          : 'Source is unreachable',
      )
    }

    const location = res.headers.get('location')

    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {})

      if (location.startsWith('magnet:'))
        return { kind: 'magnet', magnet: location }

      let next: URL
      try {
        next = new URL(location, url)
      }
      catch {
        throw new SourceError('bad_response', 'Invalid torrent redirect')
      }

      if (next.protocol !== 'http:' && next.protocol !== 'https:')
        throw new SourceError('bad_response', 'Unexpected redirect')

      if (url.protocol === 'https:' && next.protocol === 'http:')
        throw new SourceError('bad_response', 'Redirect from https to http')

      if (url.origin !== next.origin)
        cookie = undefined
      url = next
      continue
    }

    if (res.status === 401 || res.status === 403)
      throw new SourceError('auth', 'Source rejected the credentials')

    if (!res.ok) {
      throw new SourceError('remote', `Source responded with ${res.status}`, {
        ...((res.status === 429 || res.status === 503) && {
          retryAt: retryAtOf(res),
        }),
      })
    }

    const bytes = await readLimited(res)

    // Bencode-словарь начинается с `d`; страница с ошибкой — нет
    if (bytes[0] !== 0x64)
      throw new SourceError('bad_response', 'Response is not a torrent file')

    return { kind: 'file', bytes }
  }

  throw new SourceError('bad_response', 'Too many redirects')
}
