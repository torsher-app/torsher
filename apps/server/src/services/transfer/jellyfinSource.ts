import type { JellyfinImportErrorKind } from '../../dto/jellyfinImport.ts'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { config } from '../../config.ts'
import { BodyTooLargeError, readBodyLimited } from '../net/body.ts'
import {
  previewTrustedAddress,
  TrustedHttpError,
  trustedHttpRequest,
  trustedUrl,
} from '../net/trustedHttp.ts'

const PAGE_SIZE = 100
const MAX_ITEMS = 20_000
const MAX_BYTES = 32 * 1024 * 1024
const SMALL_RESPONSE = 64 * 1024
const MAX_READ_TIME = 120_000

const guid = z.string().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i)
const identity = z.object({ Id: guid, Name: z.string() })
const serverInfo = z.object({ Id: guid, ServerName: z.string(), Version: z.string() })
const authToken = z.object({ AccessToken: z.string().regex(/^[\w-]{1,256}$/) })
const authorization = authToken.extend({ User: identity, ServerId: guid })
const pageSchema = z.object({
  Items: z.array(z.object({ Id: guid }).loose()),
  TotalRecordCount: z.int().nonnegative(),
  StartIndex: z.int().nonnegative().optional(),
})
const itemSchema = z.object({
  Id: guid,
  Type: z.enum(['Movie', 'Episode']),
  ProviderIds: z.record(z.string(), z.string()).nullish(),
  UserData: z.object({ Played: z.literal(true), LastPlayedDate: z.string().nullish() }),
  SeriesId: guid.nullish(),
  ParentIndexNumber: z.int().nullish(),
  IndexNumber: z.int().nullish(),
  IndexNumberEnd: z.int().nullish(),
})
const seriesSchema = z.object({
  Id: guid,
  Type: z.literal('Series'),
  ProviderIds: z.record(z.string(), z.string()).nullish(),
})

export class JellyfinImportError extends Error {
  readonly kind: JellyfinImportErrorKind
  readonly logoutWarning: boolean

  constructor(kind: JellyfinImportErrorKind, logoutWarning = false) {
    super(kind)
    this.name = 'JellyfinImportError'
    this.kind = kind
    this.logoutWarning = logoutWarning
  }
}

export interface JellyfinTarget {
  base: URL
  addresses: string[]
  private: boolean
}

export interface JellyfinItem {
  kind: 'movie' | 'episode'
  ids: { tmdb?: number, imdb?: string } | null
  season: number
  episode: number
  episodeTmdbId?: number
  lastActivityAt?: string
}

export interface JellyfinSource {
  serverId: string
  userId: string
  server: string
  user: string
  items: JellyfinItem[]
  logoutWarning: boolean
}

function compactId(value: string) {
  return value.replaceAll('-', '').toLowerCase()
}

function label(value: string) {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 160)
}

function baseUrl(input: string) {
  const url = trustedUrl(input)
  const path = input.replace(/^https?:\/\/[^/]+/i, '').replace(/\/+$/, '')
  if (url.protocol !== 'https:' || input.includes('?'))
    throw new JellyfinImportError('address')

  for (const segment of path.slice(1).split('/')) {
    const decoded = decodeURIComponent(segment)
    if (/^(?:\.|\.\.)$|[/%\\?#\p{Cc}\p{Cf}]/u.test(decoded) || (path && !decoded))
      throw new JellyfinImportError('address')
  }

  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

export async function resolveJellyfinTarget(input: string): Promise<JellyfinTarget> {
  try {
    const base = baseUrl(input)
    return { base, ...await previewTrustedAddress(base) }
  }
  catch {
    throw new JellyfinImportError('address')
  }
}

function sourceError(error: unknown) {
  if (error instanceof JellyfinImportError)
    return error
  if (error instanceof TrustedHttpError) {
    if (error.kind === 'address_changed' || error.kind === 'needs_confirmation')
      return new JellyfinImportError('addressChanged')
    if (error.kind === 'busy')
      return new JellyfinImportError('busy')
  }
  if (error instanceof BodyTooLargeError)
    return new JellyfinImportError('limit')
  return new JellyfinImportError('response')
}

function providerIds(ids: Record<string, string> | null | undefined) {
  const tmdb = new Set<number>()
  const imdb = new Set<string>()
  for (const [key, value] of Object.entries(ids ?? {})) {
    if (key.toLowerCase() === 'tmdb' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)))
      tmdb.add(Number(value))
    if (key.toLowerCase() === 'imdb' && /^tt\d{7,20}$/.test(value))
      imdb.add(value)
  }
  if (tmdb.size > 1 || imdb.size > 1)
    return null
  return { tmdb: [...tmdb][0], imdb: [...imdb][0] }
}

function isoDate(input?: string | null) {
  if (!input || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(input))
    return undefined
  const date = Date.parse(input)
  return Number.isFinite(date) && new Date(date).getUTCFullYear() > 1900
    ? new Date(date).toISOString()
    : undefined
}

export async function readJellyfinSource(
  target: JellyfinTarget,
  credentials: { username: string, password: string },
  signal: AbortSignal,
): Promise<JellyfinSource> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(MAX_READ_TIME)])
  const deviceId = randomUUID()
  const agent = `MediaBrowser Client="Torsher", Device="Profile Import", DeviceId="${deviceId}", Version="${String(config.version).replace(/[^\w.-]/g, '')}"`
  const policy = {
    origin: target.base.origin,
    lanAddresses: target.private ? target.addresses : [],
    confirmedAddresses: target.addresses,
  }
  let remaining = MAX_BYTES
  let token: string | undefined
  let logoutWarning = false

  async function request(
    path: string,
    query?: Record<string, string>,
    options: { body?: string, logout?: boolean, maxBytes?: number } = {},
  ) {
    const url = new URL(target.base)
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
    url.search = new URLSearchParams(query).toString()
    const headers = {
      Accept: 'application/json',
      Authorization: token ? `${agent}, Token="${token}"` : agent,
      ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
    }
    const remote = await trustedHttpRequest(url, policy, {
      method: options.body !== undefined || options.logout ? 'POST' : 'GET',
      headers,
      body: options.body,
      signal: options.logout ? AbortSignal.timeout(5000) : deadline,
    })
    try {
      const { response } = remote
      if (response.status === 401 || response.status === 403)
        throw new JellyfinImportError('auth')
      if (response.status === 404)
        throw new JellyfinImportError('unsupported')
      if (!response.ok)
        throw new JellyfinImportError('response')
      if (options.logout)
        return
      const body = await readBodyLimited(response, Math.min(remaining, options.maxBytes ?? remaining))
      remaining -= body.length
      return JSON.parse(body.toString('utf8')) as unknown
    }
    finally {
      await remote.close()
    }
  }

  async function readItems(userId: string) {
    const rawItems = new Map<string, unknown>()
    let total: number | undefined
    do {
      const startIndex = rawItems.size
      const data = await request('Items', {
        userId,
        recursive: 'true',
        includeItemTypes: 'Movie,Episode',
        isPlayed: 'true',
        enableUserData: 'true',
        enableTotalRecordCount: 'true',
        fields: 'ProviderIds',
        sortBy: 'SortName',
        startIndex: String(startIndex),
        limit: String(PAGE_SIZE),
      })
      const page = pageSchema.parse(data)
      if (page.TotalRecordCount > MAX_ITEMS)
        throw new JellyfinImportError('limit')
      if ((page.StartIndex !== undefined && page.StartIndex !== startIndex)
        || (total !== undefined && total !== page.TotalRecordCount)
        || page.Items.length > PAGE_SIZE
        || startIndex + page.Items.length > page.TotalRecordCount
        || (!page.Items.length && startIndex < page.TotalRecordCount)) {
        throw new JellyfinImportError('response')
      }
      total = page.TotalRecordCount
      for (const raw of page.Items) {
        const id = compactId(raw.Id)
        if (rawItems.has(id))
          throw new JellyfinImportError('response')
        rawItems.set(id, raw)
      }
    } while (rawItems.size < total)

    const parents = new Map<string, JellyfinItem['ids']>()
    const items: JellyfinItem[] = []
    for (const raw of rawItems.values()) {
      deadline.throwIfAborted()
      const parsed = itemSchema.safeParse(raw)
      const item = parsed.data
      if (!item) {
        const { Type } = raw as { Type?: unknown }
        if (Type !== 'Movie' && Type !== 'Episode')
          throw new JellyfinImportError('response')
        items.push({ kind: Type === 'Movie' ? 'movie' : 'episode', ids: null, season: 0, episode: 0 })
        continue
      }
      const lastActivityAt = isoDate(item.UserData.LastPlayedDate)
      if (item.Type === 'Movie') {
        items.push({ kind: 'movie', ids: providerIds(item.ProviderIds), season: 0, episode: 0, lastActivityAt })
        continue
      }
      const { SeriesId, ParentIndexNumber: season, IndexNumber: episode, IndexNumberEnd: end } = item
      if (!SeriesId || season == null || season < 0 || !episode || episode < 1 || (end != null && end !== episode)) {
        items.push({ kind: 'episode', ids: null, season: 0, episode: 0 })
        continue
      }
      const id = compactId(SeriesId)
      if (!parents.has(id)) {
        const parent = await request(`Items/${id}`, { userId }, { maxBytes: SMALL_RESPONSE }).catch((error: unknown) => {
          if (error instanceof JellyfinImportError && error.kind === 'unsupported')
            return null
          throw error
        })
        const parsed = seriesSchema.safeParse(parent)
        parents.set(id, parsed.success && compactId(parsed.data.Id) === id
          ? providerIds(parsed.data.ProviderIds)
          : null)
      }
      const ids = providerIds(item.ProviderIds)
      items.push({
        kind: 'episode',
        ids: ids ? (parents.get(id) ?? null) : null,
        season,
        episode,
        episodeTmdbId: ids?.tmdb,
        lastActivityAt,
      })
    }
    return items
  }

  let source: Omit<JellyfinSource, 'logoutWarning'> | undefined
  let failure: JellyfinImportError | undefined
  try {
    const server = serverInfo.parse(await request('System/Info/Public', undefined, { maxBytes: SMALL_RESPONSE }))
    if (!/^10\.11(?:\.|$)/.test(server.Version))
      throw new JellyfinImportError('unsupported')

    const auth = await request('Users/AuthenticateByName', undefined, {
      body: JSON.stringify({ Username: credentials.username, Pw: credentials.password }),
      maxBytes: SMALL_RESPONSE,
    }).finally(() => { credentials.password = '' })
    // Retain a valid token for logout even if the remainder of the response is invalid.
    token = authToken.safeParse(auth).data?.AccessToken
    const issued = authorization.parse(auth)
    const user = identity.parse(await request('Users/Me', undefined, { maxBytes: SMALL_RESPONSE }))
    if (compactId(server.Id) !== compactId(issued.ServerId) || compactId(user.Id) !== compactId(issued.User.Id))
      throw new JellyfinImportError('response')

    const userId = compactId(user.Id)
    source = {
      serverId: compactId(server.Id),
      userId,
      server: label(server.ServerName),
      user: label(user.Name),
      items: await readItems(userId),
    }
  }
  catch (error) {
    failure = sourceError(error)
  }
  finally {
    credentials.password = ''
    if (token) {
      try {
        await request('Sessions/Logout', undefined, { logout: true })
      }
      catch {
        logoutWarning = true
      }
    }
  }

  if (!source)
    throw new JellyfinImportError(failure?.kind ?? 'response', logoutWarning)
  return { ...source, logoutWarning }
}
