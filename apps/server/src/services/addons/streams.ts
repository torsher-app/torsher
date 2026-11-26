import type { Torrent } from '../../db/schema.ts'
import type { AddonSourcePlayback } from '../../dto/addonViewer.ts'
import type { HttpAddon } from './index.ts'
import type { AddonTarget } from './target.ts'
import { randomUUID } from 'node:crypto'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { z } from 'zod'
import { mapLimit } from '../../utils/mapLimit.ts'
import { unavailableTorrentFiles } from '../library/folders.ts'
import { titleAllowedCached } from '../profiles/access.ts'
import { seasonOfFile } from '../sources/watch.ts'
import {
  addMagnet,
  getTorrent,
  isVideoFile,
  linkTitle,
  torrentsByInfoHash,
} from '../torrents/index.ts'
import { isPublicMetainfo } from '../torrents/metainfo.ts'
import {
  AddonError,
  addonRequestHeaders,
  addonRevisionSignal,
  currentAddon,
  listEnabledAddons,
  onAddonChanged,
  readAddonResource,
  safeAddonText,
  supportsAddonResource,
} from './index.ts'
import { ADDON_CONCURRENCY } from './target.ts'
import { addonUrl } from './transport.ts'

const CANDIDATE_TTL = 10 * 60_000
const LAUNCH_TTL = 2 * 60_000
const MAX_CANDIDATES = 4096
const MAX_LAUNCHES = 256
const MAX_ITEMS = 500

const boundedText = z.string().max(300).optional().catch(undefined)
const streamFields = z
  .object({
    infoHash: z
      .string()
      .regex(/^[0-9a-f]{40}$/i)
      .optional(),
    fileIdx: z.number().int().min(0).max(65535).optional(),
    url: z.string().max(8192).optional(),
    name: boundedText,
    title: boundedText,
    behaviorHints: z
      .object({
        filename: boundedText,
        proxyHeaders: z
          .object({
            request: z.record(z.string(), z.string()).optional(),
            response: z.record(z.string(), z.unknown()).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .refine(
    value => (value.infoHash === undefined) !== (value.url === undefined),
  )

const unsupportedSources = [
  'externalUrl',
  'ytId',
  'playerFrameUrl',
  'nzbUrl',
  'rarUrls',
  'zipUrls',
  'tarUrls',
  'tgzUrls',
  '7zipUrls',
]

export interface AddonViewer {
  subject: string
  profileId: string
}

type Stream
  = | { kind: 'torrent', infoHash: string, fileIdx?: number }
    | { kind: 'http', url: string, headers: Headers, fileName: string }

interface Candidate {
  viewer: AddonViewer
  target: AddonTarget
  addon: HttpAddon
  stream: Stream
  expiresAt: number
  launchId?: string
  torrentId?: string
  selecting?: Promise<AddonSourcePlayback>
}

interface Launch {
  id: string
  candidate: Candidate
  expiresAt: number
}

const candidates = new Map<string, Candidate>()
const launches = new Map<string, Launch>()

onAddonChanged((id, revision) => {
  for (const [key, candidate] of candidates) {
    if (candidate.addon.id === id && candidate.addon.revision === revision)
      candidates.delete(key)
  }
  for (const [key, entry] of launches) {
    if (
      entry.candidate.addon.id === id
      && entry.candidate.addon.revision === revision
    ) {
      launches.delete(key)
    }
  }
})

function remember<T extends { expiresAt: number }>(
  entries: Map<string, T>,
  id: string,
  item: T,
  limit: number,
) {
  const now = Date.now()
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now)
      entries.delete(key)
  }
  while (entries.size >= limit) entries.delete(entries.keys().next().value!)
  entries.set(id, item)
}

export function hasAddonStreams(type?: AddonTarget['type']) {
  return listEnabledAddons('stream').some(
    addon =>
      type === undefined
      || addon.manifest.resources.some(
        resource =>
          resource.name === 'stream' && resource.types.includes(type),
      ),
  )
}

function fieldObject(value: unknown) {
  return value && typeof value === 'object' ? value : undefined
}

function parseStream(addon: HttpAddon, value: unknown) {
  const item = fieldObject(value)
  if (
    !item
    || unsupportedSources.some(
      key => Object.getOwnPropertyDescriptor(item, key)?.value != null,
    )
  ) {
    return undefined
  }
  const parsed = streamFields.safeParse(item)
  if (!parsed.success)
    return undefined

  const info = parsed.data
  const hints = info.behaviorHints
  const headerValues = Object.values(hints?.proxyHeaders?.request ?? {})
  if (Object.keys(hints?.proxyHeaders?.response ?? {}).length)
    return undefined
  const safe = (text?: string) =>
    safeAddonText(addon, text?.replace(/\r?\n/g, ' '), {
      urls: info.url ? [info.url] : [],
      privateValues: headerValues,
    })
  const filename = safe(hints?.filename)
  const title = safe(info.title)
  const name = safe(info.name)
  const quality
    = [filename, title, name]
      .map(part => parseRelease(part).quality)
      .find(part => part !== undefined) ?? null
  const label = title || name || filename || addon.manifest.name

  let stream: Stream
  if (info.infoHash) {
    if (headerValues.length)
      return undefined
    stream = {
      kind: 'torrent',
      infoHash: info.infoHash.toLowerCase(),
      fileIdx: info.fileIdx,
    }
  }
  else {
    if (info.fileIdx !== undefined)
      return undefined
    const url = addonUrl(info.url!)
    if (
      url.protocol !== 'https:'
      && (url.origin !== addon.origin || !addon.lanAddresses.length)
    ) {
      return undefined
    }
    stream = {
      kind: 'http',
      url: url.href,
      headers: addonRequestHeaders(hints?.proxyHeaders?.request ?? {}),
      fileName: filename.replace(/[/\\]/g, ' ') || 'video',
    }
  }

  return { stream, label, quality }
}

export async function findAddonSources(
  target: AddonTarget,
  viewer: AddonViewer,
  current: () => boolean,
  signal: AbortSignal,
) {
  const providers = listEnabledAddons('stream').filter(addon =>
    supportsAddonResource(
      addon.manifest,
      'stream',
      target.type,
      target.videoId,
    ),
  )
  const outcomes = await mapLimit(
    providers,
    ADDON_CONCURRENCY,
    async (addon) => {
      try {
        if (!current())
          throw new AddonError('not_found')
        const answer = await readAddonResource(
          addon,
          'stream',
          target.type,
          target.videoId,
          { signal },
        )
        const { streams } = answer as { streams: unknown[] }
        return {
          addon,
          items: streams.flatMap((value) => {
            try {
              const stream = parseStream(addon, value)
              return stream ? [stream] : []
            }
            catch {
              return []
            }
          }),
        }
      }
      catch {
        return { addon, failed: true, items: [] } as const
      }
    },
  )
  if (!current())
    throw new AddonError('not_found')

  const items = outcomes
    .flatMap(({ addon, items }) =>
      currentAddon(addon.id, addon.revision, 'stream')
        ? items.map(item => ({ addon, ...item }))
        : [],
    )
    .slice(0, MAX_ITEMS)
  return {
    failed: outcomes.some(outcome => 'failed' in outcome),
    items: items.map(({ addon, stream, label, quality }) => {
      const id = randomUUID()
      remember(
        candidates,
        id,
        {
          addon,
          stream,
          target,
          viewer,
          expiresAt: Date.now() + CANDIDATE_TTL,
        },
        MAX_CANDIDATES,
      )
      return {
        id,
        kind: stream.kind,
        addonName: addon.manifest.name,
        name: label,
        quality,
      }
    }),
  }
}

function candidateAccessible(candidate: Candidate, viewer: AddonViewer) {
  return (
    candidate.viewer.subject === viewer.subject
    && candidate.viewer.profileId === viewer.profileId
    && titleAllowedCached(viewer.profileId, candidate.target.titleId)
    && currentAddon(candidate.addon.id, candidate.addon.revision, 'stream')
  )
}

export function getAddonLaunch(id: string, viewer: AddonViewer) {
  const launch = launches.get(id)
  if (!launch || launch.expiresAt <= Date.now())
    return undefined
  const { candidate } = launch
  const addon = candidateAccessible(candidate, viewer)
  if (!addon || candidate.stream.kind !== 'http')
    return undefined

  const { url, headers, fileName } = candidate.stream
  return {
    id,
    addon,
    target: candidate.target,
    url,
    headers: new Headers(headers),
    fileName,
    signal: addonRevisionSignal(addon),
  }
}

function playHttpSource(candidate: Candidate) {
  const existing = candidate.launchId && launches.get(candidate.launchId)
  if (existing && existing.expiresAt > Date.now())
    return { kind: 'http' as const, launchId: existing.id }
  const id = randomUUID()
  candidate.launchId = id
  remember(
    launches,
    id,
    { id, candidate, expiresAt: Date.now() + LAUNCH_TTL },
    MAX_LAUNCHES,
  )
  return { kind: 'http' as const, launchId: id }
}

function assertPublicTorrent(torrent: Torrent, titleId: string) {
  if (
    torrent.isPrivate
    || (torrent.torrentFile && !isPublicMetainfo(torrent.torrentFile))
    || (torrent.titleId !== null && torrent.titleId !== titleId)
  ) {
    throw new AddonError('conflict')
  }
}

function chosenFile(
  torrent: Torrent,
  target: AddonTarget,
  profileId: string,
  fileIdx: number | undefined,
) {
  const entries = (torrent.files ?? [])
    .map((file, index) => ({ ...file, index }))
    .filter(file => !file.padding)
  const parsed = parseRelease(torrent.name)
  const matches = matchFiles(entries, parsed)
  const blocked = unavailableTorrentFiles(profileId, torrent.id)
  const videos = entries.flatMap((file, index) => {
    const match = matches[index]
    return isVideoFile(file.path)
      && match?.kind === 'video'
      && !blocked.has(file.index)
      ? [{ fileIndex: file.index, match }]
      : []
  })
  if (!videos.length)
    throw new AddonError('bad_response')

  const matched = videos.filter(
    ({ match }) =>
      target.episode !== undefined
      && (seasonOfFile(match.season, parsed) ?? target.season) === target.season
      && match.episode === target.episode
      && (match.episodeTo ?? match.episode) === target.episode,
  )

  if (fileIdx === undefined) {
    const eligible = target.type === 'movie' ? videos : matched
    return eligible.length === 1 ? eligible[0]!.fileIndex : undefined
  }

  const chosen = videos.find(file => file.fileIndex === fileIdx)
  if (!chosen)
    throw new AddonError('bad_response')
  const { match } = chosen
  const season = seasonOfFile(match.season, parsed)
  if (
    target.type === 'series'
    && ((season !== undefined && season !== target.season)
      || (match.episode !== undefined
        && (match.episode !== target.episode
          || (match.episodeTo ?? match.episode) !== target.episode)))
  ) {
    throw new AddonError('bad_response')
  }
  return fileIdx
}

async function playTorrentSource(
  candidate: Candidate,
  stream: Extract<Stream, { kind: 'torrent' }>,
  current: () => boolean,
): Promise<AddonSourcePlayback> {
  const titleId = candidate.target.titleId
  const existing = torrentsByInfoHash([stream.infoHash]).get(stream.infoHash)
  if (existing)
    assertPublicTorrent(existing, titleId)
  const result = candidate.torrentId
    ? getTorrent(candidate.torrentId)
    : existing && existing.status !== 'failed'
      ? existing
      : (await addMagnet(`magnet:?xt=urn:btih:${stream.infoHash}`)).torrent
  if (!current() || !result)
    throw new AddonError('not_found')

  // Пока ждали метаданные, другой путь мог привязать или заменить раздачу.
  const torrent = getTorrent(result.id)
  if (!torrent || torrent.infoHash !== stream.infoHash)
    throw new AddonError('not_found')
  assertPublicTorrent(torrent, titleId)
  candidate.torrentId = torrent.id

  if (torrent.status === 'failed')
    throw new AddonError('unavailable')
  if (torrent.status !== 'ready')
    return { kind: 'torrent', status: 'resolving', torrentId: torrent.id }

  const fileIndex = chosenFile(
    torrent,
    candidate.target,
    candidate.viewer.profileId,
    stream.fileIdx,
  )
  if (!torrent.titleId)
    linkTitle(torrent, titleId)
  if (fileIndex === undefined)
    return { kind: 'torrent', status: 'files', torrentId: torrent.id }
  return { kind: 'torrent', status: 'ready', torrentId: torrent.id, fileIndex }
}

export async function playAddonSource(
  id: string,
  titleId: string,
  viewer: AddonViewer,
  viewerCurrent: () => boolean,
): Promise<AddonSourcePlayback> {
  const candidate = candidates.get(id)
  if (!candidate || candidate.target.titleId !== titleId)
    throw new AddonError('not_found')
  const current = () =>
    candidate.expiresAt > Date.now()
    && viewerCurrent()
    && !!candidateAccessible(candidate, viewer)
  if (!current())
    throw new AddonError('not_found')

  if (candidate.stream.kind === 'http')
    return playHttpSource(candidate)

  const pending = candidate.selecting
  if (pending)
    return pending
  const selection = playTorrentSource(candidate, candidate.stream, current)
  candidate.selecting = selection
  try {
    return await selection
  }
  finally {
    if (candidate.selecting === selection)
      candidate.selecting = undefined
  }
}
