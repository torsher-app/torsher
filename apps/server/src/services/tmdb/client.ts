import { logFor } from '../logs/index.ts'
import { netFetch } from '../net/index.ts'
import { SecretError } from '../secrets/index.ts'
import {
  currentTmdbKey,
  markTmdbKeyRejected,
  tmdbAuth,
} from './credentials.ts'

export const TMDB_API_ORIGIN = 'https://api.themoviedb.org'
export const TMDB_IMAGE_ORIGIN = 'https://image.tmdb.org'

const API_URL = `${TMDB_API_ORIGIN}/3`
const IMAGE_URL = `${TMDB_IMAGE_ORIGIN}/t/p`
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
    return await netFetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
  }
  catch (err) {
    throw new TmdbError('unavailable', 'TMDB is unreachable', { cause: err })
  }
}

function keyOrThrow() {
  let key

  try {
    key = currentTmdbKey()
  }
  catch (err) {
    if (!(err instanceof SecretError))
      throw err

    throw new TmdbError(
      'config',
      'Stored TMDB key cannot be decrypted, enter it again',
      { cause: err },
    )
  }

  if (!key) {
    throw new TmdbError(
      'config',
      'TMDB access token is not configured on the server',
    )
  }

  return key
}

/** `key` — проверить ключ до сохранения; иначе текущий ключ сервера */
export async function tmdbGet<T>(
  path: string,
  params: Record<string, string>,
  key?: string,
): Promise<T> {
  // Ответ на ключ сервера — признак для «Обзора»; проверка чужого ключа его не меняет
  const serverKey = key === undefined
  const auth = tmdbAuth(key ?? keyOrThrow())
  const url = new URL(`${API_URL}${path}`)

  for (const [name, value] of Object.entries({ ...params, ...auth.params }))
    url.searchParams.set(name, value)

  const res = await send(url.href, API_TIMEOUT_MS, {
    ...auth.headers,
    Accept: 'application/json',
  })

  // 404 и 5xx о ключе ничего не говорят
  if (serverKey && (res.ok || res.status === 401)) {
    const rejected = res.status === 401

    // Только при смене: иначе каждый запрос каталога повторял бы запись
    if (markTmdbKeyRejected(rejected) && rejected)
      logFor('catalog').error('TMDB key rejected')
  }

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

export type TmdbKeyCheck
  = | { ok: true, kind: null }
    | { ok: false, kind: 'rejected' | 'unavailable' | 'missing' }

/** Проверка ключа запросом `/configuration`: он отвечает с любым ключом */
export async function checkTmdbKey(key?: string): Promise<TmdbKeyCheck> {
  try {
    await tmdbGet('/configuration', {}, key)

    return { ok: true, kind: null }
  }
  catch (err) {
    if (!(err instanceof TmdbError))
      throw err

    if (err.kind === 'unavailable' || err.kind === 'not_found')
      return { ok: false, kind: 'unavailable' }

    return {
      ok: false,
      kind: !key && !currentKeySafe() ? 'missing' : 'rejected',
    }
  }
}

function currentKeySafe() {
  try {
    return currentTmdbKey()
  }
  catch {
    // Нерасшифровываемый ключ есть, но не принят
    return 'unreadable'
  }
}
