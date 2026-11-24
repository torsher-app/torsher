import type {
  SubtitleProvider,
  SubtitleProviderStatus,
} from '../../dto/subtitles.ts'
import type { SubtitleLanguage } from './languages.ts'
import type { SubtitleCandidate } from './providerTypes.ts'
import type { ProviderCredentials } from './settings.ts'
import type { SubtitleTarget } from './target.ts'
import {
  checkOpenSubtitles,
  downloadOpenSubtitles,
  searchOpenSubtitles,
} from './opensubtitles.ts'
import { providerError, SubtitleProviderError } from './providerHttp.ts'
import {
  getSubtitleConfig,
  providerRevision,
  subtitleCredentials,
  updateConnection,
} from './settings.ts'
import { checkSubdl, downloadSubdl, searchSubdl } from './subdl.ts'

const QUOTA_TTL_MS = 5 * 60_000
const quota = new Map<
  SubtitleProvider,
  { revision: string, status: SubtitleProviderStatus, observedAt: number }
>()
const throttledSearch = new Map<
  SubtitleProvider,
  { revision: string, retryAt: number }
>()
const throttledDownload = new Map<
  SubtitleProvider,
  { revision: string, retryAt: number }
>()
const checked = new Map<
  SubtitleProvider,
  {
    revision: string
    checkedAt: number
    promise: Promise<SubtitleProviderStatus>
  }
>()

function updateQuota(
  provider: SubtitleProvider,
  revision: string,
  status: SubtitleProviderStatus,
) {
  if (providerRevision(getSubtitleConfig(), provider) !== revision)
    return status

  quota.set(provider, { revision, status, observedAt: Date.now() })
  return updateConnection(provider, revision, status)
}

function quotaOf(provider: SubtitleProvider, revision: string) {
  const known = quota.get(provider)
  if (known?.revision !== revision)
    return undefined
  const reset = known.status.resetAt
    ? Date.parse(known.status.resetAt)
    : undefined
  return reset === undefined
    ? Date.now() - known.observedAt < QUOTA_TTL_MS
      ? known.status
      : undefined
    : reset > Date.now()
      ? known.status
      : undefined
}

function downloadCooldown(
  provider: SubtitleProvider,
  credentials: ProviderCredentials,
) {
  const retry = throttledDownload.get(provider)
  if (retry?.revision === credentials.revision && retry.retryAt > Date.now()) {
    throw new SubtitleProviderError(
      'quota',
      new Date(retry.retryAt).toISOString(),
    )
  }
}

export function currentProviderCredentials(provider: SubtitleProvider) {
  try {
    return subtitleCredentials(getSubtitleConfig(), provider)
  }
  catch {
    throw new SubtitleProviderError('auth')
  }
}

export async function testSubtitleConnection(
  provider: SubtitleProvider,
): Promise<SubtitleProviderStatus> {
  const config = getSubtitleConfig()
  const revision = providerRevision(config, provider)
  try {
    const credentials = subtitleCredentials(config, provider)
    if (!credentials)
      return { kind: 'auth' }
    const check = checked.get(provider)
    if (
      check?.revision === credentials.revision
      && Date.now() - check.checkedAt < 5_000
    ) {
      return await check.promise
    }
    const promise = refreshQuota(provider, credentials)
    checked.set(provider, {
      revision: credentials.revision,
      checkedAt: Date.now(),
      promise,
    })
    return await promise
  }
  catch (error) {
    const failure = providerError(error)
    return updateConnection(provider, revision, {
      kind: failure.kind,
      resetAt: failure.resetAt,
    })
  }
}

async function refreshQuota(
  provider: SubtitleProvider,
  credentials: ProviderCredentials,
) {
  const signal = AbortSignal.timeout(15_000)
  const status
    = provider === 'opensubtitles'
      ? await checkOpenSubtitles(credentials, signal)
      : await checkSubdl(credentials, signal)
  return updateQuota(provider, credentials.revision, status)
}

export async function providerSearch(
  provider: SubtitleProvider,
  credentials: ProviderCredentials,
  target: SubtitleTarget,
  language: SubtitleLanguage,
  moviehash?: string,
) {
  try {
    const retry = throttledSearch.get(provider)
    const known = quotaOf(provider, credentials.revision)
    if (retry?.revision === credentials.revision && retry.retryAt > Date.now()) {
      throw new SubtitleProviderError(
        'quota',
        new Date(retry.retryAt).toISOString(),
      )
    }
    if (known?.remainingSearches === 0)
      throw new SubtitleProviderError('quota', known.resetAt)
    const signal = AbortSignal.timeout(15_000)
    return provider === 'opensubtitles'
      ? await searchOpenSubtitles(
          credentials,
          target,
          language,
          signal,
          moviehash,
        )
      : await searchSubdl(credentials, target, language, signal)
  }
  catch (error) {
    const failure = providerError(error)
    if (failure.kind === 'quota') {
      throttledSearch.set(provider, {
        revision: credentials.revision,
        retryAt: failure.resetAt
          ? Date.parse(failure.resetAt)
          : Date.now() + 60_000,
      })
    }
    else {
      updateConnection(provider, credentials.revision, { kind: failure.kind })
    }
    throw failure
  }
}

interface PendingDownload {
  provider: SubtitleProvider
  automatic: boolean
  start: () => void
}
interface DownloadEntry {
  guards: Set<{ current: () => Promise<boolean>, automatic: boolean }>
  task: PendingDownload
  promise: Promise<Uint8Array>
  complete: boolean
}
const pending: PendingDownload[] = []
const downloads = new Map<string, DownloadEntry>()
const active = new Set<SubtitleProvider>()

function drain(provider: SubtitleProvider) {
  if (active.has(provider))
    return
  const found = pending.findIndex(
    item => item.provider === provider && !item.automatic,
  )
  const index
    = found >= 0
      ? found
      : pending.findIndex(item => item.provider === provider)
  const task = index >= 0 ? pending.splice(index, 1)[0] : undefined
  if (task) {
    active.add(provider)
    task.start()
  }
}

export function downloadCandidate(options: {
  candidate: SubtitleCandidate
  credentials: ProviderCredentials
  sourceRevision: string
  automatic: boolean
  current: () => Promise<boolean>
}) {
  const { candidate, credentials, sourceRevision, automatic, current }
    = options
  const { provider } = candidate
  const key = JSON.stringify([
    provider,
    credentials.revision,
    sourceRevision,
    candidate.remoteId,
  ])
  const guard = { current, automatic }

  function ticket(entry: DownloadEntry) {
    entry.guards.add(guard)
    if (!automatic)
      entry.task.automatic = false
    return {
      bytes: entry.promise,
      release() {
        entry.guards.delete(guard)
        if (
          entry.complete
          && !entry.guards.size
          && downloads.get(key) === entry
        ) {
          downloads.delete(key)
        }
      },
    }
  }

  const existing = downloads.get(key)
  if (existing)
    return ticket(existing)
  if (downloads.size >= 8)
    throw new SubtitleProviderError('quota')

  const result = Promise.withResolvers<Uint8Array>()
  let entry: DownloadEntry
  const validGuards = async () => {
    const guards = [...entry.guards]
    const valid = await Promise.all(guards.map(guard => guard.current()))
    return guards.filter((_, index) => valid[index])
  }
  const run = async () => {
    try {
      const authorizations = await validGuards()
      if (
        !authorizations.length
        || providerRevision(getSubtitleConfig(), provider) !== credentials.revision
      ) {
        throw new SubtitleProviderError('unavailable')
      }
      downloadCooldown(provider, credentials)
      const known = quotaOf(provider, credentials.revision)
      const useAutomaticBudget = authorizations.every(
        guard => guard.automatic,
      )
      const status
        = useAutomaticBudget || (provider === 'subdl' && !known)
          ? (known ?? (await refreshQuota(provider, credentials)))
          : known
      const stillAuthorized = await validGuards()
      if (
        !stillAuthorized.length
        || providerRevision(getSubtitleConfig(), provider) !== credentials.revision
      ) {
        throw new SubtitleProviderError('unavailable')
      }
      if (
        status?.remainingDownloads === 0
        || (stillAuthorized.every(guard => guard.automatic)
          && (status?.remainingDownloads ?? 0) <= 1)
      ) {
        throw new SubtitleProviderError('quota', status?.resetAt)
      }
      const signal = AbortSignal.timeout(30_000)
      const bytes = await (
        provider === 'opensubtitles'
          ? downloadOpenSubtitles(credentials, candidate, signal, next =>
              updateQuota(provider, credentials.revision, next))
          : downloadSubdl(credentials, candidate, signal)
      ).catch((error) => {
        const issue = providerError(error)
        if (issue.kind === 'quota') {
          throttledDownload.set(provider, {
            revision: credentials.revision,
            retryAt: issue.resetAt
              ? Date.parse(issue.resetAt)
              : Date.now() + 60_000,
          })
        }
        throw issue
      })
      if (provider === 'subdl') {
        // Счётчики поиска и скачивания независимы. После authenticated CDN
        // получаем квоту из /me, а при сбое считаем снимок устаревшим.
        await refreshQuota(provider, credentials).catch(() => {
          if (quota.get(provider)?.revision === credentials.revision)
            quota.delete(provider)
        })
      }
      result.resolve(bytes)
    }
    catch (error) {
      result.reject(providerError(error))
    }
    finally {
      entry.complete = true
      if (!entry.guards.size)
        downloads.delete(key)
      active.delete(provider)
      drain(provider)
    }
  }

  const task = { provider, automatic, start: () => void run() }
  entry = {
    guards: new Set(),
    task,
    promise: result.promise,
    complete: false,
  }
  downloads.set(key, entry)
  const download = ticket(entry)
  pending.push(task)
  drain(provider)
  return download
}
