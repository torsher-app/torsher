import type { Torrent, TorrentFile } from '@torsher/api-client'
import type { TITLES } from './titles'
import { GB, MB } from '../state'
import { fakeInfohash, releaseName } from './titles'

type DemoTitle = (typeof TITLES)[number]

interface ReleaseOptions {
  season?: number
  /** Одна серия; без неё у сериала — сезон целиком */
  episode?: number
  quality?: string
  /** Размер ролика: фильма или одной серии */
  videoSize: number
}

/** Псевдослучайный, но постоянный разброс размеров серий */
function spread(seed: number) {
  return 0.9 + ((seed * 37) % 21) / 100
}

/**
 * Имя и файлы раздачи: фильм — ролик и субтитры в папке, серия — один
 * файл, сезон — папка с сериями
 */
export function releaseOf(title: DemoTitle, options: ReleaseOptions) {
  const { season, episode, quality, videoSize } = options
  const name = releaseName(title, { season, episode, quality })
  const file = (index: number, path: string, size: number, isVideo = true) =>
    ({
      index,
      path,
      size: Math.round(size),
      isVideo,
      downloaded: 0,
      selected: false,
      inLibrary: false,
    }) satisfies TorrentFile

  let files: TorrentFile[]

  if (title.kind === 'movie') {
    files = [
      file(0, `${name}/${name}.mkv`, videoSize),
      file(1, `${name}/${name}.en.srt`, 96 * 1024, false),
    ]
  }
  else if (episode !== undefined) {
    files = [file(0, `${name}.mkv`, videoSize)]
  }
  else {
    const count = title.seasons?.[(season ?? 1) - 1] ?? 1

    files = Array.from({ length: count }, (_, index) =>
      file(
        index,
        `${name}/${releaseName(title, { season, episode: index + 1, quality })}.mkv`,
        videoSize * spread(index + 1),
      ))
  }

  return {
    name,
    files,
    totalSize: files.reduce((sum, item) => sum + item.size, 0),
  }
}

/** Раздача по умолчанию: метаданные получены, ничего не выбрано */
export function torrentOf(
  id: string,
  title: DemoTitle,
  release: ReturnType<typeof releaseOf>,
): Torrent {
  return {
    id,
    infoHash: fakeInfohash(id),
    name: release.name,
    source: 'magnet',
    status: 'ready',
    error: null,
    files: release.files,
    totalSize: release.totalSize,
    addedAt: new Date().toISOString(),
    lastAccessAt: null,
    titleId: title.id,
    matchStatus: 'matched',
    matchSuggestion: null,
    retention: 'cache',
    inLibrary: false,
    pauseReason: null,
    state: 'idle',
    streaming: false,
    progress: { downloaded: 0, wanted: 0 },
    sizeOnDisk: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    peers: { connected: 0, found: 0 },
    seeding: {
      rule: null,
      effective: null,
      uploaded: 0,
      ratio: null,
      stopped: null,
    },
  }
}

/** Выбирает видео раздачи и отмечает скачанной долю `share` каждого */
export function selectVideo(torrent: Torrent, share: number) {
  for (const file of torrent.files) {
    if (!file.isVideo)
      continue

    file.selected = true
    file.downloaded = Math.round(file.size * share)
  }
}

/** Скачано целиком и лежит в библиотеке */
export function putInLibrary(torrent: Torrent) {
  selectVideo(torrent, 1)
  torrent.retention = 'keep'
  torrent.inLibrary = true
  for (const file of torrent.files) file.inLibrary = file.isVideo
}

export const SPEED = {
  fast: 24 * MB,
  steady: 11 * MB,
  stream: 6 * MB,
}

export const TYPICAL = {
  movie: 9 * GB,
  movie4k: 31 * GB,
  episode: 2.4 * GB,
  episode4k: 6.2 * GB,
}
