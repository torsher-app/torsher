import { isIPv4, isIPv6 } from 'node:net'
import { domainToASCII } from 'node:url'

export const DEFAULT_MATCH = '*'

const LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/

function isHostname(value: string) {
  return (
    value.length <= 253 && value.split('.').every(label => LABEL.test(label))
  )
}

/**
 * Хост из адреса в том виде, в каком его сравнивают маршруты: нижний регистр,
 * punycode, без завершающей точки, IPv6 в квадратных скобках (как `URL.hostname`).
 */
export function normalizeHost(host: string) {
  const value = host.trim().toLowerCase().replace(/\.$/, '')

  if (isIPv6(value))
    return `[${value}]`

  if (value.startsWith('[') && value.endsWith(']'))
    return isIPv6(value.slice(1, -1)) ? value : undefined

  if (isIPv4(value))
    return value

  // domainToASCII молча отрезает путь и порт: адрес вместо хоста не принимаем
  if (/[\s/:@?#*\\[\]%]/.test(value))
    return undefined

  const ascii = domainToASCII(value)

  return ascii && isHostname(ascii) ? ascii : undefined
}

/**
 * `*`, точный хост или `*.домен` (только поддомены). Порт, путь и схема
 * в маску не входят: маршрут выбирается по хосту, а не по подстроке URL.
 * Неверная маска — `undefined`.
 */
export function normalizeMatch(input: string) {
  const value = input.trim().toLowerCase()

  if (value === DEFAULT_MATCH)
    return value

  if (value.startsWith('*.')) {
    const domain = normalizeHost(value.slice(2))

    return domain && !domain.startsWith('[') && !isIPv4(domain)
      ? `*.${domain}`
      : undefined
  }

  return normalizeHost(value)
}

export function matchesHost(match: string, host: string) {
  if (match === DEFAULT_MATCH)
    return true

  if (match.startsWith('*.'))
    return host.endsWith(match.slice(1))

  return host === match
}

/**
 * Маршрут хоста: точное совпадение важнее маски, среди масок — первая по
 * порядку, `*` — последним. Маршруты приходят уже по порядку.
 */
export function pickRoute<T extends { match: string }>(
  routes: T[],
  host: string,
) {
  return (
    routes.find(route => route.match === host)
    ?? routes.find(
      route => route.match.startsWith('*.') && matchesHost(route.match, host),
    )
    ?? routes.find(route => route.match === DEFAULT_MATCH)
  )
}
