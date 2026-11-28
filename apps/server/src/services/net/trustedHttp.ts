import { Buffer } from 'node:buffer'
import type { FormData } from 'undici'
import { BlockList, isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import { Agent, buildConnector, fetch as undiciFetch } from 'undici'
import { config } from '../../config.ts'
import { normalizeHostname } from './address.ts'
import { netResolveDeps, routeForHost, usesEnvProxy } from './index.ts'

type TrustedHttpErrorKind
  = | 'invalid_url'
    | 'blocked_address'
    | 'unsupported_route'
    | 'unavailable'
    | 'needs_confirmation'
    | 'address_changed'
    | 'timeout'
    | 'busy'

export class TrustedHttpError extends Error {
  readonly kind: TrustedHttpErrorKind

  constructor(kind: TrustedHttpErrorKind) {
    super(kind)
    this.name = 'TrustedHttpError'
    this.kind = kind
  }
}

function safeError(error: unknown, signal: AbortSignal) {
  if (error instanceof TrustedHttpError)
    return error
  if (error instanceof Error && error.cause instanceof TrustedHttpError)
    return error.cause
  return new TrustedHttpError(
    signal.reason?.name === 'TimeoutError' ? 'timeout' : 'unavailable',
  )
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

export interface TrustedHttpPolicy {
  origin: string
  lanAddresses: string[]
  confirmedAddresses?: string[]
}

export function trustedUrl(input: string) {
  const authority = /^https?:\/\/([^/?#]+)/i.exec(input)?.[1]
  if (
    !authority
    || authority.includes('@')
    || /[\\#\s\p{Cc}\p{Cf}]/u.test(input)
  ) {
    throw new TrustedHttpError('invalid_url')
  }
  let url: URL
  try {
    url = new URL(input)
  }
  catch {
    throw new TrustedHttpError('invalid_url')
  }
  if (!url.hostname || url.username || url.password || url.port === '0')
    throw new TrustedHttpError('invalid_url')
  return url
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
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
    throw new TrustedHttpError('blocked_address')

  const route = routeForHost(hostname)
  if (route.via !== 'direct' || usesEnvProxy(route))
    throw new TrustedHttpError('unsupported_route')

  const addresses = isIP(hostname)
    ? [hostname]
    : await abortable(netResolveDeps.routeAddresses(hostname), signal)
  if (!addresses?.length)
    throw new TrustedHttpError('unavailable')
  const latestRoute = routeForHost(hostname)
  if (latestRoute.via !== 'direct' || usesEnvProxy(latestRoute))
    throw new TrustedHttpError('unsupported_route')
  if (
    latestRoute.id !== route.id
    || latestRoute.updatedAt.getTime() !== route.updatedAt.getTime()
  ) {
    throw new TrustedHttpError('unavailable')
  }
  const canonical = [...new Set(addresses.map(canonicalIp))].sort()
  const local = selfAddresses()
  const scopes = new Set(
    canonical.map(address =>
      local.has(address) ? 'blocked' : addressScope(address),
    ),
  )
  if (canonical.length > 32 || scopes.has('blocked') || scopes.size !== 1)
    throw new TrustedHttpError('blocked_address')
  return { addresses: canonical, private: scopes.has('private') }
}

/** Предпросмотр DNS для owner API, без HTTP-запроса. */
export async function previewTrustedAddress(url: URL) {
  const signal = AbortSignal.timeout(5000)
  try {
    const target = await resolvedAddresses(url, signal)
    if (url.protocol !== 'https:' && !target.private)
      throw new TrustedHttpError('blocked_address')
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

export async function allowedTrustedAddresses(
  url: URL,
  policy: TrustedHttpPolicy,
  crossedOrigin: boolean,
  signal: AbortSignal,
) {
  const target = await resolvedAddresses(url, signal)
  if (policy.confirmedAddresses && !sameAddresses(target.addresses, policy.confirmedAddresses))
    throw new TrustedHttpError('address_changed')
  if (target.private) {
    if (crossedOrigin || url.origin !== policy.origin)
      throw new TrustedHttpError('blocked_address')
    if (!policy.lanAddresses.length)
      throw new TrustedHttpError('needs_confirmation')
    if (!sameAddresses(target.addresses, policy.lanAddresses))
      throw new TrustedHttpError('address_changed')
  }
  else if (url.origin === policy.origin && policy.lanAddresses.length) {
    throw new TrustedHttpError('address_changed')
  }
  else if (url.protocol !== 'https:') {
    throw new TrustedHttpError('blocked_address')
  }
  return target.addresses
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
        callback(new TrustedHttpError('blocked_address'), '', 0)
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
          callback(new TrustedHttpError('blocked_address'), null)
          return
        }
        callback(null, socket)
      })
    },
  })
}

type SendPinned = (
  url: URL,
  addresses: string[],
  options: {
    method: 'GET' | 'HEAD' | 'POST'
    headers: Headers
    signal: AbortSignal
    body?: FormData | Uint8Array | string
  },
) => Promise<{ response: Response, destroy: () => Promise<void> }>

export const sendPinned: SendPinned = async (
  url,
  addresses,
  { method, headers, signal, body },
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
      body: body instanceof Uint8Array ? Buffer.from(body) : body,
    })
    return { response: response as unknown as Response, destroy }
  }
  catch (error) {
    await destroy()
    throw error
  }
}

export const trustedHttpDeps = { send: sendPinned }

let requests = 0

/** A single guarded hop. Call close after consuming or discarding the body. */
export async function trustedHttpRequest(
  input: URL,
  policy: TrustedHttpPolicy,
  options: {
    method?: 'GET' | 'POST'
    headers?: RequestInit['headers']
    body?: FormData | Uint8Array | string
    signal?: AbortSignal
  } = {},
) {
  if (requests >= 24)
    throw new TrustedHttpError('busy')
  requests++
  const deadline = AbortSignal.timeout(8000)
  const signal = options.signal
    ? AbortSignal.any([deadline, options.signal])
    : deadline

  try {
    const url = trustedUrl(input.href)
    if (url.origin !== policy.origin)
      throw new TrustedHttpError('blocked_address')
    const addresses = await allowedTrustedAddresses(url, policy, false, signal)
    signal.throwIfAborted()
    const { response, destroy } = await trustedHttpDeps.send(url, addresses, {
      method: options.method ?? 'GET',
      headers: new Headers(options.headers),
      signal,
      body: options.body,
    })
    let closed = false
    return {
      response,
      async close() {
        if (closed)
          return
        closed = true
        try {
          await destroy()
        }
        finally {
          requests--
        }
      },
    }
  }
  catch (error) {
    requests--
    throw safeError(error, signal)
  }
}
