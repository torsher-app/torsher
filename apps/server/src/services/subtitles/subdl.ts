import type { SubtitleProviderStatus } from '../../dto/subtitles.ts'
import type { SubtitleLanguage } from './languages.ts'
import type { SubtitleCandidate } from './providerTypes.ts'
import type { ProviderCredentials } from './settings.ts'
import type { SubtitleTarget } from './target.ts'
import { subtitleLanguage } from './languages.ts'
import {
  count,
  isoDate,
  providerFile,
  providerJson,
  providerUrl,
  record,
  rows,
  SubtitleProviderError,
} from './providerHttp.ts'
import { bool, boundedLabel } from './providerTypes.ts'
import { exactSubtitleRelease } from './target.ts'

const API_ORIGIN = 'https://api.subdl.com'
const FILE_ORIGIN = 'https://dl.subdl.com'
const FILE_ORIGINS = [API_ORIGIN, FILE_ORIGIN]

function subdlHeaders(credentials: ProviderCredentials) {
  return { Authorization: `Bearer ${credentials.apiKey}` }
}

export async function checkSubdl(
  credentials: ProviderCredentials,
  signal: AbortSignal,
): Promise<SubtitleProviderStatus> {
  const body = await providerJson(new URL('/api/v2/me', API_ORIGIN), {
    headers: subdlHeaders(credentials),
    signal,
  })
  const usage = record(body.usage)
  const searches = record(usage.search)
  const downloads = record(usage.downloads)
  const remainingSearches = count(searches.remaining)
  const remainingDownloads = count(downloads.remaining)
  if (remainingSearches === undefined || remainingDownloads === undefined)
    throw new SubtitleProviderError('unavailable')
  return {
    kind:
      remainingDownloads === 0 || remainingSearches === 0 ? 'quota' : 'ready',
    remainingDownloads,
    remainingSearches,
    resetAt: isoDate(
      downloads.period_end ?? downloads.reset_at ?? searches.period_end,
    ),
  }
}

function safeFileLink(value: unknown) {
  if (typeof value !== 'string')
    return undefined
  try {
    const url = providerUrl(value, FILE_ORIGINS, FILE_ORIGIN)
    return /^\/subtitle\/[^/]+\/[^/]+$/.test(url.pathname)
      ? url.href
      : undefined
  }
  catch {
    return undefined
  }
}

function matchesEpisode(target: SubtitleTarget, file: Record<string, unknown>) {
  return (
    target.type === 'movie'
    || (count(file.season) === target.season
      && count(file.episode) === target.episode)
  )
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

export async function searchSubdl(
  credentials: ProviderCredentials,
  target: SubtitleTarget,
  language: SubtitleLanguage,
  signal: AbortSignal,
) {
  const url = new URL('/api/v2/subtitles/search', API_ORIGIN)
  url.searchParams.set('tmdb_id', String(target.tmdbId))
  url.searchParams.set('type', target.type)
  url.searchParams.set('languages', language)
  if (target.type === 'tv') {
    url.searchParams.set('season', String(target.season))
    url.searchParams.set('episode', String(target.episode))
  }
  const body = await providerJson(url, {
    headers: subdlHeaders(credentials),
    signal,
  })
  if (!Array.isArray(body.subtitles)) {
    const issue = record(body.error)
    throw new SubtitleProviderError(
      issue.code === 'quota_exceeded' ? 'quota' : 'unavailable',
    )
  }
  if (!body.subtitles.length)
    return []
  if (
    !rows(body.results).some(
      item =>
        Number(item.tmdb_id) === target.tmdbId
        && (!item.type || item.type === target.type),
    )
  ) {
    return []
  }
  const candidates: SubtitleCandidate[] = []
  for (const row of rows(body.subtitles)) {
    const id = stringValue(row.n_id) ?? stringValue(row.nId)
    if (!id || !/^[\w-]{1,100}$/.test(id))
      continue
    const files = rows(row.unpack_files)
    for (const file of files) {
      if (
        !matchesEpisode(target, file)
        || subtitleLanguage(
          stringValue(file.language)
          ?? stringValue(row.lang)
          ?? stringValue(row.language),
        ) !== language
        || (file.format !== 'srt' && !/\.srt$/i.test(stringValue(file.name) ?? ''))
      ) {
        continue
      }
      const fileLink = files.length === 1 ? undefined : safeFileLink(file.url)
      if (files.length > 1 && !fileLink)
        continue
      const release
        = boundedLabel(file.release_name) || boundedLabel(row.release_name)
      candidates.push({
        provider: 'subdl',
        remoteId: fileLink
          ? `${id}:${stringValue(file.file_n_id) ?? new URL(fileLink).pathname}`
          : id,
        fileLink,
        language,
        release: release || boundedLabel(file.name) || target.release,
        match: exactSubtitleRelease(target.release, release)
          ? 'release'
          : 'title',
        forced: bool(file.forced ?? row.forced),
        hearingImpaired: bool(file.hi ?? row.hi),
      })
    }
  }
  return candidates
}

export async function downloadSubdl(
  credentials: ProviderCredentials,
  candidate: SubtitleCandidate,
  signal: AbortSignal,
) {
  if (candidate.fileLink) {
    const link = providerUrl(candidate.fileLink, FILE_ORIGINS)
    return providerFile(link.href, FILE_ORIGINS, signal, {
      origin: link.origin,
      headers:
        link.origin === FILE_ORIGIN
          ? { 'X-API-Key': credentials.apiKey }
          : subdlHeaders(credentials),
    })
  }
  const url = new URL(
    `/api/v2/subtitles/${encodeURIComponent(candidate.remoteId)}/download?format=file`,
    API_ORIGIN,
  )
  return providerFile(url.href, FILE_ORIGINS, signal, {
    origin: API_ORIGIN,
    headers: subdlHeaders(credentials),
  })
}
