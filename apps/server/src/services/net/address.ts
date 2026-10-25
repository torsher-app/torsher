import { isIP } from 'node:net'

/**
 * Имя хоста так, как его увидит `fetch`: WHATWG URL сводит `2130706433`,
 * `0x7f.1` и `127.1` к `127.0.0.1`, а IPv6 — к сокращённой записи. Голый
 * IPv6 приходит от резолвера, в том числе развёрнутым (`0:0:0:0:0:0:0:1`).
 */
export function normalizeHostname(hostname: string) {
  const bare = hostname.replace(/%.*$/, '')
  let host: string

  try {
    host = new URL(
      isIP(bare) === 6 ? `http://[${bare}]/` : `http://${hostname}/`,
    ).hostname
  }
  catch {
    host = hostname.toLowerCase()
  }

  host = host.replace(/\.$/, '')

  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

function isLocalIPv4(address: string) {
  const [a, b] = address.split('.').map(Number)

  return a === 127 || a === 0 || (a === 169 && b === 254)
}

function isLocalIPv6(address: string) {
  if (address === '::1' || address === '::')
    return true

  if (/^fe[89ab][0-9a-f]:/.test(address))
    return true

  const mapped = /^::ffff:(.+)$/.exec(address)?.[1]

  if (!mapped)
    return false

  if (isIP(mapped) === 4)
    return isLocalIPv4(mapped)

  const [high, low] = mapped
    .split(':')
    .map(part => Number.parseInt(part, 16))

  return (
    high !== undefined
    && low !== undefined
    && isLocalIPv4(`${high >> 8}.${high & 0xFF}.${low >> 8}.${low & 0xFF}`)
  )
}

/**
 * Loopback, «любой адрес» и link-local: там слушают API движка и метаданные
 * облака. Частные сети (10/8, 192.168/16) и имена контейнеров локальными
 * не считаются — там живут индексаторы.
 */
export function isLocalHostname(hostname: string) {
  const host = normalizeHostname(hostname)

  if (host === 'localhost' || host.endsWith('.localhost'))
    return true

  const version = isIP(host)

  if (version === 4)
    return isLocalIPv4(host)

  return version === 6 && isLocalIPv6(host)
}
