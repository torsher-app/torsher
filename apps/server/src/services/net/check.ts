import type { NetRoute } from '../../db/schema.ts'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { performance } from 'node:perf_hooks'
import { Agent, fetch as undiciFetch } from 'undici'
import { listIndexers, listManagers } from '../indexers/index.ts'
import { logFor } from '../logs/index.ts'
import { TMDB_API_ORIGIN, TMDB_IMAGE_ORIGIN } from '../tmdb/client.ts'
import { dohUrlOf, usesEnvProxy } from './dispatchers.ts'
import { DOH_PROVIDERS, dohResolverFor } from './doh.ts'
import { DEFAULT_MATCH } from './match.ts'
import { currentRoutes, netFetch, routeForHost } from './index.ts'

// Меньше таймаута API-клиента панели: проверка одного хоста укладывается в ответ
export const CHECK_TIMEOUT_MS = 8000
const CHECK_CONCURRENCY = 6
// С системным DNS сравнивать не с чем: берём DoH по умолчанию
const REFERENCE_DOH = DOH_PROVIDERS.quad9.url

export type HostKind = 'tmdb' | 'tmdb_images' | 'manager' | 'indexer'

/**
 * `dns` — имя не разрешилось, `doh` — не ответил DoH-провайдер маршрута,
 * `timeout` — нет ответа за срок, `refused` — соединение не установлено
 * (в том числе прокси), `tls` — сертификат не тот, `http` — сервер ответил 5xx.
 */
export type HostStatus
  = 'ok' | 'dns' | 'doh' | 'timeout' | 'refused' | 'tls' | 'http'

export interface CheckTarget {
  /** origin адреса: по нему же хост проверяется отдельно */
  id: string
  kind: HostKind
  label: string
  url: string
  hostname: string
}

export interface HostResult {
  status: HostStatus
  httpStatus: number | null
  latencyMs: number
  /** Системный DNS и DoH дали разные адреса, а запрос по системному не прошёл */
  dnsSpoofed: boolean
  checkedAt: Date
}

export function checkTargets(): CheckTarget[] {
  const sources: Omit<CheckTarget, 'id' | 'hostname'>[] = [
    {
      kind: 'tmdb',
      label: 'TMDB API',
      url: `${TMDB_API_ORIGIN}/3/configuration`,
    },
    { kind: 'tmdb_images', label: 'TMDB images', url: `${TMDB_IMAGE_ORIGIN}/` },
    ...listManagers().map(manager => ({
      kind: 'manager' as const,
      label: manager.kind === 'prowlarr' ? 'Prowlarr' : 'Jackett',
      url: manager.url,
    })),
    ...listIndexers()
      .filter(indexer => !indexer.managerId)
      .map(indexer => ({
        kind: 'indexer' as const,
        label: indexer.name,
        url: indexer.url,
      })),
  ]
  const targets = new Map<string, CheckTarget>()

  for (const source of sources) {
    const url = new URL(source.url)

    if (!targets.has(url.origin)) {
      targets.set(url.origin, {
        ...source,
        id: url.origin,
        hostname: url.hostname,
      })
    }
  }

  return [...targets.values()]
}

function errorCodes(err: unknown, seen = new Set<unknown>()): string[] {
  if (!err || typeof err !== 'object' || seen.has(err))
    return []

  seen.add(err)

  const codes: string[] = []

  if ('code' in err && typeof err.code === 'string')
    codes.push(err.code)

  if ('name' in err && typeof err.name === 'string')
    codes.push(err.name)

  if (err instanceof AggregateError)
    codes.push(...err.errors.flatMap(inner => errorCodes(inner, seen)))

  if ('cause' in err)
    codes.push(...errorCodes(err.cause, seen))

  return codes
}

const DNS_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'EAI_NONAME',
  'EAI_NODATA',
])
const TIMEOUT_CODES = new Set([
  'TimeoutError',
  'AbortError',
  'UND_ERR_CONNECT_TIMEOUT',
  'ETIMEDOUT',
])
const TLS_CODE
  = /^(?:ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_)/

export function statusOfError(err: unknown): HostStatus {
  const codes = errorCodes(err)

  if (codes.includes('EDOHUNAVAILABLE'))
    return 'doh'

  if (codes.some(code => DNS_CODES.has(code)))
    return 'dns'

  if (codes.some(code => TIMEOUT_CODES.has(code)))
    return 'timeout'

  if (codes.some(code => TLS_CODE.test(code)))
    return 'tls'

  return 'refused'
}

let systemAgent: Agent | undefined

/** Сравнение DNS и запрос мимо маршрута: тесты подменяют их через `vi.spyOn` */
export const checkDeps = {
  async systemAddresses(hostname: string) {
    const all = await lookup(hostname, { all: true })

    return all.map(item => item.address)
  },
  async dohAddresses(dohUrl: string, hostname: string) {
    const all = await dohResolverFor(dohUrl).resolve(hostname)

    return all.map(item => item.address)
  },
  /** Запрос напрямую с системным DNS: прошёл бы он без DoH маршрута */
  async probeSystem(url: string) {
    systemAgent ??= new Agent()

    try {
      const res = await undiciFetch(url, {
        redirect: 'manual',
        dispatcher: systemAgent,
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      })

      await res.body?.cancel()

      return res.status < 500
    }
    catch {
      return false
    }
  },
}

function referenceDoh(route: NetRoute) {
  const own = dohUrlOf(route)

  if (own)
    return own

  const fallback = currentRoutes().find(item => item.match === DEFAULT_MATCH)

  return (
    (fallback && fallback.via === 'direct' && dohUrlOf(fallback))
    || REFERENCE_DOH
  )
}

async function detectSpoofing(
  target: CheckTarget,
  route: NetRoute,
  status: HostStatus,
) {
  // Через прокси имя разрешает прокси, IP разрешать нечего
  if (
    route.via !== 'direct'
    || usesEnvProxy(route)
    || isIP(target.hostname.replace(/^\[|\]$/g, ''))
  ) {
    return false
  }

  const [system, doh] = await Promise.allSettled([
    checkDeps.systemAddresses(target.hostname),
    checkDeps.dohAddresses(referenceDoh(route), target.hostname),
  ])

  if (doh.status !== 'fulfilled' || !doh.value.length)
    return false

  const systemSet = system.status === 'fulfilled' ? system.value : []

  // Адреса CDN у разных резолверов законно разные: подмена — только если
  // адреса не пересекаются и запрос по системным не проходит
  if (systemSet.some(address => doh.value.includes(address)))
    return false

  if (route.dns === 'system')
    return status !== 'ok'

  return !(await checkDeps.probeSystem(target.url))
}

export async function checkTarget(target: CheckTarget): Promise<HostResult> {
  const route = routeForHost(target.hostname)
  const started = performance.now()
  let status: HostStatus
  let httpStatus: number | null = null

  try {
    const res = await netFetch(target.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })

    await res.body?.cancel()
    httpStatus = res.status
    // Ответ без ключа (401) или с редиректом — хост доступен
    status = res.status >= 500 ? 'http' : 'ok'
  }
  catch (err) {
    status = statusOfError(err)
  }

  const latencyMs = Math.round(performance.now() - started)

  return {
    status,
    httpStatus,
    latencyMs,
    dnsSpoofed: await detectSpoofing(target, route, status),
    checkedAt: new Date(),
  }
}

const results = new Map<string, HostResult>()
const checking = new Set<string>()
let run: { done: number, total: number, finishedAt: Date | null } = {
  done: 0,
  total: 0,
  finishedAt: null,
}

export interface HostState extends CheckTarget {
  route: NetRoute
  checking: boolean
  result: HostResult | null
}

export interface CheckState {
  running: boolean
  done: number
  total: number
  finishedAt: Date | null
  hosts: HostState[]
}

export function checkState(): CheckState {
  const hosts = checkTargets().map(target => ({
    ...target,
    route: routeForHost(target.hostname),
    checking: checking.has(target.id),
    result: results.get(target.id) ?? null,
  }))

  return {
    running: run.done < run.total,
    done: run.done,
    total: run.total,
    finishedAt: run.finishedAt,
    hosts,
  }
}

/** Как «Обзор» видит хост: подмена DNS — точнее простой недоступности */
function problemOf(result: HostResult | undefined) {
  if (!result || result.status === 'ok')
    return undefined

  return result.dnsSpoofed ? 'dns_spoofed' : result.status
}

// Фоновая проверка идёт каждые полчаса: пишется только смена состояния
function logHostChange(
  target: CheckTarget,
  previous: HostResult | undefined,
  next: HostResult,
) {
  const before = problemOf(previous)
  const after = problemOf(next)
  const fields = { host: target.hostname, hostKind: target.kind }

  if (after && after !== before) {
    logFor('network').warn(
      { ...fields, status: next.status, httpStatus: next.httpStatus },
      after === 'dns_spoofed' ? 'DNS spoofing detected' : 'Host unreachable',
    )
  }
  else if (!after && before) {
    logFor('network').info(fields, 'Host is reachable again')
  }
}

async function checkOne(target: CheckTarget) {
  checking.add(target.id)

  try {
    const result = await checkTarget(target)

    logHostChange(target, results.get(target.id), result)
    results.set(target.id, result)
  }
  finally {
    checking.delete(target.id)
  }
}

/**
 * Проверка идёт на сервере после ответа: панель опрашивает `checkState`.
 * Повторный запуск во время проверки всех хостов ничего не меняет.
 */
export function startCheck(id?: string) {
  const targets = checkTargets()

  if (id) {
    const target = targets.find(item => item.id === id)

    if (!target)
      return false

    if (!checking.has(id))
      void checkOne(target).catch(() => {})

    return true
  }

  if (run.done < run.total)
    return true

  run = { done: 0, total: targets.length, finishedAt: null }

  const queue = [...targets]
  const current = run

  const worker = async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      try {
        await checkOne(target)
      }
      finally {
        current.done++
      }
    }
  }

  // Сбой одного хоста (например, базы маршрутов) не оставляет проверку «идущей»
  void Promise.allSettled(
    Array.from({ length: Math.min(CHECK_CONCURRENCY, queue.length) }, worker),
  ).then(() => {
    current.finishedAt = new Date()
  })

  return true
}

/** Ждать конца проверки — для тестов */
export async function waitForCheck() {
  while (run.done < run.total || checking.size)
    await new Promise(resolve => setTimeout(resolve, 5))
}
