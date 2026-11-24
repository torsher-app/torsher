import type { SubtitleProviderStatus } from '../../dto/subtitles.ts'
import type { SubtitleLanguage } from './languages.ts'
import type { SubtitleCandidate } from './providerTypes.ts'
import type { ProviderCredentials } from './settings.ts'
import type { SubtitleTarget } from './target.ts'
import { Buffer } from 'node:buffer'
import { subtitleLanguage } from './languages.ts'
import {
  count,
  isoDate,
  providerError,
  providerFile,
  providerJson,
  providerUrl,
  record,
  rows,
  SubtitleProviderError,
} from './providerHttp.ts'
import { bool, boundedLabel } from './providerTypes.ts'
import { exactSubtitleRelease } from './target.ts'

const API_ORIGINS = [
  'https://api.opensubtitles.com',
  'https://vip-api.opensubtitles.com',
]
const FILE_ORIGINS = [
  ...API_ORIGINS,
  'https://www.opensubtitles.com',
  'https://opensubtitles.com',
  'https://download.opensubtitles.com',
  'https://dl.opensubtitles.com',
  'https://cdn.opensubtitles.com',
]

interface Login {
  token: string
  origin: string
}

let cached:
  { revision: string, expiresAt: number, result: Promise<Login> } | undefined

function loginExpiry(token: string) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    )
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp))
      return Math.min(Date.now() + 60 * 60_000, payload.exp * 1000 - 30_000)
  }
  catch {}
  return Date.now() + 5 * 60_000
}

export function clearOpenSubtitlesLogin() {
  cached = undefined
}

function openLogin(credentials: ProviderCredentials) {
  if (
    cached?.revision === credentials.revision
    && cached.expiresAt > Date.now()
  ) {
    return cached.result
  }

  const result = providerJson(new URL('/api/v1/login', API_ORIGINS[0]), {
    headers: { 'Api-Key': credentials.apiKey },
    body: { username: credentials.username, password: credentials.password },
    signal: AbortSignal.timeout(10_000),
  }).then((body) => {
    if (typeof body.token !== 'string' || !/^\S{1,4096}$/.test(body.token))
      throw new SubtitleProviderError('auth')

    const base
      = typeof body.base_url === 'string'
        ? body.base_url.trim()
        : API_ORIGINS[0]!
    const origin = providerUrl(
      base.startsWith('https://') ? base : `https://${base}`,
      API_ORIGINS,
    ).origin
    if (cached?.result === result)
      cached.expiresAt = loginExpiry(body.token)
    return { origin, token: body.token }
  })
  // Ошибку входа ненадолго сохраняем, чтобы параллельные запросы не дёргали логин.
  cached = {
    revision: credentials.revision,
    expiresAt: Date.now() + 30_000,
    result,
  }
  return result
}

async function openJson(
  credentials: ProviderCredentials,
  path: string,
  signal: AbortSignal,
  body?: object,
  query?: Record<string, string | undefined>,
) {
  const login = await openLogin(credentials)
  const url = new URL(`/api/v1/${path}`, login.origin)
  for (const [name, value] of Object.entries(query ?? {}).sort()) {
    if (value)
      url.searchParams.set(name, value.toLowerCase())
  }

  try {
    return await providerJson(url, {
      headers: {
        'Api-Key': credentials.apiKey,
        'Authorization': `Bearer ${login.token}`,
      },
      body,
      signal,
    })
  }
  catch (error) {
    const issue = providerError(error)
    if (issue.kind === 'auth' && cached?.revision === credentials.revision)
      cached.expiresAt = Math.min(cached.expiresAt, Date.now() + 15_000)
    throw issue
  }
}

export async function checkOpenSubtitles(
  credentials: ProviderCredentials,
  signal: AbortSignal,
): Promise<SubtitleProviderStatus> {
  const body = await openJson(credentials, 'infos/user', signal)
  const data = record(body.data)
  const remainingDownloads = count(data.remaining_downloads)
  if (remainingDownloads === undefined)
    throw new SubtitleProviderError('unavailable')
  return {
    kind: remainingDownloads === 0 ? 'quota' : 'ready',
    remainingDownloads,
  }
}

function matchesIdentity(
  target: SubtitleTarget,
  feature: Record<string, unknown>,
) {
  if (target.type === 'movie') {
    return (
      feature.tmdb_id === target.tmdbId && feature.feature_type !== 'Episode'
    )
  }
  return (
    feature.parent_tmdb_id === target.tmdbId
    && feature.season_number === target.season
    && feature.episode_number === target.episode
  )
}

export async function searchOpenSubtitles(
  credentials: ProviderCredentials,
  target: SubtitleTarget,
  language: SubtitleLanguage,
  signal: AbortSignal,
  moviehash?: string,
) {
  const body = await openJson(credentials, 'subtitles', signal, undefined, {
    type: target.type === 'movie' ? 'movie' : 'episode',
    tmdb_id: target.type === 'movie' ? String(target.tmdbId) : undefined,
    parent_tmdb_id: target.type === 'tv' ? String(target.tmdbId) : undefined,
    season_number:
      target.season === undefined ? undefined : String(target.season),
    episode_number:
      target.episode === undefined ? undefined : String(target.episode),
    moviehash,
    languages: language,
    ai_translated: 'exclude',
  })
  if (!Array.isArray(body.data))
    throw new SubtitleProviderError('unavailable')
  const candidates: SubtitleCandidate[] = []
  for (const row of rows(body.data)) {
    const attrs = record(row.attributes)
    if (
      typeof attrs.language !== 'string'
      || subtitleLanguage(attrs.language) !== language
      || !matchesIdentity(target, record(attrs.feature_details))
    ) {
      continue
    }
    const release = boundedLabel(attrs.release)
    const files = rows(attrs.files)
    const selected
      = files.length === 1
        ? files[0]
        : files.find(file =>
            exactSubtitleRelease(target.release, boundedLabel(file.file_name)),
          )
    const id = count(selected?.file_id)
    if (!id)
      continue
    candidates.push({
      provider: 'opensubtitles',
      remoteId: String(id),
      language,
      release: release || boundedLabel(selected?.file_name) || target.release,
      match:
        moviehash && attrs.moviehash_match === true
          ? 'hash'
          : exactSubtitleRelease(target.release, release)
            ? 'release'
            : 'title',
      forced: bool(attrs.foreign_parts_only),
      hearingImpaired: bool(attrs.hearing_impaired),
    })
  }
  return candidates
}

export async function downloadOpenSubtitles(
  credentials: ProviderCredentials,
  candidate: SubtitleCandidate,
  signal: AbortSignal,
  onQuota: (status: SubtitleProviderStatus) => void,
) {
  const body = await openJson(credentials, 'download', signal, {
    file_id: Number(candidate.remoteId),
    sub_format: 'srt',
  })
  const remainingDownloads = count(body.remaining)
  if (remainingDownloads !== undefined) {
    onQuota({
      kind: remainingDownloads === 0 ? 'quota' : 'ready',
      remainingDownloads,
      resetAt: isoDate(body.reset_time_utc),
    })
  }
  if (typeof body.link !== 'string')
    throw new SubtitleProviderError('unavailable')
  return providerFile(body.link, FILE_ORIGINS, signal)
}
