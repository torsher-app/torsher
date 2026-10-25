import type { Dispatcher, RequestInit as UndiciRequestInit } from 'undici'
import type { NetRoute } from '../../db/schema.ts'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { fetch as undiciFetch } from 'undici'
import { isLocalHostname, normalizeHostname } from './address.ts'
import {
  dispatcherFor,
  dohUrlOf,
  resetDispatchers,
  usesEnvProxy,
} from './dispatchers.ts'
import { dohResolverFor } from './doh.ts'
import { normalizeHost, pickRoute } from './match.ts'
import { followRedirects } from './redirect.ts'
import { listRoutes } from './routes.ts'

export { dohUrlOf, usesEnvProxy } from './dispatchers.ts'
export { DOH_PROVIDERS } from './doh.ts'
export { DEFAULT_MATCH, normalizeHost, normalizeMatch } from './match.ts'
export { NetRedirectError } from './redirect.ts'
export {
  createRoute,
  deleteRoute,
  getRoute,
  listRoutes,
  NetRouteError,
  reorderRoutes,
  updateRoute,
} from './routes.ts'
export { connectThroughRoute } from './socket.ts'

/**
 * Как запрос уходит в сеть. Диспетчер маршрута отдаётся лениво: подменённый
 * транспорт (тесты) работает без базы маршрутов.
 */
export type NetTransport = (
  url: string,
  init: RequestInit,
  dispatcher: () => Dispatcher,
) => Promise<Response>

// Диспетчеры undici передаются его же `fetch`: встроенный в Node `fetch`
// — другая версия undici с другим контрактом диспетчера
const undiciTransport: NetTransport = async (url, init, dispatcher) => {
  const response = await undiciFetch(url, {
    ...(init as UndiciRequestInit),
    dispatcher: dispatcher(),
  })

  return response as unknown as Response
}

let transport = undiciTransport

/** Тесты подменяют транспорт; `null` возвращает настоящий */
export function setNetTransport(next: NetTransport | null) {
  transport = next ?? undiciTransport
}

let routesCache: NetRoute[] | undefined

export function currentRoutes() {
  routesCache ??= listRoutes()

  return routesCache
}

/** После любой правки маршрутов: следующий запрос возьмёт новые */
export function routesChanged() {
  routesCache = undefined
  resetDispatchers()
}

export function routeForHost(hostname: string): NetRoute {
  const host = normalizeHost(hostname) ?? hostname.toLowerCase()

  // `*` есть всегда: listRoutes создаёт его сам
  return pickRoute(currentRoutes(), host)!
}

/**
 * Единственный выход сервера во внешнюю сеть (кроме движка на loopback):
 * маршрут выбирается по хосту адреса — напрямую, через SOCKS5 или HTTP-прокси,
 * с системным DNS или DoH. Редиректы — `followRedirects`: маршрут
 * выбирается заново на каждом шаге.
 */
export function netFetch(url: string | URL, init: RequestInit = {}) {
  return followRedirects(new URL(url), init, (target, hopInit) =>
    transport(target.href, { ...hopInit, redirect: 'manual' }, () =>
      dispatcherFor(routeForHost(target.hostname))))
}

export const netResolveDeps = {
  /**
   * Адреса хоста тем же DNS, что у его маршрута; `undefined` — маршрут через
   * прокси (свой или из окружения), имя разрешает прокси.
   */
  async routeAddresses(hostname: string): Promise<string[] | undefined> {
    const route = routeForHost(hostname)

    if (route.via !== 'direct' || usesEnvProxy(route))
      return undefined

    const dohUrl = dohUrlOf(route)
    const addresses = dohUrl
      ? await dohResolverFor(dohUrl).resolve(hostname)
      : await lookup(hostname, { all: true })

    return addresses.map(item => item.address)
  },
}

/**
 * Имя, которое на маршруте `direct` разрешается в локальный адрес
 * (`127.0.0.1.nip.io`). Ошибка DNS — не локальный: запрос упадёт сам.
 * Ответ DNS при соединении может отличаться — от rebinding это не защищает.
 */
export async function resolvesToLocal(hostname: string) {
  const host = normalizeHostname(hostname)

  if (isIP(host))
    return false

  try {
    const addresses = await netResolveDeps.routeAddresses(host)

    return addresses?.some(isLocalHostname) ?? false
  }
  catch {
    return false
  }
}
