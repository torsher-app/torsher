import type { NetRoute, NetRouteDns, NetRouteVia } from '../../db/schema.ts'
import { and, asc, eq, ne } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { netRoutes } from '../../db/schema.ts'
import { decryptSecret, encryptSecret } from '../secrets/index.ts'
import { DEFAULT_MATCH, normalizeHost, normalizeMatch } from './match.ts'

export type NetRouteField = 'match' | 'proxy' | 'dohUrl'

/**
 * `invalid` — значение поля не разобрать, `duplicate` — маршрут для этой
 * маски уже есть, `default_route` — маршрут по умолчанию нельзя удалить
 * или сменить ему маску.
 */
export type NetRouteErrorKind = 'invalid' | 'duplicate' | 'default_route'

export class NetRouteError extends Error {
  readonly field: NetRouteField
  readonly kind: NetRouteErrorKind

  constructor(field: NetRouteField, kind: NetRouteErrorKind, message: string) {
    super(message)
    this.name = 'NetRouteError'
    this.field = field
    this.kind = kind
  }
}

export interface RouteInput {
  match: string
  via: NetRouteVia
  proxy?: string
  username?: string
  password?: string
  dns: NetRouteDns
  dohUrl?: string
}

export interface RoutePatch {
  match?: string
  via?: NetRouteVia
  proxy?: string
  // null — убрать сохранённое значение
  username?: string | null
  password?: string | null
  dns?: NetRouteDns
  dohUrl?: string | null
}

const PROXY_SCHEMES: Record<Exclude<NetRouteVia, 'direct'>, string[]> = {
  socks5h: ['socks5h', 'socks5', 'socks'],
  http: ['http'],
}

const PROXY_PATTERN
  = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(?:([^:@/]*)(?::([^@/]*))?@)?(\[[^\]]+\]|[^:@/]+):(\d{1,5})\/?$/i

export interface ParsedProxy {
  address: string
  username?: string
  password?: string
}

/**
 * Адрес прокси: `host:port` или с схемой способа (`socks5://`, `http://`).
 * Порт обязателен — у прокси нет общего порта по умолчанию. Логин и пароль
 * из адреса уходят в отдельные зашифрованные поля.
 */
export function parseProxy(
  via: Exclude<NetRouteVia, 'direct'>,
  input: string,
): ParsedProxy {
  const parsed = PROXY_PATTERN.exec(input.trim())

  if (!parsed) {
    throw new NetRouteError(
      'proxy',
      'invalid',
      'Proxy address must be host:port',
    )
  }

  const [, scheme, username, password, rawHost, rawPort] = parsed

  if (scheme && !PROXY_SCHEMES[via].includes(scheme.toLowerCase())) {
    throw new NetRouteError(
      'proxy',
      'invalid',
      `Proxy scheme ${scheme} does not match ${via}`,
    )
  }

  const host = normalizeHost(rawHost!)
  const port = Number(rawPort)

  if (!host)
    throw new NetRouteError('proxy', 'invalid', 'Proxy host is invalid')

  if (port < 1 || port > 65535)
    throw new NetRouteError('proxy', 'invalid', 'Proxy port must be 1–65535')

  return {
    address: `${host}:${port}`,
    username: username ? decodeURIComponent(username) : undefined,
    password: password ? decodeURIComponent(password) : undefined,
  }
}

function parseDohUrl(input: string) {
  let url: URL

  try {
    url = new URL(input.trim())
  }
  catch {
    throw new NetRouteError('dohUrl', 'invalid', 'DoH address is not a URL')
  }

  if (url.protocol !== 'https:')
    throw new NetRouteError('dohUrl', 'invalid', 'DoH address must use https')

  url.hash = ''

  return url.href
}

function matchOf(input: string) {
  const match = normalizeMatch(input)

  if (!match)
    throw new NetRouteError('match', 'invalid', 'Host or mask is invalid')

  return match
}

function ensureDefault() {
  getDb()
    .insert(netRoutes)
    .values({ match: DEFAULT_MATCH, via: 'direct', dns: 'system', position: 0 })
    .onConflictDoNothing({ target: netRoutes.match })
    .run()
}

/** Маршруты по порядку, `*` последним. Маршрут по умолчанию создаётся сам */
export function listRoutes(): NetRoute[] {
  ensureDefault()

  const rows = getDb()
    .select()
    .from(netRoutes)
    .orderBy(asc(netRoutes.position), asc(netRoutes.match))
    .all()

  return [
    ...rows.filter(row => row.match !== DEFAULT_MATCH),
    ...rows.filter(row => row.match === DEFAULT_MATCH),
  ]
}

export function getRoute(id: string) {
  return getDb().select().from(netRoutes).where(eq(netRoutes.id, id)).get()
}

function assertUnique(match: string, exceptId?: string) {
  const clash = getDb()
    .select({ id: netRoutes.id })
    .from(netRoutes)
    .where(
      exceptId
        ? and(eq(netRoutes.match, match), ne(netRoutes.id, exceptId))
        : eq(netRoutes.match, match),
    )
    .get()

  if (clash) {
    throw new NetRouteError(
      'match',
      'duplicate',
      'A route for this host already exists',
    )
  }
}

interface ProxyColumns {
  proxyAddress: string | null
  proxyUsername: string | null
  proxyPassword: string | null
}

function proxyColumns(
  via: NetRouteVia,
  proxy: string | undefined,
  username: string | null | undefined,
  password: string | null | undefined,
  current?: ProxyColumns,
): ProxyColumns {
  if (via === 'direct')
    return { proxyAddress: null, proxyUsername: null, proxyPassword: null }

  const parsed = proxy !== undefined ? parseProxy(via, proxy) : undefined

  if (!parsed && !current?.proxyAddress)
    throw new NetRouteError('proxy', 'invalid', 'Proxy address is required')

  const address = parsed?.address ?? current!.proxyAddress!

  const secret = (
    value: string | null | undefined,
    fromUrl: string | undefined,
    stored: string | null | undefined,
  ) => {
    if (value === null)
      return null

    const plain = value || fromUrl

    return plain ? encryptSecret(plain) : (stored ?? null)
  }

  return {
    proxyAddress: address,
    proxyUsername: secret(username, parsed?.username, current?.proxyUsername),
    proxyPassword: secret(password, parsed?.password, current?.proxyPassword),
  }
}

function dohColumn(
  dns: NetRouteDns,
  dohUrl: string | null | undefined,
  current?: string | null,
) {
  if (dns !== 'custom')
    return null

  const value = dohUrl ?? current

  if (!value)
    throw new NetRouteError('dohUrl', 'invalid', 'DoH address is required')

  return parseDohUrl(value)
}

export function createRoute(input: RouteInput): NetRoute {
  const match = matchOf(input.match)

  if (match === DEFAULT_MATCH) {
    throw new NetRouteError(
      'match',
      'duplicate',
      'The default route already exists',
    )
  }

  assertUnique(match)

  const last = listRoutes()
    .filter(route => route.match !== DEFAULT_MATCH)
    .at(-1)

  return getDb()
    .insert(netRoutes)
    .values({
      match,
      via: input.via,
      ...proxyColumns(input.via, input.proxy, input.username, input.password),
      dns: input.dns,
      dohUrl: dohColumn(input.dns, input.dohUrl),
      position: (last?.position ?? -1) + 1,
    })
    .returning()
    .get()
}

export function updateRoute(
  id: string,
  patch: RoutePatch,
): NetRoute | undefined {
  const current = getRoute(id)

  if (!current)
    return undefined

  let match = current.match

  if (patch.match !== undefined) {
    const next = matchOf(patch.match)

    if (
      next !== current.match
      && (current.match === DEFAULT_MATCH || next === DEFAULT_MATCH)
    ) {
      throw new NetRouteError(
        'match',
        'default_route',
        'The default route mask cannot change',
      )
    }

    assertUnique(next, id)
    match = next
  }

  const via = patch.via ?? current.via
  const dns = patch.dns ?? current.dns

  return getDb()
    .update(netRoutes)
    .set({
      match,
      via,
      ...proxyColumns(
        via,
        patch.proxy,
        patch.username,
        patch.password,
        current,
      ),
      dns,
      dohUrl: dohColumn(dns, patch.dohUrl, current.dohUrl),
      updatedAt: new Date(),
    })
    .where(eq(netRoutes.id, id))
    .returning()
    .get()
}

export function deleteRoute(id: string) {
  const current = getRoute(id)

  if (!current)
    return false

  if (current.match === DEFAULT_MATCH) {
    throw new NetRouteError(
      'match',
      'default_route',
      'The default route cannot be deleted',
    )
  }

  getDb().delete(netRoutes).where(eq(netRoutes.id, id)).run()

  return true
}

/** Порядок задаётся полным списком маршрутов, кроме `*` */
export function reorderRoutes(ids: string[]) {
  const movable = listRoutes().filter(route => route.match !== DEFAULT_MATCH)
  const known = new Set(movable.map(route => route.id))

  if (
    ids.length !== known.size
    || new Set(ids).size !== ids.length
    || ids.some(id => !known.has(id))
  ) {
    return false
  }

  getDb().transaction((tx) => {
    ids.forEach((id, position) => {
      tx.update(netRoutes).set({ position }).where(eq(netRoutes.id, id)).run()
    })
  })

  return true
}

export interface ProxyCredentials {
  username?: string
  password?: string
}

/** Расшифровка для диспетчера; ответы API учётных данных не содержат */
export function proxyCredentials(route: NetRoute): ProxyCredentials {
  return {
    username: route.proxyUsername
      ? decryptSecret(route.proxyUsername)
      : undefined,
    password: route.proxyPassword
      ? decryptSecret(route.proxyPassword)
      : undefined,
  }
}
