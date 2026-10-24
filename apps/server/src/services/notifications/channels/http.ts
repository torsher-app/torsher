import { netFetch } from '../../net/index.ts'
import { DeliveryError } from './types.ts'

const TIMEOUT_MS = 10_000

function retryAfterOf(response: Response) {
  const value = response.headers.get('retry-after')

  if (!value)
    return undefined

  const seconds = Number(value)

  if (Number.isFinite(seconds))
    return Math.max(0, seconds * 1000)

  const at = Date.parse(value)

  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now())
}

/** Статус ответа сервиса — в вид ошибки, понятный панели */
export function errorOfStatus(response: Response, retryAfterMs?: number) {
  const { status } = response
  const message = `Channel responded ${status}`

  if (status === 401 || status === 403)
    return new DeliveryError('unauthorized', message, { status })

  if (status === 404)
    return new DeliveryError('not_found', message, { status })

  if (status === 429) {
    return new DeliveryError('rate_limited', message, {
      status,
      retryAfterMs: retryAfterMs ?? retryAfterOf(response),
    })
  }

  return status >= 500
    ? new DeliveryError('unavailable', message, { status })
    : new DeliveryError('invalid_response', message, { status })
}

/**
 * Запрос канала через маршруты сети. Сетевая ошибка не пересказывает
 * причину undici: в ней бывает адрес, а адрес у каналов — секрет.
 */
export async function channelFetch(url: string, init: RequestInit) {
  try {
    return await netFetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }
  catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError'

    throw new DeliveryError(
      'unavailable',
      timeout ? 'Channel timed out' : 'Channel is unreachable',
    )
  }
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const response = await channelFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

  if (!response.ok)
    throw errorOfStatus(response)

  return response
}

/** `https://host` или `https://host/base` без хвоста: каналы дописывают свой путь */
export function baseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}
