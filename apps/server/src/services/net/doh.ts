import type { LookupFunction } from 'node:net'
import type { NetRouteDns } from '../../db/schema.ts'
import { Buffer } from 'node:buffer'
import { lookup as systemLookup } from 'node:dns/promises'
import { Agent, fetch as undiciFetch } from 'undici'

export type DohProvider = Exclude<NetRouteDns, 'system' | 'custom'>

// Адреса по IP: запрос к самому DoH не зависит от системного DNS,
// который и может быть подменён. Сертификаты провайдеров выписаны и на IP
export const DOH_PROVIDERS: Record<DohProvider, { name: string, url: string }>
  = {
    quad9: { name: 'Quad9', url: 'https://9.9.9.9/dns-query' },
    google: { name: 'Google', url: 'https://8.8.8.8/dns-query' },
    cloudflare: { name: 'Cloudflare', url: 'https://1.1.1.1/dns-query' },
  }

const DOH_TIMEOUT_MS = 5000
// TTL записей бывает и 0, и сутки: держим в разумных пределах
const MIN_TTL_S = 30
const MAX_TTL_S = 3600

const TYPE_A = 1
const TYPE_AAAA = 28

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

/**
 * `unavailable` — DoH-провайдер не ответил или ответил не DNS-сообщением,
 * `not_found` — имени нет (NXDOMAIN или пустой ответ).
 */
export type DohErrorKind = 'unavailable' | 'not_found'

export class DohError extends Error {
  readonly kind: DohErrorKind
  // Код как у системного резолвера: undici и проверка хостов узнают ошибку DNS
  readonly code: string

  constructor(kind: DohErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DohError'
    this.kind = kind
    this.code = kind === 'not_found' ? 'ENOTFOUND' : 'EDOHUNAVAILABLE'
  }
}

export type DohSend = (
  url: string,
  init: { headers: Record<string, string>, signal: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  arrayBuffer: () => Promise<ArrayBuffer>
}>

const resolvers = new Map<string, DohResolver>()
let directAgent: Agent | undefined

const directSend: DohSend = (url, init) => {
  directAgent ??= new Agent()

  return undiciFetch(url, { ...init, dispatcher: directAgent })
}

let sharedSend = directSend

/** Тесты подменяют отправку запросов DoH у общих резолверов; `null` — настоящая */
export function setDohSend(send: DohSend | null) {
  sharedSend = send ?? directSend
  resolvers.clear()
}

const defaultSend: DohSend = (url, init) => sharedSend(url, init)

/** DNS-запрос RFC 1035 с ID 0 (RFC 8484 советует 0 — ответы лучше кэшируются) */
export function encodeQuery(host: string, type: number) {
  const labels = host.split('.').filter(Boolean)
  const name = Buffer.concat([
    ...labels.map((label) => {
      const bytes = Buffer.from(label, 'ascii')

      return Buffer.concat([Buffer.from([bytes.length]), bytes])
    }),
    Buffer.from([0]),
  ])
  const header = Buffer.from([0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0])
  const question = Buffer.alloc(4)

  question.writeUInt16BE(type, 0)
  question.writeUInt16BE(1, 2)

  return Buffer.concat([header, name, question])
}

function skipName(message: Buffer, start: number) {
  let offset = start

  while (offset < message.length) {
    const length = message[offset]!

    if ((length & 0xC0) === 0xC0)
      return offset + 2

    if (length === 0)
      return offset + 1

    offset += length + 1
  }

  throw new Error('DNS name runs past the message')
}

export interface DecodedAnswer {
  rcode: number
  addresses: ResolvedAddress[]
  ttl: number
}

/** Адреса A и AAAA из ответа; CNAME в цепочке пропускаются */
export function decodeAnswer(message: Buffer): DecodedAnswer {
  if (message.length < 12)
    throw new Error('DNS message is too short')

  const rcode = message.readUInt16BE(2) & 0x0F
  const questions = message.readUInt16BE(4)
  const answers = message.readUInt16BE(6)
  let offset = 12

  for (let i = 0; i < questions; i++) offset = skipName(message, offset) + 4

  const addresses: ResolvedAddress[] = []
  let ttl = MAX_TTL_S

  for (let i = 0; i < answers; i++) {
    offset = skipName(message, offset)

    if (offset + 10 > message.length)
      throw new Error('DNS answer runs past the message')

    const type = message.readUInt16BE(offset)
    const recordTtl = message.readUInt32BE(offset + 4)
    const length = message.readUInt16BE(offset + 8)
    const data = message.subarray(offset + 10, offset + 10 + length)

    offset += 10 + length

    if (data.length !== length)
      throw new Error('DNS record runs past the message')

    if (type === TYPE_A && length === 4) {
      addresses.push({ address: [...data].join('.'), family: 4 })
      ttl = Math.min(ttl, recordTtl)
    }
    else if (type === TYPE_AAAA && length === 16) {
      const groups = []

      for (let g = 0; g < 16; g += 2)
        groups.push(data.readUInt16BE(g).toString(16))

      addresses.push({ address: groups.join(':'), family: 6 })
      ttl = Math.min(ttl, recordTtl)
    }
  }

  return { rcode, addresses, ttl }
}

export interface DohResolver {
  url: string
  resolve: (host: string) => Promise<ResolvedAddress[]>
  lookup: LookupFunction
}

// Зоны локальной сети: публичный DoH их не знает
const LOCAL_SUFFIXES = [
  '.local',
  '.lan',
  '.home.arpa',
  '.internal',
  '.localhost',
]

/**
 * Имя без точки (сервис compose `prowlarr`, хост `nas`) или из локальной
 * зоны: его знает только системный DNS, как и при DoH в браузерах
 */
export function isLocalName(host: string) {
  const name = host.toLowerCase().replace(/\.$/, '')

  return (
    !name.includes('.')
    || LOCAL_SUFFIXES.some(suffix => name.endsWith(suffix))
  )
}

type SystemResolve = (host: string) => Promise<ResolvedAddress[]>

const defaultSystemResolve: SystemResolve = async host =>
  (await systemLookup(host, { all: true })).map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }))

/**
 * Резолвер RFC 8484 (wire-формат, GET): ответы кэшируются по TTL записей.
 * Локальные имена (`isLocalName`) уходят системному DNS.
 */
export function createDohResolver(
  url: string,
  send: DohSend = defaultSend,
  system: SystemResolve = defaultSystemResolve,
): DohResolver {
  const cache = new Map<
    string,
    { addresses: ResolvedAddress[], expiresAt: number }
  >()
  const pending = new Map<string, Promise<ResolvedAddress[]>>()

  async function query(host: string, type: number) {
    const target = new URL(url)

    target.searchParams.set(
      'dns',
      encodeQuery(host, type).toString('base64url'),
    )

    let res

    try {
      res = await send(target.href, {
        headers: { accept: 'application/dns-message' },
        signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
      })
    }
    catch (err) {
      throw new DohError('unavailable', 'DoH provider is unreachable', {
        cause: err,
      })
    }

    if (!res.ok) {
      throw new DohError(
        'unavailable',
        `DoH provider responded with ${res.status}`,
      )
    }

    try {
      return decodeAnswer(Buffer.from(await res.arrayBuffer()))
    }
    catch (err) {
      throw new DohError('unavailable', 'DoH provider sent a broken answer', {
        cause: err,
      })
    }
  }

  async function load(host: string) {
    const results = await Promise.allSettled([
      query(host, TYPE_A),
      query(host, TYPE_AAAA),
    ])
    const answers = results.flatMap(result =>
      result.status === 'fulfilled' ? [result.value] : [],
    )

    if (!answers.length)
      throw (results[0] as PromiseRejectedResult).reason

    const addresses = answers.flatMap(answer => answer.addresses)

    if (!addresses.length)
      throw new DohError('not_found', `${host} is not found`)

    const ttl = Math.min(
      ...answers.filter(a => a.addresses.length).map(a => a.ttl),
    )

    cache.set(host, {
      addresses,
      expiresAt:
        Date.now() + Math.min(MAX_TTL_S, Math.max(MIN_TTL_S, ttl)) * 1000,
    })

    return addresses
  }

  async function resolve(host: string) {
    if (isLocalName(host))
      return system(host)

    const cached = cache.get(host)

    if (cached && cached.expiresAt > Date.now())
      return cached.addresses

    let running = pending.get(host)

    if (!running) {
      running = load(host).finally(() => pending.delete(host))
      pending.set(host, running)
    }

    return running
  }

  const lookup: LookupFunction = (hostname, options, callback) => {
    resolve(hostname).then(
      (all) => {
        const wanted
          = options.family === 4 || options.family === 6
            ? all.filter(item => item.family === options.family)
            : all

        if (!wanted.length) {
          callback(
            new DohError('not_found', `${hostname} is not found`),
            '',
            0,
          )
          return
        }

        if (options.all)
          callback(null, wanted)
        else callback(null, wanted[0]!.address, wanted[0]!.family)
      },
      err => callback(err, '', 0),
    )
  }

  return { url, resolve, lookup }
}

/** Один резолвер (и его кэш) на адрес DoH */
export function dohResolverFor(url: string) {
  let resolver = resolvers.get(url)

  if (!resolver) {
    resolver = createDohResolver(url)
    resolvers.set(url, resolver)
  }

  return resolver
}
