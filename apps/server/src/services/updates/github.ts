import { config } from '../../config.ts'
import { netFetch } from '../net/index.ts'

export const GITHUB_API_ORIGIN = 'https://api.github.com'
const TIMEOUT_MS = 15_000
// Пререлизы идут вперемешку со стабильными: двадцати последних хватает,
// чтобы в выборке были оба канала
const PER_PAGE = 20

// `not_found` — репозитория нет или он закрыт: GitHub отвечает 404
export type UpdateErrorKind
  = 'unavailable' | 'rate_limited' | 'invalid' | 'not_found'

export class UpdateCheckError extends Error {
  readonly kind: UpdateErrorKind
  // Раньше этого времени GitHub снова откажет (ответ 403/429 по лимиту)
  readonly retryAt?: Date

  constructor(kind: UpdateErrorKind, message: string, retryAt?: Date) {
    super(message)
    this.name = 'UpdateCheckError'
    this.kind = kind
    this.retryAt = retryAt
  }
}

export interface GithubRepo {
  owner: string
  repo: string
}

export interface GithubRelease {
  tagName: string
  name?: string
  body?: string
  url: string
  draft: boolean
  prerelease: boolean
  publishedAt?: string
}

/** Репозиторий исходников, если он на GitHub: сборка-форк проверяет свои релизы */
export function githubRepoOf(sourceUrl: string): GithubRepo | undefined {
  let url: URL

  try {
    url = new URL(sourceUrl)
  }
  catch {
    return undefined
  }

  if (url.hostname !== 'github.com')
    return undefined

  const [owner, name] = url.pathname.split('/').filter(Boolean)
  const repo = name?.replace(/\.git$/, '')

  return owner && repo ? { owner, repo } : undefined
}

function retryAtOf(response: Response) {
  const reset = Number(response.headers.get('x-ratelimit-reset'))

  if (reset > 0)
    return new Date(reset * 1000)

  const after = Number(response.headers.get('retry-after'))

  return after > 0 ? new Date(Date.now() + after * 1000) : undefined
}

function toRelease(raw: unknown): GithubRelease | undefined {
  if (!raw || typeof raw !== 'object')
    return undefined

  const item = raw as Record<string, unknown>

  if (typeof item.tag_name !== 'string' || typeof item.html_url !== 'string')
    return undefined

  return {
    tagName: item.tag_name,
    name: typeof item.name === 'string' ? item.name : undefined,
    body: typeof item.body === 'string' ? item.body : undefined,
    url: item.html_url,
    draft: item.draft === true,
    prerelease: item.prerelease === true,
    publishedAt:
      typeof item.published_at === 'string' ? item.published_at : undefined,
  }
}

export type ReleasesResult
  = | { notModified: true }
    | { notModified: false, releases: GithubRelease[], etag?: string }

/**
 * Последние релизы репозитория. Запрос без токена и идентификаторов сервера:
 * GitHub видит только адрес и версию в `User-Agent`, проект — ничего.
 */
export async function fetchReleases(
  { owner, repo }: GithubRepo,
  etag?: string,
): Promise<ReleasesResult> {
  const url = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=${PER_PAGE}`
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': `Torsher/${config.version}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  if (etag)
    headers['If-None-Match'] = etag

  let response: Response

  try {
    response = await netFetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }
  catch (err) {
    throw new UpdateCheckError(
      'unavailable',
      err instanceof Error ? err.message : String(err),
    )
  }

  if (response.status === 304)
    return { notModified: true }

  if (
    response.status === 429
    || (response.status === 403
      && response.headers.get('x-ratelimit-remaining') === '0')
  ) {
    throw new UpdateCheckError(
      'rate_limited',
      `GitHub rate limit (${response.status})`,
      retryAtOf(response),
    )
  }

  if (response.status === 404) {
    throw new UpdateCheckError(
      'not_found',
      'GitHub repository is not found or private',
    )
  }

  if (!response.ok) {
    throw new UpdateCheckError(
      'unavailable',
      `GitHub responded ${response.status}`,
    )
  }

  let body: unknown

  try {
    body = await response.json()
  }
  catch {
    throw new UpdateCheckError('invalid', 'GitHub returned invalid JSON')
  }

  if (!Array.isArray(body))
    throw new UpdateCheckError('invalid', 'GitHub returned no release list')

  return {
    notModified: false,
    releases: body.flatMap(item => toRelease(item) ?? []),
    etag: response.headers.get('etag') ?? undefined,
  }
}
