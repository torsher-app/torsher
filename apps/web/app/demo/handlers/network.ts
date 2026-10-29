import type {
  AttentionItem,
  CreateNetRouteInput,
  DnsProviderList,
  MessageResponse,
  NetCheckState,
  NetHost,
  NetRoute,
  NetRouteErrorResponse,
  NetRouteList,
  NetRouteOrderInput,
  StartNetCheckInput,
  UpdateNetRouteInput,
} from '@torsher/api-client'
import { del, DemoError, get, patch, post, put } from '@torsher/demo/router'
import { ago, DAY, HOUR, isFresh, nextId } from '@torsher/demo/state'
import { sourceHosts } from './sources'

interface DemoRoute extends NetRoute {
  // Учётные данные прокси не уходят в ответ: хранится только их наличие
  username: string | null
  password: string | null
}

type HostResult = Pick<
  NetHost,
  'status' | 'httpStatus' | 'latencyMs' | 'dnsSpoofed' | 'checkedAt'
>

const DEFAULT_MATCH = '*'
// Хост «отвечает» за доли секунды: опрос панели раз в секунду видит, как
// проверка идёт по одному хосту
const HOST_CHECK_MS = 900

const DNS_PROVIDERS: DnsProviderList['items'] = [
  { id: 'quad9', name: 'Quad9', url: 'https://9.9.9.9/dns-query' },
  { id: 'google', name: 'Google', url: 'https://8.8.8.8/dns-query' },
  { id: 'cloudflare', name: 'Cloudflare', url: 'https://1.1.1.1/dns-query' },
]

// Каталог и постеры сервер берёт из TMDB: эти хосты в проверке всегда есть
const TMDB_HOSTS = [
  {
    kind: 'tmdb' as const,
    label: 'TMDB API',
    url: 'https://api.themoviedb.org',
  },
  {
    kind: 'tmdb_images' as const,
    label: 'TMDB images',
    url: 'https://image.tmdb.org',
  },
]

function routeOf(
  fields: Partial<DemoRoute> & Pick<DemoRoute, 'id' | 'match'>,
): DemoRoute {
  return {
    isDefault: fields.match === DEFAULT_MATCH,
    via: 'direct',
    proxy: null,
    envProxy: false,
    hasUsername: false,
    hasPassword: false,
    dns: 'system',
    dohUrl: null,
    updatedAt: ago(30 * DAY),
    username: null,
    password: null,
    ...fields,
  }
}

let routes: DemoRoute[] = isFresh
  ? [routeOf({ id: 'route-default', match: DEFAULT_MATCH })]
  : [
      routeOf({
        id: 'route-indexer',
        match: 'indexer.example',
        via: 'socks5h',
        proxy: '192.168.1.20:1080',
        dns: 'quad9',
        updatedAt: ago(12 * DAY),
      }),
      routeOf({
        id: 'route-manager',
        match: 'manager.example',
        updatedAt: ago(40 * DAY),
      }),
      routeOf({
        id: 'route-default',
        match: DEFAULT_MATCH,
        dns: 'cloudflare',
        updatedAt: ago(40 * DAY),
      }),
    ]

const results = new Map<string, HostResult>()
// Когда «заканчивается» проверка каждого хоста; пусто — ничего не идёт
const checkingUntil = new Map<string, number>()
let run: { total: number, finishedAt: string | null } = {
  total: 0,
  finishedAt: isFresh ? null : ago(6 * HOUR),
}

function routeError(
  field: NetRouteErrorResponse['field'],
  kind: NetRouteErrorResponse['kind'],
  message: string,
) {
  return new DemoError(422, {
    field,
    kind,
    message,
  } satisfies NetRouteErrorResponse)
}

const LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/

function isHostname(value: string) {
  return (
    value.length <= 253 && value.split('.').every(label => LABEL.test(label))
  )
}

/** `*`, точный хост или `*.домен`; порт, путь и схема в маску не входят */
function normalizeMatch(input: string) {
  const value = input.trim().toLowerCase().replace(/\.$/, '')

  if (value === DEFAULT_MATCH)
    return value

  const host = value.startsWith('*.') ? value.slice(2) : value

  return isHostname(host) ? value : undefined
}

function matchOf(input: string) {
  const match = normalizeMatch(input)
  if (!match)
    throw routeError('match', 'invalid', 'Host or mask is invalid')

  return match
}

function assertUnique(match: string, exceptId?: string) {
  if (routes.some(route => route.match === match && route.id !== exceptId)) {
    throw routeError(
      'match',
      'duplicate',
      'A route for this host already exists',
    )
  }
}

/** `host:port` или со схемой способа; логин и пароль из адреса — в поля */
function parseProxy(via: 'socks5h' | 'http', input: string) {
  const parsed
    = /^(?:([a-z0-9]+):\/\/)?(?:([^:@/]*)(?::([^@/]*))?@)?([^:/@]+):(\d+)\/?$/i.exec(
      input.trim(),
    )

  if (!parsed)
    throw routeError('proxy', 'invalid', 'Proxy address must be host:port')

  const [, scheme, username, password, host, rawPort] = parsed
  const schemes = via === 'http' ? ['http'] : ['socks5', 'socks5h']

  if (scheme && !schemes.includes(scheme.toLowerCase())) {
    throw routeError(
      'proxy',
      'invalid',
      `Proxy scheme ${scheme} does not match ${via}`,
    )
  }

  const port = Number(rawPort)

  if (!isHostname(host!.toLowerCase()))
    throw routeError('proxy', 'invalid', 'Proxy host is invalid')

  if (port < 1 || port > 65535)
    throw routeError('proxy', 'invalid', 'Proxy port must be 1–65535')

  return {
    address: `${host!.toLowerCase()}:${port}`,
    username: username || undefined,
    password: password || undefined,
  }
}

function parseDohUrl(input: string) {
  let url: URL

  try {
    url = new URL(input.trim())
  }
  catch {
    throw routeError('dohUrl', 'invalid', 'DoH address is not a URL')
  }

  if (url.protocol !== 'https:')
    throw routeError('dohUrl', 'invalid', 'DoH address must use https')

  url.hash = ''
  return url.href
}

/** Поля маршрута по вводу поверх текущих — как сохраняет сервер */
function applyInput(current: DemoRoute, input: UpdateNetRouteInput): DemoRoute {
  const via = input.via ?? current.via
  const dns = input.dns ?? current.dns
  const next: DemoRoute = {
    ...current,
    via,
    dns,
    updatedAt: new Date().toISOString(),
  }

  if (via === 'direct') {
    Object.assign(next, { proxy: null, username: null, password: null })
  }
  else {
    const parsed
      = input.proxy !== undefined ? parseProxy(via, input.proxy) : undefined

    if (!parsed && !current.proxy)
      throw routeError('proxy', 'invalid', 'Proxy address is required')

    const secret = (
      value: string | null | undefined,
      fromUrl: string | undefined,
      stored: string | null,
    ) => (value === null ? null : value || fromUrl || stored)

    next.proxy = parsed?.address ?? current.proxy
    next.username = secret(input.username, parsed?.username, current.username)
    next.password = secret(input.password, parsed?.password, current.password)
  }

  if (dns === 'custom') {
    const value = input.dohUrl ?? current.dohUrl
    if (!value)
      throw routeError('dohUrl', 'invalid', 'DoH address is required')

    next.dohUrl = parseDohUrl(value)
  }
  else {
    next.dohUrl = null
  }

  next.hasUsername = Boolean(next.username)
  next.hasPassword = Boolean(next.password)

  return next
}

function toResponse({
  username: _u,
  password: _p,
  ...route
}: DemoRoute): NetRoute {
  return route
}

function list(): NetRouteList {
  return {
    items: [
      ...routes.filter(route => !route.isDefault),
      ...routes.filter(route => route.isDefault),
    ].map(toResponse),
  }
}

function findRoute(id: string) {
  const found = routes.find(route => route.id === id)
  if (!found)
    throw new DemoError(404, { message: 'Route not found' })

  return found
}

/** Маршрут хоста: точное совпадение важнее маски, среди масок — первая */
function routeFor(hostname: string) {
  const ordered = list().items

  return (
    ordered.find(route => route.match === hostname)
    ?? ordered.find(
      route =>
        route.match.startsWith('*.') && hostname.endsWith(route.match.slice(1)),
    )
    ?? ordered.find(route => route.isDefault)!
  )
}

function targets() {
  const seen = new Map<
    string,
    { kind: NetHost['kind'], label: string, url: URL }
  >()

  for (const source of [...TMDB_HOSTS, ...sourceHosts()]) {
    const url = new URL(source.url)

    if (!seen.has(url.origin))
      seen.set(url.origin, { ...source, url })
  }

  return [...seen.entries()].map(([id, target]) => ({ id, ...target }))
}

/**
 * Результат «проверки»: адреса `.example` и TMDB отвечают; хост, которого в
 * демо нет, не находится в DNS
 */
function resultFor(url: URL, at: number): HostResult {
  const known
    = url.hostname.endsWith('.example')
      || url.hostname.endsWith('tmdb.org')
      || url.hostname.endsWith('themoviedb.org')
  const seed = [...url.host].reduce((sum, char) => sum + char.charCodeAt(0), 0)

  return {
    status: known ? 'ok' : 'dns',
    httpStatus: known ? 200 : null,
    latencyMs: known ? 40 + (seed % 180) : null,
    dnsSpoofed: false,
    checkedAt: new Date(at).toISOString(),
  }
}

/** Проверки, время которых пришло, записываются в результаты */
function settle() {
  const now = Date.now()

  for (const [id, until] of checkingUntil) {
    if (until > now)
      continue

    checkingUntil.delete(id)
    results.set(id, resultFor(new URL(id), until))
  }

  if (run.total && checkingUntil.size === 0 && !run.finishedAt)
    run.finishedAt = new Date().toISOString()
}

function checkState(): NetCheckState {
  settle()

  const hosts: NetHost[] = targets().map((target) => {
    const route = routeFor(target.url.hostname)
    const result = results.get(target.id)

    return {
      id: target.id,
      host: target.url.host,
      hostname: target.url.hostname,
      kind: target.kind,
      label: target.label,
      route: {
        id: route.id,
        match: route.match,
        via: route.via,
        dns: route.dns,
        envProxy: route.envProxy,
      },
      checking: checkingUntil.has(target.id),
      status: result?.status ?? null,
      httpStatus: result?.httpStatus ?? null,
      latencyMs: result?.latencyMs ?? null,
      dnsSpoofed: result?.dnsSpoofed ?? false,
      checkedAt: result?.checkedAt ?? null,
    }
  })
  const running = Boolean(run.total) && !run.finishedAt

  return {
    running,
    done: running ? run.total - checkingUntil.size : run.total,
    total: run.total,
    finishedAt: run.finishedAt,
    hosts,
  }
}

// В прожитой установке хосты уже проверяли: таблица не пустая
if (!isFresh) {
  for (const target of targets())
    results.set(target.id, resultFor(target.url, Date.now() - 6 * HOUR * 1000))

  run.total = results.size
}

get<NetRouteList>('/api/net/routes', () => list())

post<NetRoute, CreateNetRouteInput>('/api/net/routes', ({ body }) => {
  const match = matchOf(body.match)

  if (match === DEFAULT_MATCH)
    throw routeError('match', 'duplicate', 'The default route already exists')

  assertUnique(match)

  const created = applyInput(routeOf({ id: nextId('route'), match }), {
    ...body,
    dns: body.dns ?? 'system',
  })

  routes = [
    ...routes.filter(route => !route.isDefault),
    created,
    ...routes.filter(route => route.isDefault),
  ]
  return toResponse(created)
})

// Точный путь раньше шаблонного `/api/net/routes/:id`
put<NetRouteList, NetRouteOrderInput>('/api/net/routes/order', ({ body }) => {
  const movable = routes.filter(route => !route.isDefault)
  const ids = new Set(body.ids)

  if (
    ids.size !== movable.length
    || movable.some(route => !ids.has(route.id))
  ) {
    throw new DemoError(400, {
      message: 'Order must list every route except the default',
    })
  }

  routes = [
    ...body.ids.map(id => findRoute(id)),
    ...routes.filter(route => route.isDefault),
  ]

  return list()
})

patch<NetRoute, UpdateNetRouteInput>(
  '/api/net/routes/:id',
  ({ params, body }) => {
    const current = findRoute(params.id!)
    let match = current.match

    if (body.match !== undefined) {
      const next = matchOf(body.match)

      if (
        next !== current.match
        && (current.isDefault || next === DEFAULT_MATCH)
      ) {
        throw routeError(
          'match',
          'default_route',
          'The default route mask cannot change',
        )
      }

      assertUnique(next, current.id)
      match = next
    }

    const updated = applyInput({ ...current, match }, body)

    routes = routes.map(route => (route.id === current.id ? updated : route))
    return toResponse(updated)
  },
)

del<MessageResponse>('/api/net/routes/:id', ({ params }) => {
  const current = findRoute(params.id!)

  if (current.isDefault) {
    throw routeError(
      'match',
      'default_route',
      'The default route cannot be deleted',
    )
  }

  routes = routes.filter(route => route.id !== current.id)
  return { message: 'Route deleted' }
})

get<DnsProviderList>('/api/net/dns-providers', () => ({
  items: DNS_PROVIDERS,
}))

get<NetCheckState>('/api/net/check', () => checkState())

post<NetCheckState, StartNetCheckInput>('/api/net/check', ({ body }) => {
  settle()

  const now = Date.now()
  const all = targets()

  if (body?.host) {
    if (!all.some(target => target.id === body.host))
      throw new DemoError(404, { message: 'Host not found' })

    checkingUntil.set(body.host, now + HOST_CHECK_MS)
    return checkState()
  }

  all.forEach((target, index) =>
    checkingUntil.set(target.id, now + (index + 1) * HOST_CHECK_MS),
  )
  run = { total: all.length, finishedAt: null }

  return checkState()
})

/** Последний результат проверки хостов: сама проверка здесь не запускается */
export function networkAttention(): AttentionItem[] {
  const failed = checkState().hosts.filter(
    host => host.status && host.status !== 'ok',
  )
  const spoofed = failed.filter(host => host.dnsSpoofed)
  const unreachable = failed.filter(host => !host.dnsSpoofed)
  const counted = (hosts: NetHost[]): AttentionItem['params'] =>
    hosts.length === 1
      ? { count: 1, name: hosts[0]!.host }
      : { count: hosts.length }
  const items: AttentionItem[] = []

  if (spoofed.length) {
    items.push({
      kind: 'dns_spoofing',
      severity: 'error',
      section: 'network',
      params: counted(spoofed),
    })
  }

  if (unreachable.length) {
    items.push({
      kind: 'host_unreachable',
      severity: 'error',
      section: 'network',
      params: counted(unreachable),
    })
  }

  return items
}
