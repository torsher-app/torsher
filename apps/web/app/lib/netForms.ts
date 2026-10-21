import * as z from 'zod'

const LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/
const IPV4
  = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

function isHost(value: string) {
  if (IPV4.test(value) || /^\[[\da-f:.]+\]$/i.test(value))
    return true

  if (/[\s/:@?#*\\[\]%]/.test(value))
    return false

  try {
    // URL переводит кириллический домен в punycode, как сервер
    const ascii = new URL(`http://${value}`).hostname

    return (
      ascii.length <= 253
      && ascii.split('.').every(label => LABEL.test(label))
    )
  }
  catch {
    return false
  }
}

/** Те же правила, что у сервера: `*`, точный хост или `*.домен` — без схемы, порта и пути */
export function isValidMatch(input: string) {
  const value = input.trim().toLowerCase().replace(/\.$/, '')

  if (value === '*')
    return true

  if (value.startsWith('*.'))
    return !IPV4.test(value.slice(2)) && isHost(value.slice(2))

  return isHost(value)
}

const PROXY
  = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(?:[^:@/]*(?::[^@/]*)?@)?(\[[^\]]+\]|[^:@/]+):(\d{1,5})\/?$/i

export const PROXY_SCHEMES = {
  socks5h: ['socks5h', 'socks5', 'socks'],
  http: ['http'],
} as const

export type ProxyProblem = 'format' | 'scheme' | 'port'

/** Адрес прокси `host:port`, можно со схемой способа и логином: как разбирает сервер */
export function proxyProblem(
  via: keyof typeof PROXY_SCHEMES,
  input: string,
): ProxyProblem | null {
  const parsed = PROXY.exec(input.trim())

  if (!parsed || !isHost(parsed[2]!.toLowerCase()))
    return 'format'

  const scheme = parsed[1]?.toLowerCase()

  if (scheme && !(PROXY_SCHEMES[via] as readonly string[]).includes(scheme))
    return 'scheme'

  const port = Number(parsed[3])

  return port >= 1 && port <= 65535 ? null : 'port'
}

export function httpsUrlSchema(message: string) {
  return z
    .string()
    .trim()
    .max(2000, message)
    .refine((value) => {
      try {
        return new URL(value).protocol === 'https:'
      }
      catch {
        return false
      }
    }, message)
}
