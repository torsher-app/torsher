import type { AddonSubtitleCandidate } from './addons.ts'
import type { SubtitleProvider } from '../../dto/subtitles.ts'
import type { PlaybackSession } from '../media/sessions.ts'
import type { DownloadedSubtitle } from '../../db/schema.ts'
import type { SubtitleLanguage } from './languages.ts'
import type { SubtitleCandidate } from './providerTypes.ts'
import type { SubtitleTarget } from './target.ts'
import { randomUUID } from 'node:crypto'
import { createRateLimiter } from '../../utils/rateLimit.ts'
import { AddonError } from '../addons/index.ts'
import {
  assertMaintenanceMutation,
  MaintenanceBusyError,
  withMaintenanceLease,
} from '../libraryMaintenance/admission.ts'
import {
  downloadedSubtitleId,
  registerDownloadedSubtitle,
  removeDownloadedSubtitle,
  storedProviderSubtitle,
  SubtitleArtifactConflict,
  subtitleOffsetsOf,
  SubtitlePublicationCancelled,
} from '../media/downloadedSubtitles.ts'
import {
  activeDownloadedSubtitleIds,
  attachDownloadedSubtitle,
  currentSubtitleSource,
  detachDownloadedSubtitle,
  subtitleSessionSignal,
} from '../media/sessions.ts'
import { getProfile } from '../profiles/index.ts'
import {
  addonSubtitleCurrent,
  addonSubtitleView,
  attachAddonSubtitleTrack,
  canSearchAddonSubtitles,
  existingAddonSubtitleTrack,
  findAddonSubtitles,
  readAddonSubtitle,
} from './addons.ts'
import { subtitleLanguages } from './languages.ts'
import { providerError } from './providerHttp.ts'
import {
  currentProviderCredentials,
  downloadCandidate,
  providerSearch,
} from './providers.ts'
import {
  getSubtitleConfig,
  providerRevision,
  providersForViewer,
} from './settings.ts'
import {
  openSubtitlesHash,
  sameSubtitleTarget,
  subtitleTarget,
} from './target.ts'

export class SubtitlePlaybackError extends Error {
  readonly status: 404 | 409 | 429 | 502

  constructor(status: 404 | 409 | 429 | 502, message: string) {
    super(message)
    this.status = status
  }
}

export interface SubtitleViewer {
  owner: boolean
  profileId: string
  current: () => boolean
}

interface Result {
  candidate: SubtitleCandidate | AddonSubtitleCandidate
  profileId: string
  owner: boolean
  revision: string
  providerRevision?: string
  target?: SubtitleTarget
  expiresAt: number
}

const RESULT_TTL_MS = 10 * 60_000
const results = new WeakMap<PlaybackSession, Map<string, Result>>()
const searchLimiter = createRateLimiter({ limit: 8, windowMs: 60_000 })
const applyLimiter = createRateLimiter({ limit: 12, windowMs: 60_000 })
const matchRank = { hash: 0, release: 1, title: 2 }

function notFound() {
  return new SubtitlePlaybackError(404, 'Subtitle result is unavailable')
}

function searchable(session: PlaybackSession) {
  return (
    session.status === 'ready'
    && session.media !== null
    && !!session.playedEvidence
  )
}

export function subtitleSearchContextOf(
  session: PlaybackSession,
  owner: boolean,
  profileId: string,
  downloaded: DownloadedSubtitle[],
) {
  const canRemove = owner && downloaded.length > 0
  const config = getSubtitleConfig()
  const allowed = providersForViewer(config, owner)
  const ready = searchable(session)
  const target
    = ready && (allowed.length || session.addonSubtitles)
      ? subtitleTarget(session)
      : undefined
  const providers = [
    ...(target ? allowed : []),
    ...(ready && canSearchAddonSubtitles(session, target)
      ? ['addon' as const]
      : []),
  ]
  if (!providers.length && !canRemove)
    return undefined
  const locale = getProfile(profileId)?.language
  return {
    providers,
    languages: [...subtitleLanguages],
    defaultLanguage: locale === 'ru_RU' ? ('ru' as const) : ('en' as const),
    canRemove,
  }
}

export function downloadedSubtitleView(
  track: DownloadedSubtitle,
  offsetMs: number,
) {
  return {
    id: downloadedSubtitleId(track),
    language: track.language,
    title: track.title,
    codec: 'srt',
    external: true,
    forced: track.forced,
    default: false,
    burnIn: false,
    downloaded: true,
    offsetMs,
  }
}

async function currentTarget(
  session: PlaybackSession,
  viewer: SubtitleViewer,
  revision: string,
  expected: SubtitleTarget | undefined,
  provider?: SubtitleProvider,
  providerKey?: string,
) {
  if (
    revision !== (await currentSubtitleSource(session))
    || !viewer.current()
    || (expected
      ? !sameSubtitleTarget(expected, subtitleTarget(session))
      : !session.addonMedia)
  ) {
    return false
  }
  if (!provider)
    return true

  const config = getSubtitleConfig()
  return (
    providerRevision(config, provider) === providerKey
    && providersForViewer(config, viewer.owner).includes(provider)
  )
}

export async function searchPlaybackSubtitles(
  session: PlaybackSession,
  viewer: SubtitleViewer,
  language: SubtitleLanguage,
) {
  const config = getSubtitleConfig()
  if (!searchable(session))
    throw notFound()
  const target = subtitleTarget(session)
  const providers = target ? providersForViewer(config, viewer.owner) : []
  const addonSearch = canSearchAddonSubtitles(session, target)
  const revision = session.playedEvidence?.probeKey
  if (!revision || (!providers.length && !addonSearch))
    throw notFound()
  if (!searchLimiter.hit(session.subject))
    throw new SubtitlePlaybackError(429, 'Subtitle search rate limit exceeded')

  const current = () => currentTarget(session, viewer, revision, target)
  const moviehash
    = addonSearch || providers.includes('opensubtitles')
      ? await openSubtitlesHash(target?.hashPath)
      : undefined
  if (!(await current()))
    throw notFound()

  const locale
    = getProfile(viewer.profileId)?.language === 'ru_RU' ? 'ru-RU' : 'en-US'
  const [found, addons] = await Promise.all([
    Promise.all(
      providers.map(async (provider) => {
        try {
          const credentials = currentProviderCredentials(provider)
          if (
            !credentials
            || credentials.revision !== providerRevision(config, provider)
          ) {
            return { provider, issue: 'auth' as const }
          }
          const matches = await providerSearch(
            provider,
            credentials,
            target!,
            language,
            moviehash,
          )
          return {
            provider,
            candidates: matches,
            providerKey: credentials.revision,
          }
        }
        catch (error) {
          return { provider, issue: providerError(error).kind }
        }
      }),
    ),
    addonSearch
      ? findAddonSubtitles(
          session,
          target,
          language,
          locale,
          moviehash,
          subtitleSessionSignal(session),
          current,
        )
      : undefined,
  ])
  if (!(await current()))
    throw notFound()

  const currentConfig = getSubtitleConfig()
  const currentResults = results.get(session) ?? new Map<string, Result>()
  for (const [id, entry] of currentResults) {
    if (Date.now() >= entry.expiresAt)
      currentResults.delete(id)
  }
  const items = []
  const issues = []
  const register = (candidate: Result['candidate'], providerKey?: string) => {
    const id = randomUUID()
    currentResults.set(id, {
      candidate,
      profileId: viewer.profileId,
      owner: viewer.owner,
      revision,
      providerRevision: providerKey,
      target,
      expiresAt: Date.now() + RESULT_TTL_MS,
    })
    return id
  }
  for (const result of found) {
    if (result.issue) {
      issues.push({ provider: result.provider, kind: result.issue })
      continue
    }
    if (
      result.providerKey !== providerRevision(currentConfig, result.provider)
      || !providersForViewer(currentConfig, viewer.owner).includes(result.provider)
    ) {
      continue
    }
    const ordered = result.candidates.sort(
      (a, b) => matchRank[a.match] - matchRank[b.match],
    )
    const unique = new Set<string>()
    for (const candidate of ordered) {
      if (unique.size >= 15)
        break
      if (unique.has(candidate.remoteId))
        continue
      unique.add(candidate.remoteId)
      items.push({
        id: register(candidate, result.providerKey),
        provider: candidate.provider,
        language: candidate.language,
        release: candidate.release,
        match: candidate.match,
        forced: candidate.forced,
        hearingImpaired: candidate.hearingImpaired,
      })
    }
  }
  for (const candidate of addons?.candidates ?? []) {
    if (addonSubtitleCurrent(candidate.addon)) {
      items.push({
        id: register(candidate),
        provider: candidate.provider,
        addonName: candidate.addonName || undefined,
        language: candidate.language,
        release: candidate.release,
        match: candidate.match,
      })
    }
  }
  for (const kind of addons?.issues ?? [])
    issues.push({ provider: 'addon' as const, kind })
  while (currentResults.size > 90)
    currentResults.delete(currentResults.keys().next().value!)
  results.set(session, currentResults)
  return { items, issues }
}

export async function applyPlaybackSubtitle(
  session: PlaybackSession,
  viewer: SubtitleViewer,
  resultId: string,
) {
  const result = results.get(session)?.get(resultId)
  if (
    !result
    || result.profileId !== viewer.profileId
    || result.owner !== viewer.owner
    || result.expiresAt <= Date.now()
  ) {
    throw notFound()
  }
  const { candidate, revision, target, providerRevision: key } = result
  const current = async () =>
    candidate.provider === 'addon'
      ? !!(await currentTarget(session, viewer, revision, target))
      && !!session.addonSubtitles
      && !!addonSubtitleCurrent(candidate.addon)
      : currentTarget(
          session,
          viewer,
          revision,
          target,
          candidate.provider,
          key,
        )
  if (!(await current()))
    throw notFound()
  if (!applyLimiter.hit(session.subject)) {
    throw new SubtitlePlaybackError(
      429,
      'Subtitle download rate limit exceeded',
    )
  }

  try {
    if (candidate.provider === 'addon') {
      const existing = existingAddonSubtitleTrack(session, candidate)
      if (existing)
        return addonSubtitleView(existing)
      const cues = await readAddonSubtitle(
        candidate,
        subtitleSessionSignal(session),
      )
      if (!(await current()))
        throw notFound()
      return addonSubtitleView(
        attachAddonSubtitleTrack(session, candidate, cues),
      )
    }

    if (!target || !key)
      throw notFound()
    const credentials = currentProviderCredentials(candidate.provider)
    if (!credentials || credentials.revision !== key)
      throw notFound()
    const ownerOnly = candidate.provider === 'subdl'
    const existing = await storedProviderSubtitle(
      revision,
      candidate.provider,
      candidate.remoteId,
      ownerOnly,
    )
    let track = existing
    if (!track) {
      const resource = {
        mediaFileId: target.library?.id,
        torrentId: session.torrent?.id,
        producer: true,
      }
      assertMaintenanceMutation(resource)
      const download = downloadCandidate({
        candidate,
        credentials,
        sourceRevision: revision,
        current,
        automatic: false,
      })
      try {
        const bytes = await download.bytes
        track = await withMaintenanceLease(resource, () =>
          registerDownloadedSubtitle(
            revision,
            {
              language: candidate.language,
              title: candidate.release,
              ownerOnly,
              forced: candidate.forced ?? false,
            },
            bytes,
            {
              provider: candidate.provider,
              providerFile: candidate.remoteId,
              hearingImpaired: candidate.hearingImpaired,
              library: target.library,
              canPublish: current,
              activeIds: activeDownloadedSubtitleIds,
            },
          ))
      }
      finally {
        download.release()
      }
    }
    if (!(await current()))
      throw notFound()
    attachDownloadedSubtitle(session, track)
    const offset
      = subtitleOffsetsOf(viewer.profileId, revision).get(
        downloadedSubtitleId(track),
      ) ?? 0
    return downloadedSubtitleView(track, offset)
  }
  catch (error) {
    if (error instanceof SubtitlePlaybackError)
      throw error
    if (error instanceof SubtitlePublicationCancelled || !(await current()))
      throw notFound()
    if (error instanceof SubtitleArtifactConflict)
      throw new SubtitlePlaybackError(409, 'Subtitle file has changed')
    if (error instanceof MaintenanceBusyError)
      throw new SubtitlePlaybackError(409, 'Subtitle source is busy')
    if (
      (error instanceof AddonError && error.kind === 'rate_limited')
      || providerError(error).kind === 'quota'
    ) {
      throw new SubtitlePlaybackError(429, 'Subtitle download quota exceeded')
    }
    throw new SubtitlePlaybackError(502, 'Subtitle download failed')
  }
}

export async function removePlaybackSubtitle(
  session: PlaybackSession,
  viewer: SubtitleViewer,
  trackId: string,
) {
  const track = session.downloadedSubtitles.find(
    row => downloadedSubtitleId(row) === trackId,
  )
  if (!viewer.owner || !track)
    throw notFound()
  try {
    await withMaintenanceLease(
      {
        mediaFileId: session.library?.id,
        torrentId: session.torrent?.id,
        producer: true,
      },
      async () => {
        if (
          track.sourceRevision !== (await currentSubtitleSource(session))
          || !viewer.current()
          || !session.downloadedSubtitles.includes(track)
        ) {
          throw notFound()
        }
        removeDownloadedSubtitle(track, true)
        detachDownloadedSubtitle(track)
      },
    )
  }
  catch (error) {
    if (error instanceof SubtitlePlaybackError)
      throw error
    if (error instanceof MaintenanceBusyError)
      throw new SubtitlePlaybackError(409, 'Subtitle source is busy')
    throw new SubtitlePlaybackError(502, 'Subtitle removal failed')
  }
}
