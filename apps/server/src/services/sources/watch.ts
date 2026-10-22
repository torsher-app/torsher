import type { ParsedRelease } from '@torsher/release-parser'
import type { Torrent } from '../../db/schema.ts'
import type { RankedRelease } from './rank.ts'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { EngineError } from '../engine/index.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import {
  addMagnet,
  addTorrentFile,
  getTorrent,
  InvalidMagnetError,
  isVideoFile,
  linkTitle,
} from '../torrents/index.ts'
import { downloadTorrent, SourceError } from '../torznab/index.ts'
import { getTitleSources } from './index.ts'
import { rememberChoice } from './progress.ts'
import { seasonReleases } from './seasonRelease.ts'

// Столько кандидатов пробуем за один запрос: каждый стоит загрузки
// `.torrent` или ожидания метаданных
export const MAX_WATCH_ATTEMPTS = 3
// API-клиент витрины ждёт ответ 10 с: новую попытку начинаем только в первые
// 4 с, а сама попытка длится не дольше 5 с (загрузка `.torrent` или 4 с
// ожидания метаданных magnet)
const WATCH_BUDGET_MS = 4000
const DOWNLOAD_TIMEOUT_MS = 5000

/**
 * `no_sources` — подходящих раздач нет, `not_playable` — ни одна из
 * кандидатов не добавилась или в ней нет нужной серии, `candidate_gone` —
 * выбранной раздачи больше нет в результатах поиска.
 */
export type WatchErrorKind = 'no_sources' | 'not_playable' | 'candidate_gone'

export class WatchError extends Error {
  readonly kind: WatchErrorKind

  constructor(kind: WatchErrorKind, message: string) {
    super(message)
    this.name = 'WatchError'
    this.kind = kind
  }
}

export interface WatchRequest {
  season?: number
  episode?: number
  /** Раздача из листа источников; без неё — лучшая по профилю. */
  candidateId?: string
  /** Раздача сезона, уже в базе: серия из неё без поиска по индексаторам. */
  torrentId?: string
}

export type WatchResult
  = | {
    status: 'ready'
    torrentId: string
    fileIndex: number
    candidateId: string
  }
  /** Magnet ждёт метаданные: клиент ждёт раздачу и повторяет с `candidateId`. */
  | { status: 'resolving', torrentId: string, candidateId: string }

function isSkippable(err: unknown) {
  if (err instanceof SourceError || err instanceof InvalidMagnetError)
    return true

  // Недоступный движок — не вина раздачи: следующая упадёт так же
  return err instanceof EngineError && err.kind !== 'unavailable'
}

function magnetOf(release: RankedRelease) {
  if (release.magnet)
    return release.magnet

  return release.infoHash
    ? `magnet:?xt=urn:btih:${release.infoHash}&dn=${encodeURIComponent(release.title)}`
    : undefined
}

/** Раздача в базе: по `.torrent` от индексатора, а без него — по magnet */
async function acquire(
  release: RankedRelease,
  hasTime: () => boolean,
): Promise<Torrent | undefined> {
  const magnet = magnetOf(release)

  if (release.link) {
    try {
      const downloaded = await downloadTorrent(
        release.link.url,
        DOWNLOAD_TIMEOUT_MS,
      )

      return downloaded.kind === 'file'
        ? (await addTorrentFile(downloaded.bytes)).torrent
        : (await addMagnet(downloaded.magnet)).torrent
    }
    catch (err) {
      if (!(err instanceof SourceError) || !magnet || !hasTime())
        throw err
    }
  }

  return magnet ? (await addMagnet(magnet)).torrent : undefined
}

function seasonOfFile(fileSeason: number | undefined, parsed: ParsedRelease) {
  if (fileSeason !== undefined)
    return fileSeason

  return parsed.seasons.length === 1 ? parsed.seasons[0] : undefined
}

/**
 * Файл для просмотра: у фильма — самое крупное видео, у серии — видео с её
 * номером по `matchFiles`. Раздача ровно на одну эту серию с одним видео
 * подходит и без номера в имени файла.
 */
export function pickFile(
  torrent: Torrent,
  parsed: ParsedRelease,
  target: { kind: 'movie' | 'series', season?: number, episode?: number },
): number | undefined {
  const entries = (torrent.files ?? [])
    .map((file, index) => ({ ...file, index }))
    .filter(file => !file.padding)
  const videos = entries.filter(file => isVideoFile(file.path))

  if (target.kind === 'movie') {
    return videos.sort((a, b) => b.size - a.size)[0]?.index
  }

  const { season = 1, episode = 1 } = target
  const matches = matchFiles(
    entries.map(({ path, size }) => ({ path, size })),
    parsed,
  )
  const found = matches.findIndex(
    match =>
      match.kind === 'video'
      && match.episode !== undefined
      && (seasonOfFile(match.season, parsed) ?? season) === season
      && episode >= match.episode
      && episode <= (match.episodeTo ?? match.episode),
  )

  if (found !== -1)
    return entries[found]!.index

  const single
    = parsed.episodes?.from === episode && parsed.episodes.to === episode

  return single && videos.length === 1 ? videos[0]!.index : undefined
}

export type OpenResult
  = | { status: 'ready', torrentId: string }
    | { status: 'resolving', torrentId: string }

/**
 * Экран «Источники»: выбранная раздача → база и движок, без выбора файла —
 * его выбирают в «Файлах». Поиск уже в кэше: список только что показан.
 */
export async function openCandidate(
  titleId: string,
  candidateId: string,
  profileId: string,
): Promise<OpenResult | undefined> {
  const sources = await getTitleSources(titleId, {
    allSeasons: true,
    profileId,
  })

  if (!sources)
    return undefined

  const release = sources.ranking.ranked.find(
    item => item.id === candidateId,
  )

  if (!release)
    throw new WatchError('candidate_gone', 'Release is no longer available')

  let torrent: Torrent | undefined

  try {
    torrent = await acquire(release, () => true)
  }
  catch (err) {
    if (isSkippable(err))
      throw new WatchError('not_playable', 'The release could not be added')

    throw err
  }

  if (!torrent || torrent.status === 'failed')
    throw new WatchError('not_playable', 'The release could not be added')

  const linked = linkTitle(torrent, titleId)

  return {
    status: linked.status === 'resolving' ? 'resolving' : 'ready',
    torrentId: linked.id,
  }
}

/** Серия из раздачи сезона: раздача уже в базе, файл — по номеру серии */
function watchTorrent(
  titleId: string,
  request: WatchRequest & { torrentId: string },
  profileId: string,
): WatchResult | undefined {
  const ref = parseCatalogId(titleId)

  if (!ref)
    return undefined

  const found = getTorrent(request.torrentId)

  if (!found || found.status === 'failed')
    throw new WatchError('candidate_gone', 'Release is no longer available')

  const torrent = linkTitle(found, titleId)

  if (torrent.status === 'resolving')
    return { status: 'resolving', torrentId: torrent.id, candidateId: '' }

  const target = {
    kind: ref.type === 'movie' ? ('movie' as const) : ('series' as const),
    season: request.season,
    episode: request.episode,
  }
  const fileIndex = pickFile(torrent, parseRelease(torrent.name), target)

  if (fileIndex === undefined)
    throw new WatchError('not_playable', 'The episode is not in this release')

  const voice = seasonReleases(profileId, titleId).find(
    release => release.season === request.season,
  )?.voice

  rememberChoice(
    { profileId, titleId, season: target.season, episode: target.episode },
    { torrentId: torrent.id, fileIndex, voice },
  )

  return { status: 'ready', torrentId: torrent.id, fileIndex, candidateId: '' }
}

/**
 * «Смотреть» из карточки: лучший кандидат (или выбранный в листе) → раздача
 * в базе и движке → файл серии. Не вышло — следующий кандидат тройки.
 * `undefined` — ID не из каталога.
 */
export async function watchTitle(
  titleId: string,
  request: WatchRequest,
  profileId: string,
): Promise<WatchResult | undefined> {
  if (request.torrentId) {
    return watchTorrent(
      titleId,
      { ...request, torrentId: request.torrentId },
      profileId,
    )
  }

  // У сериала без серии — первая; у фильма серия не учитывается
  const sources = await getTitleSources(titleId, {
    season: request.season,
    episode: request.episode ?? 1,
    profileId,
  })

  if (!sources)
    return undefined

  const { ranked, top } = sources.ranking
  const byId = new Map(ranked.map(release => [release.id, release]))
  let queue: RankedRelease[]

  if (request.candidateId) {
    const chosen = byId.get(request.candidateId)

    if (!chosen)
      throw new WatchError('candidate_gone', 'Release is no longer available')

    queue = [chosen]
  }
  else {
    queue = top.flatMap(id => byId.get(id) ?? [])
  }

  if (queue.length === 0)
    throw new WatchError('no_sources', 'No suitable releases found')

  const target = {
    kind: sources.identity.kind,
    season: sources.season,
    episode: sources.episode,
  }

  const startedAt = Date.now()
  const hasTime = () => Date.now() - startedAt < WATCH_BUDGET_MS

  for (const release of queue.slice(0, MAX_WATCH_ATTEMPTS)) {
    if (!hasTime())
      break

    let torrent: Torrent | undefined

    try {
      torrent = await acquire(release, hasTime)
    }
    catch (err) {
      if (isSkippable(err))
        continue

      throw err
    }

    if (!torrent || torrent.status === 'failed')
      continue

    torrent = linkTitle(torrent, titleId)

    if (torrent.status === 'resolving') {
      return {
        status: 'resolving',
        torrentId: torrent.id,
        candidateId: release.id,
      }
    }

    const fileIndex = pickFile(torrent, release.parsed, target)

    if (fileIndex === undefined)
      continue

    rememberChoice(
      { profileId, titleId, season: target.season, episode: target.episode },
      { torrentId: torrent.id, fileIndex, voice: release.voice },
    )

    return {
      status: 'ready',
      torrentId: torrent.id,
      fileIndex,
      candidateId: release.id,
    }
  }

  throw new WatchError('not_playable', 'None of the releases can be played')
}
