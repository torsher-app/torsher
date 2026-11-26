import type { HttpAddonErrorKind } from '../../dto/httpAddons.ts'
import { BlockList, isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import { Agent, buildConnector, fetch as undiciFetch } from 'undici'
import { config } from '../../config.ts'
import { netResolveDeps, routeForHost, usesEnvProxy } from '../net/index.ts'
import { normalizeHostname } from '../net/address.ts'
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

const privateIps = new BlockList()
privateIps.addSubnet('10.0.0.0', 8, 'ipv4')
privateIps.addSubnet('172.16.0.0', 12, 'ipv4')
privateIps.addSubnet('192.168.0.0', 16, 'ipv4')
privateIps.addSubnet('fc00::', 7, 'ipv6')

const reservedIps = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  reservedIps.addSubnet(network, prefix, 'ipv4')
}
reservedIps.addAddress('168.63.129.16', 'ipv4')
reservedIps.addSubnet('2001::', 23, 'ipv6')
reservedIps.addSubnet('2001:db8::', 32, 'ipv6')
reservedIps.addSubnet('2002::', 16, 'ipv6')
reservedIps.addSubnet('3fff::', 20, 'ipv6')
reservedIps.addAddress('fd00:ec2::254', 'ipv6')

const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')

function canonicalIp(value: string) {
  const address = normalizeHostname(value)
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address)
  if (!mapped)
    return address
  const high = Number.parseInt(mapped[1]!, 16)
  const low = Number.parseInt(mapped[2]!, 16)
  return `${high >> 8}.${high & 0xFF}.${low >> 8}.${low & 0xFF}`
}

function addressScope(address: string) {
  const version = isIP(address)
  if (!version)
    return 'blocked'
  const family = version === 4 ? 'ipv4' : 'ipv6'
  if (reservedIps.check(address, family))
    return 'blocked'
  if (privateIps.check(address, family))
    return 'private'
  return version === 4 || globalV6.check(address, 'ipv6')
    ? 'public'
    : 'blocked'
}

export interface AddonNetworkPolicy {
  origin: string
  lanAddresses: string[]
}

export function addonUrl(input: string) {
  const authority = /^https?:\/\/([^/?#]+)/i.exec(input)?.[1]
  if (
    !authority
    || authority.includes('@')
    || /[\\#\s\p{Cc}\p{Cf}]/u.test(input)
  ) {
    throw new AddonError('invalid_url')
  }
  let url: URL
  try {
    url = new URL(input)
  }
  catch {
    throw new AddonError('invalid_url')
  }
  if (!url.hostname || url.username || url.password || url.port === '0')
    throw new AddonError('invalid_url')
  return url
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted)
      abort()
    else signal.addEventListener('abort', abort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

function selfAddresses() {
  const addresses = Object.values(networkInterfaces()).flatMap(
    items => items?.map(info => info.address) ?? [],
  )
  if (isIP(config.host))
    addresses.push(config.host)
  return new Set(addresses.map(canonicalIp))
}

async function resolvedAddresses(url: URL, signal: AbortSignal) {
  signal.throwIfAborted()
  const hostname = normalizeHostname(url.hostname)
  const localName
    = hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === 'metadata'
      || hostname.startsWith('metadata.')
      || hostname === normalizeHostname(config.host)
  const clientHost
    = config.clientUrl && URL.canParse(config.clientUrl)
      ? normalizeHostname(new URL(config.clientUrl).hostname)
      : undefined
  if (localName || hostname === clientHost)
    throw new AddonError('blocked_address')

  const route = routeForHost(hostname)
  if (route.via !== 'direct' || usesEnvProxy(route))
    throw new AddonError('unsupported_route')

  const addresses = isIP(hostname)
    ? [hostname]
    : await abortable(netResolveDeps.routeAddresses(hostname), signal)
  if (!addresses?.length)
    throw new AddonError('unavailable')
  const latestRoute = routeForHost(hostname)
  if (latestRoute.via !== 'direct' || usesEnvProxy(latestRoute))
    throw new AddonError('unsupported_route')
  if (
    latestRoute.id !== route.id
    || latestRoute.updatedAt.getTime() !== route.updatedAt.getTime()
  ) {
    throw new AddonError('unavailable')
  }
  const canonical = [...new Set(addresses.map(canonicalIp))].sort()
  const local = selfAddresses()
  const scopes = new Set(
    canonical.map(address =>
      local.has(address) ? 'blocked' : addressScope(address),
    ),
  )
  if (canonical.length > 32 || scopes.has('blocked') || scopes.size !== 1)
    throw new AddonError('blocked_address')
  return { addresses: canonical, private: scopes.has('private') }
}

/** Предпросмотр DNS для owner API. Не выполняет HTTP-запрос к аддону. */
export async function previewAddonAddress(url: URL) {
  const signal = AbortSignal.timeout(5000)
  try {
    const target = await resolvedAddresses(url, signal)
    if (url.protocol !== 'https:' && !target.private)
      throw new AddonError('blocked_address')
    return target
  }
  catch (error) {
    throw safeError(error, signal)
  }
}

function sameAddresses(a: string[], b: string[]) {
  return (
    a.length === b.length && a.every((address, index) => address === b[index])
  )
}

async function allowedAddresses(
  url: URL,
  policy: AddonNetworkPolicy,
  crossedOrigin: boolean,
  signal: AbortSignal,
) {
  const target = await resolvedAddresses(url, signal)
  if (target.private) {
    if (crossedOrigin || url.origin !== policy.origin)
      throw new AddonError('blocked_address')
    if (!policy.lanAddresses.length)
      throw new AddonError('needs_confirmation')
    if (!sameAddresses(target.addresses, policy.lanAddresses))
      throw new AddonError('address_changed')
  }
  else if (url.origin === policy.origin && policy.lanAddresses.length) {
    throw new AddonError('address_changed')
  }
  else if (url.protocol !== 'https:') {
    throw new AddonError('blocked_address')
  }
  return target.addresses
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

function pinnedAgent(addresses: string[]) {
  const connector = buildConnector({
    timeout: 5000,
    // Node перебирает адреса только из проверенного набора в lookup.
    autoSelectFamily: true,
    lookup: (_hostname, options, callback) => {
      const pinned = addresses.filter(
        address => !options.family || isIP(address) === options.family,
      )
      const address = pinned[0]
      if (!address) {
        callback(new AddonError('blocked_address'), '', 0)
      }
      else if (options.all) {
        callback(
          null,
          pinned.map(address => ({ address, family: isIP(address) })),
        )
      }
      else {
        callback(null, address, isIP(address))
      }
    },
  })
  return new Agent({
    connect(options, callback) {
      connector(options, (error, socket) => {
        if (error) {
          callback(error, null)
          return
        }
        if (
          !socket.remoteAddress
          || !addresses.includes(canonicalIp(socket.remoteAddress))
        ) {
          socket.destroy()
          callback(new AddonError('blocked_address'), null)
          return
        }
        callback(null, socket)
      })
    },
  })
}

type Send = (
  url: URL,
  addresses: string[],
  options: { method: 'GET' | 'HEAD', headers: Headers, signal: AbortSignal },
) => Promise<{ response: Response, destroy: () => Promise<void> }>

const sendPinned: Send = async (
  url,
  addresses,
  { method, headers, signal },
) => {
  const agent = pinnedAgent(addresses)
  const destroy = async () => {
    await agent.destroy().catch(() => {})
  }
  try {
    const response = await undiciFetch(url, {
      dispatcher: agent,
      redirect: 'manual',
      headers: Object.fromEntries(headers),
      method,
      signal,
    })
    return { response: response as unknown as Response, destroy }
  }
  catch (error) {
    await destroy()
    throw error
  }
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
      const addresses = await allowedAddresses(
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
