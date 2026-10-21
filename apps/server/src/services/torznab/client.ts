import type { TorznabCaps } from './caps.ts'
import { netFetch } from '../net/index.ts'
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

  constructor(kind: SourceErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SourceError'
    this.kind = kind
  }
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
      throw new SourceError('timeout', 'Source did not respond in time', {
        cause: err,
      })
    }

    throw new SourceError('unreachable', 'Source is unreachable', {
      cause: err,
    })
  }
}

export async function readBody(res: Response) {
  try {
    return await res.text()
  }
  catch (err) {
    throw new SourceError(
      isTimeout(err) ? 'timeout' : 'unreachable',
      'Source response was interrupted',
      { cause: err },
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
  if (res.status === 401 || res.status === 403)
    throw new SourceError('auth', 'Source rejected the API key')

  const body = await readBody(res)
  let xml

  try {
    xml = parseXml(body)
  }
  catch (err) {
    throw new SourceError(
      res.ok ? 'bad_response' : 'remote',
      res.ok
        ? 'Response is not Torznab XML'
        : `Source responded with ${res.status}`,
      { cause: err },
    )
  }

  const error = child(xml, 'error')

  if (error) {
    const code = text(error, 'code') ?? ''

    throw new SourceError(
      AUTH_ERROR_CODES.has(code) ? 'auth' : 'remote',
      `Torznab error ${code}: ${text(error, 'description') ?? 'unknown'}`,
    )
  }

  if (!res.ok)
    throw new SourceError('remote', `Source responded with ${res.status}`)

  return xml
}

/** Проверка индексатора: `t=caps` отвечает и без поиска, ключ проверяется */
export async function fetchCaps(
  baseUrl: string,
  apiKey?: string,
): Promise<TorznabCaps> {
  const res = await sourceGet(
    torznabRequestUrl(baseUrl, { t: 'caps' }, apiKey),
  )
  const caps = parseCaps(child(await readTorznabXml(res), 'caps'))

  if (!caps) {
    throw new SourceError(
      'bad_response',
      'Response is not Torznab capabilities',
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
  const length = Number(res.headers.get('content-length'))

  if (length > TORRENT_FILE_MAX_BYTES)
    throw new SourceError('bad_response', 'Torrent file is too large')

  let bytes: Uint8Array

  try {
    bytes = new Uint8Array(await res.arrayBuffer())
  }
  catch (err) {
    throw new SourceError(
      isTimeout(err) ? 'timeout' : 'unreachable',
      'Source response was interrupted',
      { cause: err },
    )
  }

  if (bytes.byteLength > TORRENT_FILE_MAX_BYTES)
    throw new SourceError('bad_response', 'Torrent file is too large')

  return bytes
}

/**
 * `.torrent` по ссылке индексатора. Индексаторы раздач только с magnet
 * отвечают на ссылку редиректом на `magnet:` — его и возвращаем.
 * Редиректы идут вручную: `fetch` не следует по схеме `magnet:`.
 */
export async function downloadTorrent(
  link: string,
  timeoutMs = SOURCE_TIMEOUT_MS,
): Promise<DownloadedTorrent> {
  let url = new URL(link)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response

    try {
      res = await netFetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    }
    catch (err) {
      throw new SourceError(
        isTimeout(err) ? 'timeout' : 'unreachable',
        isTimeout(err)
          ? 'Source did not respond in time'
          : 'Source is unreachable',
        { cause: err },
      )
    }

    const location = res.headers.get('location')

    if (res.status >= 300 && res.status < 400 && location) {
      if (location.startsWith('magnet:'))
        return { kind: 'magnet', magnet: location }

      url = new URL(location, url)

      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new SourceError('bad_response', 'Unexpected redirect')

      continue
    }

    if (res.status === 401 || res.status === 403)
      throw new SourceError('auth', 'Source rejected the API key')

    if (!res.ok)
      throw new SourceError('remote', `Source responded with ${res.status}`)

    const bytes = await readLimited(res)

    // Bencode-словарь начинается с `d`; страница с ошибкой — нет
    if (bytes[0] !== 0x64)
      throw new SourceError('bad_response', 'Response is not a torrent file')

    return { kind: 'file', bytes }
  }

  throw new SourceError('bad_response', 'Too many redirects')
}
