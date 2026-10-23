import type { AudioTrack } from '@torsher/release-parser'
import type { Torrent } from '../../db/schema.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mediaFiles, torrents } from '../../db/schema.ts'
import { planVideos } from './linker.ts'

/**
 * `downloading` — «Скачать» или «Оставить» ещё качают, `downloaded` — выбор
 * докачан, а в библиотеке файла нет (связыватель положит его на ближайшем
 * проходе), `library` — файлы тайтла лежат в библиотеке
 */
export type DownloadState = 'downloading' | 'downloaded' | 'library'

/** Какую раздачу качаем или положили: качество и озвучка из её названия */
export interface DownloadRelease {
  quality: string | null
  voice: Pick<AudioTrack, 'studio' | 'type'> | null
}

/**
 * Фаза одной закачки: `downloading` — качается, `placing` — докачана, файлы
 * ещё не легли в библиотеку, `unmatched` — докачана, но связыватель её видео
 * не разложит (у серий нет номеров)
 */
export type DownloadPhase = 'downloading' | 'placing' | 'unmatched'

/** Закачка одной раздачи тайтла: какие сезоны она покрывает и как идёт */
export interface ActiveDownload {
  torrentId: string
  phase: DownloadPhase
  /** Сезоны выбранных видео; у фильма — пусто */
  seasons: number[]
  progress: number
  release: DownloadRelease | null
  peers: { connected: number, found: number }
  speed: number
  stalled: boolean
}

export interface TitleDownload {
  state: DownloadState | null
  /** Доля скачанного выбора, 0–1; без закачки — 0 */
  progress: number
  /** Тайтл смотрели из кэша: «Оставить» есть что сохранить */
  canKeep: boolean
  release: DownloadRelease | null
  /** Пиры и скорость качающихся раздач тайтла */
  peers: { connected: number, found: number }
  speed: number
  /** Качается, а подключённых пиров нет */
  stalled: boolean
  /** Закачки по раздачам — только у карточки тайтла, в списках постеров пусто */
  downloads: ActiveDownload[]
}

const NONE: TitleDownload = {
  state: null,
  progress: 0,
  canKeep: false,
  release: null,
  peers: { connected: 0, found: 0 },
  speed: 0,
  stalled: false,
  downloads: [],
}

/** Основная озвучка — первая со студией, иначе с типом перевода */
function releaseOf(torrent: Torrent | undefined): DownloadRelease | null {
  if (!torrent)
    return null

  const parsed = parseRelease(torrent.name)
  const track
    = parsed.audio.find(item => item.studio)
      ?? parsed.audio.find(item => item.type)

  return {
    quality: parsed.quality ?? null,
    voice: track ? { studio: track.studio, type: track.type } : null,
  }
}

/** Скачанное раздачи лежит в кэше: её смотрели, но не оставили */
export function isKeepable(row: Torrent, live?: EngineTorrentState) {
  return (
    row.retention === 'cache'
    && row.status === 'ready'
    && !!live
    && live.bytesCompleted > 0
  )
}

/**
 * Состояние загрузки тайтлов по их раздачам и файлам библиотеки. `live` —
 * раздачи движка по infohash: живые для карточки, последний снимок для
 * списков постеров.
 */
export function titleDownloads(
  titleIds: string[],
  live: Map<string, EngineTorrentState>,
) {
  const result = new Map<string, TitleDownload>()
  const ids = [...new Set(titleIds)]

  if (!ids.length)
    return result

  // Свежие раздачи первыми: подпись берётся с последней скачанной
  const rows = getDb()
    .select()
    .from(torrents)
    .where(inArray(torrents.titleId, ids))
    .orderBy(desc(torrents.addedAt))
    .all()
  // Свежие файлы библиотеки первыми: их раздача подписывает «В библиотеке»
  const files = getDb()
    .select({ titleId: mediaFiles.titleId, torrentId: mediaFiles.torrentId })
    .from(mediaFiles)
    .where(
      and(inArray(mediaFiles.titleId, ids), eq(mediaFiles.state, 'present')),
    )
    .orderBy(desc(mediaFiles.addedAt))
    .all()
  const placed = new Set(files.map(row => row.titleId))

  for (const id of ids) {
    const own = rows.filter(row => row.titleId === id)
    let wanted = 0
    let done = 0
    let canKeep = false
    let speed = 0
    const peers = { connected: 0, found: 0 }
    let downloading: Torrent | undefined
    let kept: Torrent | undefined

    for (const row of own) {
      const state = live.get(row.infoHash)

      canKeep ||= isKeepable(row, state)

      if (row.retention === 'keep' && state) {
        wanted += state.bytesWanted
        done += state.wantedCompleted

        if (state.wantedCompleted < state.bytesWanted) {
          downloading ??= row
          peers.connected += state.peers.connected
          peers.found += state.peers.found
          speed += state.downloadSpeed
        }
        else if (state.bytesWanted > 0) {
          kept ??= row
        }
      }
    }

    const libraryTorrent = files.find(
      row => row.titleId === id && row.torrentId,
    )?.torrentId
    const source
      = downloading ?? kept ?? own.find(row => row.id === libraryTorrent)

    const state: DownloadState | null
      = done < wanted
        ? 'downloading'
        : placed.has(id)
          ? 'library'
          : wanted > 0
            ? 'downloaded'
            : null

    result.set(id, {
      state,
      progress: wanted > 0 ? Math.min(1, done / wanted) : 0,
      canKeep,
      release: state ? releaseOf(source) : null,
      peers,
      speed,
      stalled: state === 'downloading' && peers.connected === 0,
      downloads: [],
    })
  }

  return result
}

/** Сезоны выбранных видео раздачи; без номеров в файлах — сезоны из её имени */
function seasonsOf(row: Torrent) {
  const files = (row.files ?? []).map(({ path, size }) => ({ path, size }))
  const parsed = parseRelease(row.name)
  const matches = matchFiles(files, parsed)
  const selected = new Set(row.selectedFiles ?? [])
  const seasons = new Set<number>()

  matches.forEach((match, index) => {
    if (
      match.kind === 'video'
      && match.season !== undefined
      && selected.has(index)
    ) {
      seasons.add(match.season)
    }
  })

  return [...(seasons.size ? seasons : parsed.seasons)].sort((a, b) => a - b)
}

/**
 * Закачки тайтла по раздачам («Оставить» и «Скачать»): что качается, что
 * докачано и ждёт раскладки, что докачано и не разложится. Разложенные целиком
 * сюда не попадают — это уже библиотека.
 */
export function activeDownloads(
  titleId: string,
  live: Map<string, EngineTorrentState>,
): ActiveDownload[] {
  const kind = titleId.startsWith('tmdb:tv:') ? 'series' : 'movie'
  const rows = getDb()
    .select()
    .from(torrents)
    .where(and(eq(torrents.titleId, titleId), eq(torrents.retention, 'keep')))
    .orderBy(desc(torrents.addedAt))
    .all()
  const placed = new Set(
    getDb()
      .select({
        torrentId: mediaFiles.torrentId,
        fileIndex: mediaFiles.fileIndex,
      })
      .from(mediaFiles)
      .where(
        and(eq(mediaFiles.titleId, titleId), eq(mediaFiles.state, 'present')),
      )
      .all()
      .map(file => `${file.torrentId}:${file.fileIndex}`),
  )

  return rows.flatMap((row) => {
    const state = live.get(row.infoHash)

    if (!state || state.bytesWanted === 0)
      return []

    let phase: DownloadPhase

    if (state.wantedCompleted < state.bytesWanted) {
      phase = 'downloading'
    }
    else {
      const selected = new Set(row.selectedFiles ?? [])
      const planned = planVideos(row, kind).filter(
        item => !selected.size || selected.has(item.fileIndex),
      )

      if (!planned.length)
        phase = 'unmatched'
      else if (
        planned.some(item => !placed.has(`${row.id}:${item.fileIndex}`))
      )
        phase = 'placing'
      else return []
    }

    return [
      {
        torrentId: row.id,
        phase,
        seasons: kind === 'series' ? seasonsOf(row) : [],
        progress: Math.min(1, state.wantedCompleted / state.bytesWanted),
        release: releaseOf(row),
        peers:
          phase === 'downloading'
            ? { connected: state.peers.connected, found: state.peers.found }
            : { connected: 0, found: 0 },
        speed: phase === 'downloading' ? state.downloadSpeed : 0,
        stalled: phase === 'downloading' && state.peers.connected === 0,
      },
    ]
  })
}

/** Состояние тайтла для карточки: вместе с закачками по раздачам */
export function titleDownload(
  titleId: string,
  live: Map<string, EngineTorrentState>,
): TitleDownload {
  const summary = titleDownloads([titleId], live).get(titleId) ?? NONE

  return { ...summary, downloads: activeDownloads(titleId, live) }
}
