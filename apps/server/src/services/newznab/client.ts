import type { NewznabOriginApproval } from '../../db/schema.ts'
import type { TorznabCaps } from '../torznab/caps.ts'
import { BodyTooLargeError, readBodyLimited } from '../net/body.ts'
import {
  previewTrustedAddress,
  TrustedHttpError,
  trustedHttpRequest,
  trustedUrl,
} from '../net/trustedHttp.ts'
import { parseCaps } from '../torznab/caps.ts'
import {
  normalizeTorznabUrl,
  readTorznabXml,
  retryAtOf,
  SourceError,
  torznabRequestUrl,
} from '../torznab/client.ts'
import { child, children, parseXml, text } from '../torznab/xml.ts'

export interface NewznabConnection {
  url: string
  apiKey?: string
  lanAddresses?: string[] | null
  downloadOrigins?: NewznabOriginApproval[] | null
}

export interface NewznabRelease {
  title: string
  guid: string
  download: string
  size?: number
}

export function normalizeNewznabUrl(input: string) {
  try {
    const url = trustedUrl(input)
    if (url.search) {
      throw new SourceError(
        'bad_response',
        'Source address must not contain a query',
      )
    }
    return normalizeTorznabUrl(url.href)
  }
  catch (error) {
    throw safeSourceError(error)
  }
}

function safeSourceError(error: unknown) {
  if (error instanceof SourceError)
    return error
  if (error instanceof TrustedHttpError) {
    const kind = error.kind === 'timeout' ? 'timeout' : 'unreachable'
    return new SourceError(kind, error.kind)
  }
  if (error instanceof BodyTooLargeError)
    return new SourceError('bad_response', 'Source response is too large')
  return new SourceError('bad_response', 'Invalid source response')
}

export async function previewNewznabAddress(input: string) {
  try {
    const url = new URL(normalizeNewznabUrl(input))
    const result = await previewTrustedAddress(url)
    return {
      origin: url.origin,
      lanAddresses: result.private ? result.addresses : [],
    }
  }
  catch (error) {
    throw safeSourceError(error)
  }
}

export function normalizeDownloadOrigins(items: NewznabOriginApproval[]) {
  try {
    const entries = new Map<string, NewznabOriginApproval>()
    for (const item of items) {
      const url = trustedUrl(item.origin)
      if (url.protocol !== 'https:' || url.pathname !== '/' || url.search) {
        throw new SourceError(
          'bad_response',
          'Download origin must be an HTTPS origin',
        )
      }
      entries.set(url.origin, {
        origin: url.origin,
        lanAddresses: [...new Set(item.lanAddresses)].sort(),
      })
    }
    return [...entries.values()]
  }
  catch (error) {
    throw safeSourceError(error)
  }
}

async function fetchXml(
  connection: NewznabConnection,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  const url = torznabRequestUrl(connection.url, params, connection.apiKey)
  try {
    const req = await trustedHttpRequest(
      url,
      {
        origin: url.origin,
        lanAddresses: connection.lanAddresses ?? [],
      },
      { signal },
    )
    try {
      if (req.response.status >= 300 && req.response.status < 400)
        throw new SourceError('bad_response', 'Search endpoint redirected')
      return await readTorznabXml(req.response)
    }
    finally {
      await req.close()
    }
  }
  catch (error) {
    throw safeSourceError(error)
  }
}

function authenticationProbe(caps: TorznabCaps) {
  const modes = [
    ['search', caps.search],
    ['movie', caps.movieSearch],
    ['tvsearch', caps.tvSearch],
  ] as const
  for (const [t, mode] of modes) {
    if (!mode.available)
      continue
    if (
      mode.params.includes('q')
      || (t === 'search' && mode.params.length === 0)
    ) {
      return { t, q: 'Torsher capability check', limit: '1' }
    }
    const key = ['imdbid', 'tmdbid', 'tvdbid', 'tvmazeid', 'rid'].find(item =>
      mode.params.includes(item),
    )
    if (key)
      return { t, [key]: '999999999', limit: '1' }
  }
}

export async function checkNewznab(
  connection: NewznabConnection,
): Promise<TorznabCaps> {
  const signal = AbortSignal.timeout(8_000)
  const caps = parseCaps(
    child(await fetchXml(connection, { t: 'caps' }, signal), 'caps'),
  )
  const probe = caps && authenticationProbe(caps)
  if (!caps || !probe) {
    throw new SourceError(
      'bad_response',
      'Source did not return searchable Newznab capabilities',
    )
  }

  if (connection.apiKey) {
    const xml = await fetchXml(connection, probe, signal)
    if (!child(child(xml, 'rss'), 'channel')) {
      throw new SourceError(
        'bad_response',
        'Source did not return a search feed',
      )
    }
  }
  return caps
}

export async function fetchNewznabPage(
  connection: NewznabConnection,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  const xml = await fetchXml(connection, params, signal)
  const channel = child(child(xml, 'rss'), 'channel')
  if (!channel) {
    throw new SourceError(
      'bad_response',
      'Source did not return a search feed',
    )
  }
  const items = children(channel, 'item')
  const releases = items.slice(0, 100).flatMap((item): NewznabRelease[] => {
    const title = text(item, 'title')?.trim()
    const guid = text(item, 'guid')?.trim()
    const enclosure = child(item, 'enclosure')
    const download = text(enclosure, 'url')?.trim()
    const type = text(enclosure, 'type')?.trim().toLowerCase()
    const knownSize = children(item, 'newznab:attr').find(
      attr => text(attr, 'name') === 'size',
    )
    const size = Number(text(knownSize, 'value') ?? text(enclosure, 'length'))
    if (
      !title
      || title.length > 512
      || !guid
      || guid.length > 4096
      || !download
      || download.length > 8192
      || (type
        && ![
          'application/x-nzb',
          'application/nzb',
          'application/octet-stream',
        ].includes(type))
    ) {
      return []
    }
    return [
      {
        title,
        guid,
        download,
        size: Number.isSafeInteger(size) && size > 0 ? size : undefined,
      },
    ]
  })
  const pagination = child(channel, 'newznab:response')
  const offset = Number(text(pagination, 'offset'))
  const total = Number(text(pagination, 'total'))
  const nextOffset = offset + items.length
  return {
    releases,
    nextOffset:
      offset === Number(params.offset ?? 0)
      && Number.isSafeInteger(total)
      && items.length > 0
      && nextOffset < total
        ? nextOffset
        : undefined,
  }
}

const nzbDeclaration
  = /<!DOCTYPE\s+nzb\s+PUBLIC\s+(["'])-\/\/newzBin\/\/DTD NZB 1\.[01]\/\/EN\1\s+(["'])https?:\/\/www\.newzbin\.com\/DTD\/nzb\/nzb-1\.[01]\.dtd\2\s*>/i
const MAX_NZB_BYTES = 8 * 1024 * 1024
const REDIRECTS = new Set([301, 302, 303, 307, 308])

export function validatedNzb(bytes: Uint8Array) {
  try {
    const beginning = new TextDecoder().decode(bytes.subarray(0, 150))
    const legacy = /^<\?xml[^>]+encoding\s*=\s*["']iso-8859-1["']/i.test(
      beginning,
    )
    const raw = new TextDecoder(legacy ? 'iso-8859-1' : 'utf-8', {
      fatal: true,
    }).decode(bytes)
    const body = raw
      .replace(/^\s*<\?xml[^>]*\?>/i, '')
      .replace(nzbDeclaration, '')
    if (/<!ENTITY/i.test(body))
      throw new Error('Invalid NZB')
    const root = child(parseXml(body), 'nzb')
    if (!root || Array.isArray(root) || !child(root, 'file'))
      throw new Error('Invalid NZB')
    return new TextEncoder().encode(body)
  }
  catch {
    throw new SourceError('bad_response', 'Source did not return a valid NZB')
  }
}

function downloadPolicy(connection: NewznabConnection, url: URL) {
  const source = new URL(connection.url)
  if (url.origin === source.origin) {
    return {
      origin: source.origin,
      lanAddresses: connection.lanAddresses ?? [],
    }
  }
  const approval = connection.downloadOrigins?.find(
    item => item.origin === url.origin,
  )
  if (!approval || url.protocol !== 'https:')
    throw new SourceError('bad_response', 'Download origin is not approved')
  const key = connection.apiKey
  const values = [
    ...url.searchParams.values(),
    ...decodeURIComponent(url.pathname).split('/'),
  ]
  if (
    key
    && values.some(value =>
      key.length >= 8 ? value.includes(key) : value === key,
    )
  ) {
    throw new SourceError(
      'bad_response',
      'Download would transfer source credentials',
    )
  }
  return approval
}

export async function fetchNzb(
  connection: NewznabConnection,
  download: string,
) {
  const signal = AbortSignal.timeout(15_000)
  try {
    let url = trustedUrl(
      new URL(download, torznabRequestUrl(connection.url, {})).href,
    )
    if (/[\\#\s\p{Cc}\p{Cf}]/u.test(download))
      throw new SourceError('bad_response', 'Invalid download address')

    for (let hop = 0; hop <= 3; hop++) {
      const req = await trustedHttpRequest(
        url,
        downloadPolicy(connection, url),
        { signal },
      )
      try {
        const res = req.response
        if (REDIRECTS.has(res.status)) {
          const location = res.headers.get('location')
          if (hop === 3 || !location || /[\\#\s\p{Cc}\p{Cf}]/u.test(location))
            throw new SourceError('bad_response', 'Invalid download redirect')
          const next = trustedUrl(new URL(location, url).href)
          if (url.protocol === 'https:' && next.protocol !== 'https:') {
            throw new SourceError(
              'bad_response',
              'Download redirect downgraded HTTPS',
            )
          }
          url = next
          continue
        }

        if (!res.ok) {
          throw new SourceError(
            res.status === 401 || res.status === 403 ? 'auth' : 'remote',
            'NZB download failed',
            { status: res.status, retryAt: retryAtOf(res) },
          )
        }

        return validatedNzb(await readBodyLimited(res, MAX_NZB_BYTES))
      }
      finally {
        await req.close()
      }
    }

    throw new SourceError('bad_response', 'Too many download redirects')
  }
  catch (error) {
    throw safeSourceError(error)
  }
}
