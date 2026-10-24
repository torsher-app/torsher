import type { Dispatcher, RequestInit as UndiciRequestInit } from 'undici'
import type { NetRoute } from '../../db/schema.ts'
import { fetch as undiciFetch } from 'undici'
import { dispatcherFor, resetDispatchers } from './dispatchers.ts'
import { normalizeHost, pickRoute } from './match.ts'
import { listRoutes } from './routes.ts'

export { dohUrlOf, usesEnvProxy } from './dispatchers.ts'
export { DOH_PROVIDERS } from './doh.ts'
export { DEFAULT_MATCH, normalizeHost, normalizeMatch } from './match.ts'
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
 * с системным DNS или DoH.
 */
export function netFetch(url: string | URL, init: RequestInit = {}) {
  const target = new URL(url)

  return transport(target.href, init, () =>
    dispatcherFor(routeForHost(target.hostname)))
}
