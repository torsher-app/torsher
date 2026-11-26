import type { HttpAddon } from '../addons/index.ts'
import type { AddonTarget } from '../addons/target.ts'
import type { PlaybackSession } from '../media/sessions.ts'
import type { Cue } from '../media/webvtt.ts'
import type { SubtitleLanguage } from './languages.ts'
import type { SubtitleTarget } from './target.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { mapLimit } from '../../utils/mapLimit.ts'
import { configuredManifestUrl } from '../addons/config.ts'
import {
  AddonError,
  currentAddon,
  fetchAddonAsset,
  listEnabledAddons,
  onAddonChanged,
  readAddonResource,
  safeAddonText,
  supportsAddonResource,
} from '../addons/index.ts'
import { addonText } from '../addons/manifest.ts'
import {
  ADDON_CONCURRENCY,
  ADDON_QUERY_MS,
  addonTarget,
} from '../addons/target.ts'
import { addonUrl } from '../addons/transport.ts'
import { decodeSrt } from '../media/downloadedSubtitles.ts'
import { convertSubtitle } from '../media/subtitles.ts'
import { readBodyLimited } from '../net/body.ts'
import { toCatalogId } from '../tmdb/mappers.ts'
import { subtitleLanguage } from './languages.ts'

const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024
const MAX_CUES = 10_000
const MAX_RESULTS_PER_ADDON = 15
const MAX_RESULTS = 30
const MAX_DOWNLOADS = 4
const MAX_TRACKS = 32
const TRACKS_PER_SESSION = 4
const SRT_TIMING
  = /^\s*\d+ *\r?\n\d{1,4}:\d{2}:\d{2}[.,]\d{3} +--> +\d{1,4}:\d{2}:\d{2}[.,]\d{3}/

const subtitleRow = z.object({
  id: z.string().min(1).max(512),
  url: z.string().min(1).max(8192),
  lang: z.string().min(1).max(32),
  label: z.string().max(400).optional().catch(undefined),
})

type AddonRef = Pick<HttpAddon, 'id' | 'revision'>

export interface AddonSubtitleCandidate {
  provider: 'addon'
  addon: AddonRef
  addonName: string
  remoteId: string
  url: string
  language: SubtitleLanguage
  release: string
  match: 'title'
}

interface AddonSubtitleTrack {
  id: string
  addon: AddonRef
  remoteId: string
  language: SubtitleLanguage
  title: string
  offsetMs: number
  cues: Cue[]
}

const tracks = new Map<PlaybackSession, Map<string, AddonSubtitleTrack>>()
let downloads = 0

function matchingAddons(
  session: PlaybackSession,
  target: SubtitleTarget | undefined,
) {
  const type
    = session.addonMedia?.launch.target.type
      ?? (target && (target.type === 'tv' ? 'series' : 'movie'))
  if (!session.addonSubtitles || !type)
    return []
  const remote = session.addonMedia?.launch.target
  return listEnabledAddons('subtitles').filter(addon =>
    remote
      ? supportsAddonResource(addon.manifest, 'subtitles', type, remote.videoId)
      : addon.manifest.resources.some(
          resource =>
            resource.name === 'subtitles' && resource.types.includes(type),
        ),
  )
}

export function canSearchAddonSubtitles(
  session: PlaybackSession,
  target: SubtitleTarget | undefined,
) {
  return matchingAddons(session, target).length > 0
}

function sourceSize(session: PlaybackSession) {
  const size
    = session.addonMedia?.size
      ?? session.library?.size
      ?? session.torrent?.files?.[session.fileIndex]?.size
  return size !== undefined && Number.isSafeInteger(size) && size > 0
    ? size
    : undefined
}

async function readCandidates(
  addon: HttpAddon,
  target: AddonTarget,
  language: SubtitleLanguage,
  extra: Record<string, string | number>,
  signal: AbortSignal,
) {
  const { subtitles } = (await readAddonResource(
    addon,
    'subtitles',
    target.type,
    target.videoId,
    { extra, signal },
  )) as { subtitles: unknown[] }
  const candidates: AddonSubtitleCandidate[] = []
  const seen = new Set<string>()
  for (const item of subtitles) {
    const parsed = subtitleRow.safeParse(item)
    if (!parsed.success || subtitleLanguage(parsed.data.lang) !== language)
      continue
    const { id: remoteId, label, url } = parsed.data
    if (seen.has(remoteId))
      continue
    let asset: URL
    try {
      asset = addonUrl(url)
    }
    catch {
      continue
    }
    seen.add(remoteId)
    const sensitive = {
      urls: [asset],
      privateValues: [asset.pathname.split('/').at(-1) ?? ''],
    }
    const addonName = safeAddonText(addon, addon.manifest.name, sensitive)
    candidates.push({
      provider: 'addon',
      addon: { id: addon.id, revision: addon.revision },
      addonName,
      remoteId,
      url,
      language,
      release: safeAddonText(addon, label, sensitive) || addonName,
      // A response does not say how the add-on matched the video.
      match: 'title',
    })
    if (candidates.length >= MAX_RESULTS_PER_ADDON)
      break
  }
  return candidates
}

type Issue = 'unavailable' | 'quota'

export async function findAddonSubtitles(
  session: PlaybackSession,
  local: SubtitleTarget | undefined,
  language: SubtitleLanguage,
  locale: string,
  videoHash: string | undefined,
  signal: AbortSignal,
  current: () => Promise<boolean>,
): Promise<{ candidates: AddonSubtitleCandidate[], issues: Issue[] }> {
  const addons = matchingAddons(session, local)
  if (!addons.length)
    return { candidates: [], issues: [] }

  const budget = AbortSignal.any([signal, AbortSignal.timeout(ADDON_QUERY_MS)])
  let target = session.addonMedia?.launch.target
  if (!target && local) {
    const episode
      = local.season !== undefined && local.episode !== undefined
        ? { season: local.season, episode: local.episode }
        : undefined
    try {
      target = await addonTarget(
        toCatalogId(local.type, local.tmdbId),
        episode,
        locale,
        budget,
      )
    }
    catch {
      return { candidates: [], issues: ['unavailable'] }
    }
  }
  if (!target || !(await current()))
    return { candidates: [], issues: [] }

  const size = sourceSize(session)
  const extra = {
    ...(videoHash && local?.hashPath && { videoHash }),
    ...(size !== undefined && { videoSize: size }),
  }
  const issues = new Set<Issue>()
  const found = await mapLimit(addons, ADDON_CONCURRENCY, async (addon) => {
    if (
      !supportsAddonResource(
        addon.manifest,
        'subtitles',
        target.type,
        target.videoId,
      )
    ) {
      return []
    }
    if (budget.aborted) {
      issues.add('unavailable')
      return []
    }
    try {
      return await readCandidates(addon, target, language, extra, budget)
    }
    catch (error) {
      if (currentAddon(addon.id, addon.revision, 'subtitles')) {
        issues.add(
          error instanceof AddonError && error.kind === 'rate_limited'
            ? 'quota'
            : 'unavailable',
        )
      }
      return []
    }
  })
  return {
    candidates: found.flat().slice(0, MAX_RESULTS),
    issues: [...issues],
  }
}

export function addonSubtitleCurrent(addon: AddonRef) {
  return currentAddon(addon.id, addon.revision, 'subtitles')
}

export async function readAddonSubtitle(
  candidate: AddonSubtitleCandidate,
  signal: AbortSignal,
) {
  const addon = addonSubtitleCurrent(candidate.addon)
  if (!addon)
    throw new AddonError('not_found')
  if (downloads >= MAX_DOWNLOADS)
    throw new AddonError('busy')
  downloads++
  try {
    const asset = await fetchAddonAsset(addon, 'subtitles', candidate.url, {
      signal,
    })
    let text: string
    try {
      if (asset.response.status !== 200) {
        throw new AddonError(
          asset.response.status === 429 ? 'rate_limited' : 'unavailable',
        )
      }
      const bytes = await readBodyLimited(asset.response, MAX_SUBTITLE_BYTES)
      text = decodeSrt(bytes, candidate.language)
      if (
        Buffer.byteLength(text) > MAX_SUBTITLE_BYTES
        || !SRT_TIMING.test(text)
      ) {
        throw new AddonError('bad_response')
      }
    }
    finally {
      await asset.close()
    }

    signal.throwIfAborted()
    const parsed = await convertSubtitle(text, 'srt')
    if (parsed.length > MAX_CUES)
      throw new AddonError('bad_response')
    const assetUrls = [addonUrl(candidate.url), addonUrl(asset.url)]
    const privatePaths = assetUrls.map(
      url => url.pathname.split('/').at(-1) ?? '',
    )
    const urls = [configuredManifestUrl(addon), ...assetUrls]
    const cues = parsed.flatMap((cue) => {
      const lines = cue.text
        .replace(/<\/?[ibu]>/gi, '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
      return Number.isFinite(cue.start)
        && cue.start >= 0
        && Number.isFinite(cue.end)
        && cue.end > cue.start
        && lines.length
        && lines.every(line => addonText(line, urls, privatePaths))
        ? [{ ...cue, text: lines.join('\n') }]
        : []
    })
    if (!cues.length)
      throw new AddonError('bad_response')
    return cues
  }
  finally {
    downloads--
  }
}

function removeTrack(session: PlaybackSession, id: string) {
  const items = tracks.get(session)
  if (!items?.delete(id))
    return
  if (session.subtitle === id)
    session.subtitle = null
  if (!items.size)
    tracks.delete(session)
}

onAddonChanged((id, revision) => {
  for (const [session, items] of tracks) {
    for (const track of items.values()) {
      if (track.addon.id === id && track.addon.revision === revision)
        removeTrack(session, track.id)
    }
  }
})

export function clearAddonSubtitleTracks(session: PlaybackSession) {
  tracks.delete(session)
}

export function addonSubtitleTracks(session: PlaybackSession) {
  const items = tracks.get(session)
  if (!session.addonSubtitles || !items)
    return []
  return [...items.values()].filter(
    track => !!addonSubtitleCurrent(track.addon),
  )
}

export function addonSubtitleTrack(session: PlaybackSession, id: string) {
  const track = tracks.get(session)?.get(id)
  return session.addonSubtitles && track && addonSubtitleCurrent(track.addon)
    ? track
    : undefined
}

function saveTrack(session: PlaybackSession, track: AddonSubtitleTrack) {
  const items = tracks.get(session) ?? new Map<string, AddonSubtitleTrack>()
  const previous
    = items.size >= TRACKS_PER_SESSION
      ? [...items.keys()].find(id => id !== session.subtitle)
      : undefined
  const count = [...tracks.values()].reduce(
    (total, items) => total + items.size,
    0,
  )
  if (count - Number(!!previous) >= MAX_TRACKS)
    throw new AddonError('busy')
  if (previous)
    items.delete(previous)
  items.set(track.id, track)
  tracks.set(session, items)
}

export function existingAddonSubtitleTrack(
  session: PlaybackSession,
  candidate: AddonSubtitleCandidate,
) {
  return addonSubtitleTracks(session).find(
    track =>
      track.addon.id === candidate.addon.id
      && track.addon.revision === candidate.addon.revision
      && track.remoteId === candidate.remoteId,
  )
}

export function attachAddonSubtitleTrack(
  session: PlaybackSession,
  candidate: AddonSubtitleCandidate,
  cues: Cue[],
) {
  const existing = existingAddonSubtitleTrack(session, candidate)
  if (existing)
    return existing
  const track = {
    id: `a${randomUUID()}`,
    addon: candidate.addon,
    remoteId: candidate.remoteId,
    language: candidate.language,
    title: candidate.release,
    offsetMs: 0,
    cues,
  }
  saveTrack(session, track)
  return track
}

export function copyAddonSubtitleTracks(
  session: PlaybackSession,
  previous: PlaybackSession,
) {
  const items = addonSubtitleTracks(previous)
  if (!session.addonSubtitles || !items.length)
    return
  // При замене сеанса временно разделяем неизменяемый массив реплик.
  tracks.set(session, new Map(items.map(track => [track.id, { ...track }])))
}

export function addonSubtitleView(track: AddonSubtitleTrack) {
  return {
    id: track.id,
    language: track.language,
    title: track.title || null,
    codec: 'srt',
    external: true,
    forced: false,
    default: false,
    burnIn: false,
    offsetMs: track.offsetMs,
  }
}
