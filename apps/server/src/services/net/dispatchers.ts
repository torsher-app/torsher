import type { Dispatcher } from 'undici'
import type { NetRoute } from '../../db/schema.ts'
import { Buffer } from 'node:buffer'
import { Agent, EnvHttpProxyAgent, ProxyAgent, Socks5ProxyAgent } from 'undici'
import { config } from '../../config.ts'
import { DOH_PROVIDERS, dohResolverFor } from './doh.ts'
import { DEFAULT_MATCH } from './match.ts'
import { proxyCredentials } from './routes.ts'

/** Адрес DoH маршрута; `undefined` — системный DNS */
export function dohUrlOf(route: Pick<NetRoute, 'dns' | 'dohUrl'>) {
  if (route.dns === 'system')
    return undefined

  if (route.dns === 'custom')
    return route.dohUrl ?? undefined

  return DOH_PROVIDERS[route.dns].url
}

/**
 * Нетронутый маршрут по умолчанию (`*`, напрямую, системный DNS) идёт через
 * прокси из окружения, если он задан: так сервер работал до маршрутов
 * со встроенным `fetch` и `--use-env-proxy`.
 */
export function usesEnvProxy(route: Pick<NetRoute, 'match' | 'via' | 'dns'>) {
  return (
    route.match === DEFAULT_MATCH
    && route.via === 'direct'
    && route.dns === 'system'
    && config.envProxy
  )
}

/**
 * Через прокси имя хоста разрешает сам прокси (SOCKS5 с доменным адресом,
 * HTTP CONNECT по имени): DNS маршрута работает только у `direct`.
 */
export function createDispatcher(route: NetRoute): Dispatcher {
  if (route.via === 'direct') {
    const dohUrl = dohUrlOf(route)

    if (dohUrl)
      return new Agent({ connect: { lookup: dohResolverFor(dohUrl).lookup } })

    return usesEnvProxy(route) ? new EnvHttpProxyAgent() : new Agent()
  }

  const { username, password } = proxyCredentials(route)

  if (route.via === 'socks5h') {
    return new Socks5ProxyAgent(`socks5://${route.proxyAddress}`, {
      username,
      password,
    })
  }

  return new ProxyAgent({
    uri: `http://${route.proxyAddress}`,
    token: username
      ? `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`
      : undefined,
  })
}

const cache = new Map<string, Dispatcher>()

function keyOf(route: NetRoute) {
  return `${route.id}:${route.updatedAt.getTime()}`
}

export function dispatcherFor(route: NetRoute) {
  const key = keyOf(route)
  let dispatcher = cache.get(key)

  if (!dispatcher) {
    dispatcher = createDispatcher(route)
    cache.set(key, dispatcher)
  }

  return dispatcher
}

/** Маршруты изменились: старые соединения закрываются, когда допишут ответы */
export function resetDispatchers() {
  for (const dispatcher of cache.values()) dispatcher.close().catch(() => {})

  cache.clear()
}
