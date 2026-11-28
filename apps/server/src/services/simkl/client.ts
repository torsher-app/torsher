import type { SimklErrorKind, SimklScope } from '../../dto/simkl.ts'
import type { SimklCursor } from '../../db/schema.ts'
import { setTimeout as wait } from 'node:timers/promises'
import { z } from 'zod'
import { config } from '../../config.ts'
import { netFetch } from '../net/index.ts'
import { BodyTooLargeError, readBodyLimited } from '../net/body.ts'

const ORIGIN = 'https://api.simkl.com'
const BODY_LIMIT = 32 * 1024 * 1024
const SHORT_BODY_LIMIT = 256 * 1024

export class SimklError extends Error {
  readonly kind: SimklErrorKind

  constructor(kind: SimklErrorKind) {
    super(kind)
    this.kind = kind
  }
}

const providerCode = z.enum([
  'authorization_pending',
  'slow_down',
  'expired_token',
  'access_denied',
  'invalid_grant',
  'invalid_token',
  'invalid_scope',
  'insufficient_scope',
  'user_limit_exceeded',
  'rate_limit',
  'RATE_LIMIT',
  'client_id_failed',
  'max_items',
])

export class SimklRequestError extends SimklError {
  readonly status: number
  readonly code?: z.infer<typeof providerCode>
  readonly retryAt: number

  constructor(status: number, code?: z.infer<typeof providerCode>, retryAt = 0) {
    super('provider')
    this.status = status
    this.code = code
    this.retryAt = retryAt
  }

  get limited() {
    return this.status === 429 || this.status === 412 || this.code === 'RATE_LIMIT'
  }

  get unauthorized() {
    return this.status === 401 || this.code === 'invalid_grant'
      || this.code === 'invalid_token' || this.code === 'invalid_scope'
      || this.code === 'insufficient_scope'
  }

  get ambiguous() {
    return this.status === 0 || this.status >= 500
  }
}

async function request(
  clientId: string,
  path: string,
  options: {
    query?: Record<string, string>
    signal?: AbortSignal
    form?: Record<string, string>
    access?: string
    body?: unknown
    limit?: number
  } = {},
): Promise<unknown> {
  const url = new URL(path, ORIGIN)
  const headers = new Headers({
    'Accept': 'application/json',
    'User-Agent': `Torsher/${config.version}`,
  })
  let body: string | undefined
  if (options.form) {
    body = new URLSearchParams({ ...options.form, client_id: clientId }).toString()
    headers.set('content-type', 'application/x-www-form-urlencoded')
  }
  else {
    for (const [key, value] of Object.entries({
      ...options.query,
      'client_id': clientId,
      'app-name': 'torsher',
      'app-version': config.version,
    })) {
      url.searchParams.set(key, value)
    }
    if (options.access)
      headers.set('authorization', `Bearer ${options.access}`)
    if (options.body !== undefined) {
      body = JSON.stringify(options.body)
      headers.set('content-type', 'application/json')
    }
  }
  const timeout = AbortSignal.timeout(15_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  try {
    const response = await netFetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body,
      signal,
      redirect: 'error',
    })
    const bytes = await readBodyLimited(response, response.ok ? options.limit ?? SHORT_BODY_LIMIT : 4096)
    let value: unknown
    if (bytes.length) {
      try {
        value = JSON.parse(bytes.toString('utf8'))
      }
      catch {
        if (response.ok)
          throw new SimklRequestError(502)
      }
    }
    if (response.ok)
      return value

    const result = z.object({ error: providerCode }).safeParse(value)
    const code = result.success ? result.data.error : undefined
    const now = Date.now()
    const after = response.headers.get('retry-after')
    const until = after && /^\d+$/.test(after)
      ? now + Number(after) * 1000
      : after ? Date.parse(after) : NaN
    const normal = Number.isFinite(until) ? until : now + 60_000
    const retryAt = code === 'rate_limit'
      ? now + 1500
      : code === 'RATE_LIMIT'
        ? now + 20_000
        : response.status === 412 ? Math.max(normal, now + 15 * 60_000) : normal
    throw new SimklRequestError(response.status, code, retryAt)
  }
  catch (error) {
    if (error instanceof SimklRequestError)
      throw error
    if (error instanceof BodyTooLargeError && path.startsWith('/sync/all-items/'))
      throw new SimklRequestError(400, 'max_items')
    // A fetch error can contain an OAuth URL or a credentials-bearing object.
    throw new SimklRequestError(0)
  }
}

function validated<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new SimklRequestError(502)
  return result.data
}

const expires = z.int().positive().max(366 * 24 * 60 * 60)
const secret = z.string().min(1).max(8192).regex(/^[^\s\p{Cc}\p{Cf}]+$/u)

const deviceSchema = z.object({
  device_code: secret,
  user_code: z.string().regex(/^[A-Z0-9 -]{4,20}$/i),
  verification_uri: z.string().url().max(512),
  interval: z.int().positive().max(120).default(5),
  expires_in: z.int().positive().max(1800),
})

export async function requestDevice(clientId: string, scope: SimklScope, signal: AbortSignal) {
  const device = validated(deviceSchema, await request(clientId, '/oauth2/device', {
    form: { scope: `media:${scope}` },
    signal,
  }))
  const uri = new URL(device.verification_uri)
  if (
    !['https://simkl.com', 'https://www.simkl.com'].includes(uri.origin)
    || uri.username || uri.password || uri.search || uri.hash
  ) {
    throw new SimklError('provider')
  }
  return device
}

export const grantSchema = z.object({
  access_token: secret,
  refresh_token: secret,
  expires_in: expires,
  scope: z.string().max(128),
})

export type Grant = z.infer<typeof grantSchema>

export function grantScope(grant: Grant): SimklScope {
  const scopes = grant.scope.trim().split(/\s+/)
  if (scopes.some(scope => scope !== 'media:write' && scope !== 'media:read'))
    throw new SimklError('scope')
  if (scopes.includes('media:write'))
    return 'write'
  if (scopes.includes('media:read'))
    return 'read'
  throw new SimklError('scope')
}

export async function redeemDevice(clientId: string, deviceCode: string) {
  return validated(grantSchema, await request(clientId, '/oauth2/token', {
    form: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode },
  }))
}

export async function refreshGrant(clientId: string, grant: Grant, signal: AbortSignal) {
  const raw = await request(clientId, '/oauth2/token', {
    form: { grant_type: 'refresh_token', refresh_token: grant.refresh_token },
    signal,
  })
  const tokens = validated(grantSchema.partial({ refresh_token: true, scope: true }), raw)
  return {
    ...tokens,
    refresh_token: tokens.refresh_token ?? grant.refresh_token,
    scope: tokens.scope ?? grant.scope,
  }
}

export async function revokeGrant(clientId: string, grant: Grant) {
  await request(clientId, '/oauth2/revoke', {
    form: { token: grant.refresh_token, token_type_hint: 'refresh_token' },
    signal: AbortSignal.timeout(5000),
  })
}

const id = z.int().positive()
const coord = z.int().nonnegative()
const accountSchema = z.object({
  user: z.object({ name: z.string().trim().min(1).max(256) }),
  account: z.object({ id }),
})

export async function identifyAccount(clientId: string, access: string) {
  return validated(accountSchema, await request(clientId, '/users/settings', { access }))
}

const cursorDate = z.iso.datetime({ offset: true })
const activitiesSchema = z.object({
  all: cursorDate.nullable(),
  movies: z.object({ all: cursorDate.nullish() }).nullish(),
  tv_shows: z.object({ all: cursorDate.nullish() }).nullish(),
})
const mediaId = id.or(z.string().regex(/^[1-9]\d{0,14}$/)).transform(value => Number(value))
const idsSchema = z.object({ simkl: id, tmdb: mediaId.nullish() })
const mediaSchema = z.object({ ids: idsSchema })
const movieItem = z.object({
  movie: mediaSchema,
  last_watched_at: cursorDate.nullish(),
  status: z.string(),
})
const episodeSchema = z.object({
  number: id,
  watched_at: cursorDate.nullish(),
})
const showItem = z.object({
  show: mediaSchema,
  seasons: z.array(z.object({
    number: coord,
    episodes: z.array(episodeSchema).nullish(),
  })).nullish(),
})

export interface RemoteWatch {
  simklId: number
  tmdbId: number | null
  season: number
  episode: number
  watchedAt: number | null
}

export function watchTime(value: string | null | undefined) {
  const time = value ? Date.parse(value) : NaN
  // Simkl uses the epoch (1970-01-01T00:00:01Z) for an unknown date.
  const second = Math.floor(time / 1000) * 1000
  return Number.isFinite(second) && second !== 1000 ? second : null
}

const historyBucket = z.strictObject({
  movies: z.array(movieItem).optional(),
  shows: z.array(showItem).optional(),
  anime: z.array(z.unknown()).optional(),
})

const CATALOG_TTL = 6 * 60 * 60_000
const knownTargets = new Map<string, { id: number, until: number }>()
const knownEpisodes = new Map<number, { keys: Set<string>, until: number }>()

function cache<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.size >= 512 && !map.has(key))
    map.delete(map.keys().next().value!)
  map.set(key, value)
}

export class SimklSession {
  private nextRequest = 0

  private readonly clientId: string
  private readonly access: string
  private readonly signal: AbortSignal

  constructor(clientId: string, access: string, signal: AbortSignal) {
    this.clientId = clientId
    this.access = access
    this.signal = signal
  }

  private async data(path: string, query?: Record<string, string>, body?: unknown, limit?: number) {
    this.signal.throwIfAborted()
    if (this.nextRequest > Date.now())
      await wait(this.nextRequest - Date.now(), undefined, { signal: this.signal })
    this.nextRequest = Date.now() + (body === undefined ? 110 : 1100)
    return request(this.clientId, path, { access: this.access, signal: this.signal, query, body, limit })
  }

  async activities(): Promise<SimklCursor> {
    const data = validated(activitiesSchema, await this.data('/sync/activities'))
    return { all: data.all, movies: data.movies?.all ?? null, shows: data.tv_shows?.all ?? null }
  }

  async history(kind: 'movies' | 'shows', since?: string) {
    const params: Record<string, string> = { ...(since ? { date_from: since } : {}) }
    if (kind === 'shows') {
      params.extended = 'full'
      params.include_all_episodes = 'original'
      params.episode_watched_at = 'yes'
    }
    const endpoint = `/sync/all-items/${kind}`
    const read = async (path: string): Promise<RemoteWatch[]> => {
      const raw = validated(historyBucket, await this.data(path, params, undefined, BODY_LIMIT))
      if (!raw[kind] && Object.values(raw).some(rows => rows?.length))
        throw new SimklRequestError(502)
      if (kind === 'movies') {
        return (raw.movies ?? []).flatMap((row) => {
          const watchedAt = watchTime(row.last_watched_at)
          if (!row.last_watched_at && row.status !== 'completed')
            return []
          return [{
            simklId: row.movie.ids.simkl,
            tmdbId: row.movie.ids.tmdb ?? null,
            season: 0,
            episode: 0,
            watchedAt,
          }]
        })
      }
      return (raw.shows ?? []).flatMap(row => (row.seasons ?? []).flatMap(season =>
        (season.episodes ?? []).map(episode => ({
          simklId: row.show.ids.simkl,
          tmdbId: row.show.ids.tmdb ?? null,
          season: season.number,
          episode: episode.number,
          watchedAt: watchTime(episode.watched_at),
        })),
      ))
    }

    try {
      return await read(endpoint)
    }
    catch (error) {
      if (!(error instanceof SimklRequestError) || error.code !== 'max_items')
        throw error
      const rows: RemoteWatch[] = []
      const buckets = kind === 'movies'
        ? ['plantowatch', 'completed', 'dropped']
        : ['watching', 'plantowatch', 'hold', 'completed', 'dropped']
      for (const bucket of buckets) {
        for (const row of await read(`${endpoint}/${bucket}`))
          rows.push(row)
      }
      return rows
    }
  }

  async resolve(tmdbId: number, season: number, episode: number) {
    const type = episode ? 'tv' : 'movie'
    const key = `${type}:${tmdbId}`
    const cached = knownTargets.get(key)
    let simklId = cached && cached.until > Date.now() ? cached.id : undefined
    if (!simklId) {
      const result = validated(z.array(z.object({
        type: z.string(),
        ids: idsSchema,
      })), await this.data('/search/id', { tmdb: String(tmdbId), type }))
      const matches = new Map(result
        .filter(row => (row.type === type || (type === 'tv' && row.type === 'show'))
          && (row.ids.tmdb == null || row.ids.tmdb === tmdbId))
        .map(row => [row.ids.simkl, row.ids]))
      if (matches.size !== 1)
        return undefined
      const ids = matches.values().next().value!
      simklId = ids.simkl
      if (!ids.tmdb) {
        const path = episode ? '/tv/' : '/movies/'
        const details = validated(mediaSchema, await this.data(`${path}${simklId}`))
        if (details.ids.simkl !== simklId || details.ids.tmdb !== tmdbId)
          return undefined
      }
      cache(knownTargets, key, { id: simklId, until: Date.now() + CATALOG_TTL })
    }
    if (episode) {
      let listed = knownEpisodes.get(simklId)
      if (!listed || listed.until <= Date.now()) {
        const episodes = validated(z.array(z.object({
          season: coord,
          episode: id,
        })), await this.data(`/tv/episodes/${simklId}`, undefined, undefined, BODY_LIMIT))
        const keys = new Set<string>()
        const duplicates = new Set<string>()
        for (const item of episodes) {
          const coordinate = `${item.season}:${item.episode}`
          if (keys.has(coordinate))
            duplicates.add(coordinate)
          keys.add(coordinate)
        }
        for (const duplicate of duplicates)
          keys.delete(duplicate)
        listed = { keys, until: Date.now() + CATALOG_TTL }
        cache(knownEpisodes, simklId, listed)
      }
      if (!listed.keys.has(`${season}:${episode}`))
        return undefined
    }
    return simklId
  }

  async append(row: Pick<RemoteWatch, 'simklId' | 'season' | 'episode'>, watchedAt: number) {
    const ids = { simkl: row.simklId }
    const watched_at = new Date(watchedAt).toISOString()
    const body = row.episode
      ? { shows: [{ ids, seasons: [{ number: row.season, episodes: [{ number: row.episode, watched_at }] }] }] }
      : { movies: [{ ids, watched_at }] }
    const result = validated(z.object({
      added: z.object({ movies: z.int().nonnegative(), episodes: z.int().nonnegative() }),
    }), await this.data('/sync/history', undefined, body))
    return (row.episode ? result.added.episodes : result.added.movies) === 1 ? 'added' : 'unconfirmed'
  }

  async lookup(row: Pick<RemoteWatch, 'simklId' | 'season' | 'episode'>) {
    const input = {
      ids: { simkl: row.simklId },
      ...(row.episode ? { season: row.season, episode: row.episode } : {}),
    }
    const result = validated(z.array(z.object({
      result: z.boolean().or(z.literal('not_found')),
      simkl: id.optional(),
      last_watched_at: cursorDate.nullish(),
      seasons: z.array(z.object({
        number: coord,
        episodes: z.array(z.object({
          number: id,
          watched: z.boolean(),
          last_watched_at: cursorDate.nullish(),
        })).nullish(),
      })).nullish(),
    })).length(1), await this.data('/sync/watched', row.episode ? { extended: 'episodes,specials' } : undefined, [input], BODY_LIMIT))[0]!
    if (result.result === 'not_found' || result.simkl !== row.simklId)
      return { kind: 'unknown' as const }
    if (!result.result)
      return { kind: 'absent' as const }
    if (!row.episode)
      return { kind: 'seen' as const, watchedAt: watchTime(result.last_watched_at) }
    const match = result.seasons?.find(item => item.number === row.season)?.episodes?.find(item => item.number === row.episode)
    if (!match)
      return { kind: 'unknown' as const }
    return match.watched
      ? { kind: 'seen' as const, watchedAt: watchTime(match.last_watched_at) }
      : { kind: 'absent' as const }
  }
}
