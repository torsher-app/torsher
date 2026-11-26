import type { HttpAddonErrorKind } from '../../dto/httpAddons.ts'
import type { TrustedHttpPolicy } from '../net/trustedHttp.ts'
import {
  abortable,
  allowedTrustedAddresses,
  previewTrustedAddress,
  sendPinned,
  TrustedHttpError,
  trustedUrl,
} from '../net/trustedHttp.ts'
import { isSessionCookie } from '../torznab/cookie.ts'

export class AddonError extends Error {
  readonly kind: HttpAddonErrorKind

  constructor(kind: HttpAddonErrorKind) {
    // Причина безопасна для журнала и клиента. Не сохраняем URL и upstream cause.
    super(kind)
    this.name = 'AddonError'
    this.kind = kind
  }
}

export type AddonNetworkPolicy = TrustedHttpPolicy

export function addonUrl(input: string) {
  try {
    return trustedUrl(input)
  }
  catch (error) {
    if (error instanceof TrustedHttpError)
      throw new AddonError(error.kind)
    throw error
  }
}

export async function previewAddonAddress(url: URL) {
  try {
    return await previewTrustedAddress(url)
  }
  catch (error) {
    if (error instanceof TrustedHttpError)
      throw new AddonError(error.kind)
    throw error
  }
}

const REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'referer',
  'user-agent',
])
const SERVER_HEADERS = new Set(['range', 'if-range', 'accept-encoding'])

/** Проверяем только запрошенные провайдером заголовки, до создания кандидата. */
export function addonRequestHeaders(input: Record<string, string>) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(input)) {
    const name = key.toLowerCase()
    if (
      !REQUEST_HEADERS.has(name)
      || headers.has(name)
      || !value.trim()
      || value.length > 8192
      || /[^\x20-\x7E]/.test(value)
      || (name === 'cookie' && !isSessionCookie(value))
    ) {
      throw new AddonError('bad_response')
    }
    if (name === 'referer')
      addonUrl(value)
    headers.set(name, value)
  }
  return headers
}

export const addonTransportDeps = {
  send: sendPinned,
}

interface FetchOptions {
  kind: 'json' | 'subtitle' | 'media'
  headers?: ConstructorParameters<typeof Headers>[0]
  signal?: AbortSignal
  method?: 'GET' | 'HEAD'
}

export interface AddonAsset {
  response: Response
  /** Только сервер, например для идентичности Range после редиректа. */
  url: string
  close: () => Promise<void>
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])
let metadataRequests = 0
let mediaRequests = 0

function safeError(error: unknown, signal: AbortSignal) {
  if (error instanceof AddonError)
    return error
  if (error instanceof TrustedHttpError)
    return new AddonError(error.kind)
  if (error instanceof Error && error.cause instanceof TrustedHttpError)
    return new AddonError(error.cause.kind)
  if (error instanceof Error && error.cause instanceof AddonError)
    return error.cause
  return new AddonError(
    signal.reason?.name === 'TimeoutError' ? 'timeout' : 'unavailable',
  )
}

function idleStream(response: Response, close: () => Promise<void>) {
  if (!response.body)
    return response
  const reader = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await abortable(
          reader.read(),
          AbortSignal.timeout(15000),
        )
        if (result.done)
          controller.close()
        else controller.enqueue(result.value)
      }
      catch {
        controller.error(new AddonError('unavailable'))
        await close()
      }
    },
    cancel: close,
  })
  return new Response(body, {
    status: response.status,
    headers: response.headers,
  })
}

/**
 * Один проверенный сокет на hop, без пула между запросами и политиками.
 * Вызывающий закрывает результат в finally после чтения/отмены тела.
 */
export async function guardedAddonFetch(
  input: URL,
  policy: AddonNetworkPolicy,
  options: FetchOptions,
): Promise<AddonAsset> {
  const media = options.kind === 'media'
  if (media ? mediaRequests >= 32 : metadataRequests >= 24)
    throw new AddonError('busy')
  if (media)
    mediaRequests++
  else metadataRequests++

  const deadline = new AbortController()
  const timer = setTimeout(
    () => {
      deadline.abort(
        new DOMException('Addon request timed out', 'TimeoutError'),
      )
    },
    media ? 8000 : 5000,
  )
  timer.unref()
  const signal = options.signal
    ? AbortSignal.any([deadline.signal, options.signal])
    : deadline.signal
  let released = false
  const release = () => {
    if (released)
      return
    released = true
    clearTimeout(timer)
    if (media)
      mediaRequests--
    else metadataRequests--
  }

  try {
    let url = addonUrl(input.href)
    let crossedOrigin = url.origin !== policy.origin
    const headers = new Headers(options.headers)
    if (media)
      headers.set('accept-encoding', 'identity')
    for (const name of headers.keys()) {
      if (!REQUEST_HEADERS.has(name) && !SERVER_HEADERS.has(name))
        throw new AddonError('bad_response')
    }
    for (let hop = 0; ; hop++) {
      const addresses = await allowedTrustedAddresses(
        url,
        policy,
        crossedOrigin,
        signal,
      )
      signal.throwIfAborted()
      const { response, destroy } = await addonTransportDeps.send(
        url,
        addresses,
        {
          headers: new Headers(headers),
          signal,
          method: options.method ?? 'GET',
        },
      )
      if (!REDIRECTS.has(response.status)) {
        if (media)
          clearTimeout(timer)
        const close = async () => {
          release()
          deadline.abort()
          await destroy()
        }
        return {
          response: media ? idleStream(response, close) : response,
          close,
          url: url.href,
        }
      }

      const location = response.headers.get('location')
      await destroy()
      if (hop >= 2 || !location)
        throw new AddonError('bad_response')
      let next: URL
      try {
        if (/[\\#\s\p{Cc}]/u.test(location))
          throw new AddonError('invalid_url')
        next = addonUrl(new URL(location, url).href)
      }
      catch {
        throw new AddonError('bad_response')
      }
      if (next.origin !== url.origin) {
        if (options.kind === 'json')
          throw new AddonError('blocked_address')
        crossedOrigin = true
        for (const name of REQUEST_HEADERS) headers.delete(name)
      }
      url = next
    }
  }
  catch (error) {
    release()
    throw safeError(error, signal)
  }
}
