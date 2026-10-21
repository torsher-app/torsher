const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32ToHex(value: string) {
  let bits = ''

  for (const char of value.toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char)

    if (index === -1)
      return null

    bits += index.toString(2).padStart(5, '0')
  }

  let hex = ''

  for (let i = 0; i + 4 <= bits.length; i += 4)
    hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16)

  return hex
}

export interface ParsedMagnet {
  /** infohash v1 в нижнем регистре, 40 hex-символов */
  infoHash: string
  name: string | null
}

/**
 * Разбирает magnet-ссылку BitTorrent v1: infohash в hex (40) или base32 (32).
 * Ссылки только с v2-хешем (`btmh`) движок закреплённой версии не добавляет.
 */
export function parseMagnet(input: string): ParsedMagnet | null {
  let url: URL

  try {
    url = new URL(input.trim())
  }
  catch {
    return null
  }

  if (url.protocol !== 'magnet:')
    return null

  for (const xt of url.searchParams.getAll('xt')) {
    const match = /^urn:btih:([0-9a-z]+)$/i.exec(xt)
    const hash = match?.[1]

    if (!hash)
      continue

    const infoHash = /^[0-9a-f]{40}$/i.test(hash)
      ? hash.toLowerCase()
      : hash.length === 32
        ? base32ToHex(hash)
        : null

    if (infoHash)
      return { infoHash, name: url.searchParams.get('dn')?.trim() || null }
  }

  return null
}
