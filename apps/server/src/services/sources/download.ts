import type { ParsedRelease } from '@torsher/release-parser'
import type { Torrent } from '../../db/schema.ts'
import type { RankedRelease } from './rank.ts'
import { matchFiles } from '@torsher/release-parser'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import { isKeepable } from '../library/status.ts'
import { ensureSpaceFor } from '../storage/index.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import {
  downloadFiles,
  getTorrent,
  isVideoFile,
  linkTitle,
  liveTorrents,
  setRetention,
} from '../torrents/index.ts'
import { getTitleSources } from './index.ts'
import {
  acquire,
  isSkippable,
  MAX_WATCH_ATTEMPTS,
  pickFile,
  seasonOfFile,
  WATCH_BUDGET_MS,
  WatchError,
} from './watch.ts'

export interface DownloadRequest {
  /** Сезон сериала для «Скачать сезон»; без него — первый */
  season?: number
  /** Раздача, которая ждала метаданные: повтор после `resolving` */
  candidateId?: string
  /** «Скачать выбранное» с экрана «Файлы»: раздача и её файлы */
  torrentId?: string
  files?: number[]
}

export type DownloadResult
  = | { status: 'started', torrentId: string, files: number, bytes: number }
  /** Magnet ждёт метаданные: клиент ждёт раздачу и повторяет с `candidateId`. */
    | { status: 'resolving', torrentId: string, candidateId: string }

/** Раздача не этого тайтла или файл не из неё */
export class DownloadNotFoundError extends Error {
  constructor() {
    super('Release not found')
    this.name = 'DownloadNotFoundError'
  }
}

/** Отменять нечего: у тайтла ничего не качается целиком */
export class NothingToCancelError extends Error {
  constructor() {
    super('Nothing is downloading')
    this.name = 'NothingToCancelError'
  }
}

/** «Оставить» нечего: тайтл не смотрели из кэша */
export class NothingToKeepError extends Error {
  constructor() {
    super('Nothing to keep')
    this.name = 'NothingToKeepError'
  }
}

/** Пак без диапазона серий или с диапазоном на весь сезон */
export function coversSeason(parsed: ParsedRelease, seasonEpisodes?: number) {
  const range = parsed.episodes

  if (!range)
    return true

  return (
    range.from <= 1
    && seasonEpisodes !== undefined
    && range.to >= seasonEpisodes
  )
}

/** Видео раздачи из этого сезона по `matchFiles`; сезон без номера — сезон раздачи */
export function seasonFiles(
  torrent: Pick<Torrent, 'files'>,
  parsed: ParsedRelease,
  season: number,
) {
  const entries = (torrent.files ?? [])
    .map((file, index) => ({ ...file, index }))
    .filter(file => !file.padding)
  const matches = matchFiles(
    entries.map(({ path, size }) => ({ path, size })),
    parsed,
  )

  return entries.flatMap((file, i) => {
    const match = matches[i]

    return match?.kind === 'video'
      && seasonOfFile(match.season, parsed) === season
      ? [file.index]
      : []
  })
}

/** Сколько ещё скачать из этих файлов: то, что уже на диске, не считается */
async function remainingBytes(torrent: Torrent, files: number[]) {
  const live = (await liveTorrents()).get(torrent.infoHash)

  return files.reduce((sum, index) => {
    const size = torrent.files?.[index]?.size ?? 0

    return sum + Math.max(0, size - (live?.fileProgress[index] ?? 0))
  }, 0)
}

/**
 * Закачка целиком: место под остаток проверяется до старта (закреплённое
 * лимит кэша не занимает, только запас свободного места), выбор раздачи
 * дополняется — уже качающиеся файлы остаются.
 */
async function start(torrent: Torrent, files: number[]) {
  const bytes = await remainingBytes(torrent, files)

  await ensureSpaceFor({ torrent: { ...torrent, retention: 'keep' }, bytes })

  const selected
    = torrent.retention === 'keep'
      ? [
          ...(torrent.selectedFiles ?? []),
          ...files.filter(index => !torrent.selectedFiles?.includes(index)),
        ]
      : files
  const updated = await downloadFiles(torrent, selected)

  return {
    status: 'started' as const,
    torrentId: updated.id,
    files: files.length,
    bytes,
  }
}

function filesOf(
  torrent: Torrent,
  release: RankedRelease,
  kind: 'movie' | 'series',
  season: number,
) {
  if (kind === 'movie') {
    const index = pickFile(torrent, release.parsed, { kind })

    return index === undefined ? [] : [index]
  }

  return seasonFiles(torrent, release.parsed, season)
}

/**
 * «Скачать фильм / сезон» — лучшая раздача по профилю и озвучке (тройка
 * ранжирования; у сезона сначала раздачи на весь сезон), «Скачать выбранное» —
 * файлы раздачи с экрана «Файлы». `undefined` — ID не из каталога.
 */
export async function downloadTitle(
  titleId: string,
  request: DownloadRequest,
  profileId: string,
): Promise<DownloadResult | undefined> {
  const ref = parseCatalogId(titleId)

  if (!ref)
    return undefined

  if (request.torrentId) {
    const torrent = getTorrent(request.torrentId)
    const files = [...new Set(request.files ?? [])]

    if (
      !torrent
      || torrent.titleId !== titleId
      || torrent.status !== 'ready'
      || !files.length
      || files.some((index) => {
        const file = torrent.files?.[index]

        return !file || file.padding || !isVideoFile(file.path)
      })
    ) {
      throw new DownloadNotFoundError()
    }

    return start(torrent, files)
  }

  const kind = ref.type === 'movie' ? 'movie' : 'series'
  const season = kind === 'series' ? (request.season ?? 1) : 0
  const sources = await getTitleSources(titleId, {
    season: kind === 'series' ? season : undefined,
    profileId,
  })

  if (!sources)
    return undefined

  const { ranked, top } = sources.ranking
  const byId = new Map(ranked.map(release => [release.id, release]))
  const seasonEpisodes = sources.identity.episodeCounts?.[season]
  let queue: RankedRelease[]

  if (request.candidateId) {
    const chosen = byId.get(request.candidateId)

    if (!chosen)
      throw new WatchError('candidate_gone', 'Release is no longer available')

    queue = [chosen]
  }
  else {
    const best = top.flatMap(id => byId.get(id) ?? [])

    queue
      = kind === 'series'
        ? [
            ...best.filter(item => coversSeason(item.parsed, seasonEpisodes)),
            ...best.filter(
              item => !coversSeason(item.parsed, seasonEpisodes),
            ),
          ]
        : best
  }

  if (queue.length === 0)
    throw new WatchError('no_sources', 'No suitable releases found')

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

    const files = filesOf(torrent, release, kind, season)

    if (files.length)
      return start(torrent, files)
  }

  throw new WatchError(
    'not_playable',
    'None of the releases can be downloaded',
  )
}

/**
 * «Оставить» тайтл: раздачи, которые смотрели из кэша, закрепляются и
 * докачивают начатые видео — связыватель кладёт их в библиотеку.
 */
export async function keepTitle(titleId: string) {
  const live = await liveTorrents()
  const rows = getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.titleId, titleId))
    .all()
    .filter(row => isKeepable(row, live.get(row.infoHash)))

  if (!rows.length)
    throw new NothingToKeepError()

  // Докачать предстоит начатые видео: проверяем место под их остаток
  const bytes = rows.reduce((sum, row) => {
    const state = live.get(row.infoHash)!

    return (
      sum
      + (row.files ?? []).reduce((files, file, index) => {
        const done = state.fileProgress[index] ?? 0

        return !file.padding && isVideoFile(file.path) && done > 0
          ? files + Math.max(0, file.size - done)
          : files
      }, 0)
    )
  }, 0)

  await ensureSpaceFor({ torrent: { ...rows[0]!, retention: 'keep' }, bytes })

  for (const row of rows) await setRetention(row, 'keep')

  return rows.length
}

/**
 * «Отменить загрузку»: закреплённые раздачи тайтла с недокачанным выбором
 * возвращаются в кэш — полная закачка встаёт, скачанное остаётся в кэше до
 * вытеснения, файлы, уже лежащие в библиотеке, не трогаются. С `torrentId` —
 * только эта раздача: у сериала другие сезоны продолжают качаться.
 */
export async function cancelTitleDownload(titleId: string, torrentId?: string) {
  const live = await liveTorrents()
  const rows = getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.titleId, titleId))
    .all()
    .filter((row) => {
      const state = live.get(row.infoHash)

      return (
        (!torrentId || row.id === torrentId)
        && row.retention === 'keep'
        && !!state
        && state.wantedCompleted < state.bytesWanted
      )
    })

  if (!rows.length)
    throw new NothingToCancelError()

  for (const row of rows) await setRetention(row, 'cache')

  return rows.length
}
