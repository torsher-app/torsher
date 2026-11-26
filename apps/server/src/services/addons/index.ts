import type { HttpAddon } from '../../db/schema.ts'
import type { HttpAddonResource, HttpAddonType } from '../../dto/httpAddons.ts'
import {
  addonRevisionSignal,
  configuredManifestUrl,
  currentAddon,
  onAddonChanged,
  readAddonJson,
} from './config.ts'
import {
  addonResourceUrl,
  addonText,
  supportsAddonResource,
} from './manifest.ts'
import {
  AddonError,
  addonRequestHeaders,
  addonUrl,
  guardedAddonFetch,
} from './transport.ts'

export type { HttpAddon } from '../../db/schema.ts'
export type { HttpAddonResource, HttpAddonType } from '../../dto/httpAddons.ts'
export {
  addonRevisionSignal,
  currentAddon,
  listEnabledAddons,
  onAddonChanged,
} from './config.ts'
export { supportsAddonResource } from './manifest.ts'
export { AddonError, addonRequestHeaders } from './transport.ts'

const retryAt = new Map<string, number>()
const requests = new Map<
  string,
  {
    controller: AbortController
    promise: Promise<unknown>
    waiters: number
  }
>()

onAddonChanged((id) => {
  for (const resource of ['stream', 'catalog', 'subtitles'])
    retryAt.delete(`${id}:${resource}`)
})

function requestSignal(
  addon: HttpAddon,
  resource: HttpAddonResource,
  signal?: AbortSignal,
) {
  if (!currentAddon(addon.id, addon.revision, resource))
    throw new AddonError('not_found')
  const revision = addonRevisionSignal(addon)
  return signal ? AbortSignal.any([revision, signal]) : revision
}

function retryKey(addon: HttpAddon, resource: HttpAddonResource) {
  const key = `${addon.id}:${resource}`
  const until = retryAt.get(key)
  if (until && until > Date.now())
    throw new AddonError('rate_limited')
  if (until)
    retryAt.delete(key)
  return key
}

function rememberRetry(key: string, response: Response) {
  if (response.status !== 429)
    return

  const value = response.headers.get('retry-after')
  const now = Date.now()
  const delay
    = value && /^\d+$/.test(value)
      ? Number(value) * 1000
      : value
        ? Date.parse(value) - now
        : Number.NaN
  retryAt.set(
    key,
    now
    + Math.min(
      300_000,
      Math.max(1000, Number.isFinite(delay) ? delay : 30_000),
    ),
  )
}

function waitForResult(
  request: NonNullable<ReturnType<typeof requests.get>>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  request.waiters++
  let aborted: () => void
  return new Promise<unknown>((resolve, reject) => {
    aborted = () => reject(new AddonError('unavailable'))
    signal?.addEventListener('abort', aborted, { once: true })
    request.promise.then(resolve, reject)
  }).finally(() => {
    signal?.removeEventListener('abort', aborted)
    request.waiters--
    if (!request.waiters)
      request.controller.abort()
  })
}

export async function readAddonResource(
  addon: HttpAddon,
  resource: HttpAddonResource,
  type: HttpAddonType,
  id: string,
  options: {
    extra?: Record<string, string | number>
    signal?: AbortSignal
  } = {},
): Promise<unknown> {
  if (options.signal?.aborted)
    throw new AddonError('unavailable')
  const active = currentAddon(addon.id, addon.revision, resource)
  if (!active || !supportsAddonResource(active.manifest, resource, type, id))
    throw new AddonError('not_found')
  const catalog
    = resource === 'catalog'
      ? active.manifest.catalogs.find(
          row => row.type === type && row.id === id,
        )
      : undefined
  if (catalog && !active.selections.catalogs.includes(catalog.key))
    throw new AddonError('not_found')

  const extra
    = resource === 'catalog'
      ? catalog?.requiresSkip
        ? { skip: 0 }
        : undefined
      : resource === 'subtitles'
        ? options.extra
        : undefined

  const key = JSON.stringify([
    addon.id,
    addon.revision,
    resource,
    type,
    id,
    extra,
  ])
  const existing = requests.get(key)
  if (existing && !existing.controller.signal.aborted)
    return waitForResult(existing, options.signal)
  if (requests.size >= 24)
    throw new AddonError('busy')
  const controller = new AbortController()
  const signal = requestSignal(active, resource, controller.signal)
  const retry = retryKey(active, resource)
  const url = addonResourceUrl(
    configuredManifestUrl(active),
    resource,
    type,
    id,
    extra,
  )

  const entry = {
    controller,
    waiters: 0,
    promise: (async () => {
      const result = await guardedAddonFetch(url, active, {
        kind: 'json',
        signal,
      })
      if (!signal.aborted)
        rememberRetry(retry, result.response)
      const json = await readAddonJson(result, 1024 * 1024)
      if (signal.aborted)
        throw new AddonError('not_found')
      if (json && typeof json === 'object') {
        const property
          = resource === 'stream'
            ? 'streams'
            : resource === 'catalog'
              ? 'metas'
              : 'subtitles'
        const items = Object.getOwnPropertyDescriptor(json, property)?.value
        if (Array.isArray(items))
          return { [property]: items.slice(0, 100) }
      }
      throw new AddonError('bad_response')
    })().finally(() => {
      if (requests.get(key) === entry)
        requests.delete(key)
    }),
  }
  requests.set(key, entry)
  return waitForResult(entry, options.signal)
}

export async function fetchAddonAsset(
  addon: HttpAddon,
  resource: 'stream' | 'subtitles',
  url: string | URL,
  options: {
    headers?: ConstructorParameters<typeof Headers>[0]
    signal?: AbortSignal
    method?: 'GET' | 'HEAD'
  } = {},
) {
  const signal = requestSignal(addon, resource, options.signal)
  const retry = retryKey(addon, resource)
  const supplied = new Headers(options.headers)
  const serverHeaders = new Headers()
  for (const name of ['range', 'if-range', 'accept-encoding']) {
    const value = supplied.get(name)
    if (value !== null) {
      supplied.delete(name)
      serverHeaders.set(name, value)
    }
  }
  const headers = addonRequestHeaders(Object.fromEntries(supplied))
  for (const [name, value] of serverHeaders) headers.set(name, value)
  const result = await guardedAddonFetch(addonUrl(String(url)), addon, {
    kind: resource === 'stream' ? 'media' : 'subtitle',
    headers,
    signal,
    method: options.method,
  })
  if (signal.aborted) {
    await result.close()
    throw new AddonError('not_found')
  }
  rememberRetry(retry, result.response)
  return result
}

export function safeAddonText(
  addon: HttpAddon,
  value: string | undefined,
  options: { urls?: (string | URL)[], privateValues?: string[] } = {},
) {
  const urls = [configuredManifestUrl(addon)]
  const secrets = [...(options.privateValues ?? [])]
  for (const raw of options.urls ?? []) {
    try {
      urls.push(addonUrl(String(raw)))
    }
    catch {
      secrets.push(String(raw))
    }
  }
  const parts = secrets.flatMap(secret => secret.split(/[\s;=]+/g))
  return addonText(value, urls, [...secrets, ...parts])
}
