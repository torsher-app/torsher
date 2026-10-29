import type {
  LibraryFile,
  SourceCandidate,
  TitleDownload,
} from '@torsher/api-client'
import type { DemoTitle } from '@torsher/demo/titles'
import { DAY, elapsedSeconds, GB, MB } from '@torsher/demo/state'
import {
  airedEpisodes,
  fakeInfohash,
  releaseName,
  titleNamed,
} from '@torsher/demo/titles'

/**
 * Раздачи, библиотека и загрузки демо витрины. Раздачи выдуманные: имена —
 * `releaseName`, id — из хеша, индексаторы с нейтральными именами.
 */

type Resolution = '2160p' | '1080p' | '720p'

interface Variant {
  tag: string
  quality: Resolution
  source: string
  codec: string
  hdr: string[]
  channels: '2.0' | '5.1'
  /** ГБ на 100 минут видео */
  gb: number
}

const VARIANTS: Variant[] = [
  {
    tag: '2160p.WEB-DL.HEVC.HDR10',
    quality: '2160p',
    source: 'WEB-DL',
    codec: 'HEVC',
    hdr: ['HDR10'],
    channels: '5.1',
    gb: 15.6,
  },
  {
    tag: '1080p.WEB-DL.H.264',
    quality: '1080p',
    source: 'WEB-DL',
    codec: 'H.264',
    hdr: [],
    channels: '5.1',
    gb: 5.4,
  },
  {
    tag: '1080p.BluRay.x265',
    quality: '1080p',
    source: 'BluRay',
    codec: 'HEVC',
    hdr: [],
    channels: '5.1',
    gb: 3.6,
  },
  {
    tag: '720p.WEB-DL.H.264',
    quality: '720p',
    source: 'WEB-DL',
    codec: 'H.264',
    hdr: [],
    channels: '2.0',
    gb: 1.9,
  },
]

// Раздача, которую витрина открывает по умолчанию: 1080p WEB-DL
const DEFAULT_VARIANT = 1

const INDEXERS = ['Demo indexer', 'Example index']

export interface DemoFile {
  fileIndex: number
  name: string
  size: number
  season: number | null
  episode: number | null
}

interface Release {
  candidate: SourceCandidate
  titleId: string
  files: DemoFile[]
}

export interface DemoTorrent {
  id: string
  titleId: string
  candidateId: string
  name: string
  quality: Resolution
  seasons: number[]
  files: DemoFile[]
  /** Сколько раз ещё ответить «ждём файлы от пиров» */
  pendingPolls: number
}

/** Постоянное псевдослучайное число 0…1 по строке */
function noise(seed: string) {
  return Number.parseInt(fakeInfohash(seed).slice(0, 8), 16) / 0xFFFFFFFF
}

function videoSize(variant: Variant, minutes: number, seed: string) {
  return Math.round(
    ((variant.gb * GB * minutes) / 100) * (0.92 + noise(seed) * 0.16),
  )
}

function candidateIdOf(title: DemoTitle, key: string) {
  return `c-${fakeInfohash(`${title.id}:${key}`).slice(0, 12)}`
}

function torrentIdOf(candidateId: string) {
  return `t-${fakeInfohash(candidateId).slice(0, 12)}`
}

function filesOf(
  title: DemoTitle,
  variant: Variant,
  season?: number,
  episodes: number[] = [],
): DemoFile[] {
  if (title.kind === 'movie') {
    const name = releaseName(title, { quality: variant.tag })

    return [
      {
        fileIndex: 0,
        name: `${name}.mkv`,
        size: videoSize(variant, title.runtime, name),
        season: null,
        episode: null,
      },
    ]
  }

  return episodes.map((episode, index) => {
    const name = releaseName(title, { season, episode, quality: variant.tag })

    return {
      fileIndex: index,
      name: `${name}.mkv`,
      size: videoSize(variant, title.runtime, name),
      season: season ?? null,
      episode,
    }
  })
}

function candidateOf(
  title: DemoTitle,
  key: string,
  variant: Variant,
  files: DemoFile[],
  options: { season?: number, episode?: number, total?: number } = {},
): SourceCandidate {
  const id = candidateIdOf(title, key)
  const size = files.reduce((sum, file) => sum + file.size, 0)
  const { season, episode, total } = options
  const isPack = title.kind === 'series' && episode === undefined
  const popularity = noise(`${id}:seeders`)
  // 4K и старые сезоны раздают реже
  const seeders = Math.round(
    (variant.quality === '2160p' ? 40 : 160) * (0.2 + popularity),
  )

  return {
    id,
    title: releaseName(title, { season, episode, quality: variant.tag }),
    indexers: popularity > 0.5 ? INDEXERS : INDEXERS.slice(0, 1),
    size,
    episodeSize:
      title.kind === 'series' ? Math.round(size / files.length) : null,
    seeders,
    peers: Math.round(seeders * (0.1 + noise(`${id}:peers`) * 0.4)),
    quality: variant.quality,
    resolution: { value: variant.quality, basis: 'title', sure: true },
    source: variant.source,
    codec: variant.codec,
    hdr: variant.hdr,
    audio: [{ type: 'Original', language: 'en' }],
    channels: variant.channels,
    subs: ['en'],
    voice: { type: 'Original', language: 'en' },
    voiceKeys: ['type:Original'],
    seasons: season === undefined ? [] : [season],
    episodes:
      title.kind === 'series' && files.length
        ? {
            from: episode ?? files[0]!.episode ?? 1,
            to: episode ?? files.at(-1)!.episode ?? 1,
            ...(total !== undefined && { total }),
          }
        : null,
    isPack,
    confidence: 'high',
    pickReason: null,
    publishedAt: new Date(
      Date.now() - (2 + noise(`${id}:date`) * 60) * DAY * 1000,
    ).toISOString(),
    lastWatched: false,
  }
}

function releasesOf(title: DemoTitle): Release[] {
  const release = (
    key: string,
    variant: Variant,
    files: DemoFile[],
    options?: Parameters<typeof candidateOf>[4],
  ): Release => ({
    candidate: candidateOf(title, key, variant, files, options),
    titleId: title.id,
    files,
  })

  if (title.kind === 'movie') {
    return VARIANTS.map((variant, index) =>
      release(`movie:${index}`, variant, filesOf(title, variant)),
    )
  }

  const seasons = title.seasons ?? []

  return seasons.flatMap((count, index) => {
    const season = index + 1
    const aired = airedEpisodes(title, season)
    const episodes = Array.from({ length: aired }, (_, n) => n + 1)
    const airing = aired < count
    const packs = (airing ? [1, 3] : [0, 1, 2]).map(variant =>
      release(
        `${season}:${variant}`,
        VARIANTS[variant]!,
        filesOf(title, VARIANTS[variant]!, season, episodes),
        { season, total: count },
      ),
    )

    if (!airing || !aired)
      return packs

    // Сезон выходит: последняя серия раздаётся и отдельно
    const variant = VARIANTS[DEFAULT_VARIANT]!

    return [
      ...packs,
      release(
        `${season}:e${aired}`,
        variant,
        filesOf(title, variant, season, [aired]),
        { season, episode: aired },
      ),
    ]
  })
}

const releases = new Map<string, Release[]>()
const releaseById = new Map<string, Release>()

/** Раздачи тайтла, лучшие по сидам первыми */
export function releasesFor(title: DemoTitle) {
  let list = releases.get(title.id)

  if (!list) {
    list = releasesOf(title).sort(
      (a, b) => b.candidate.seeders - a.candidate.seeders,
    )
    releases.set(title.id, list)
    for (const item of list) releaseById.set(item.candidate.id, item)
  }

  return list
}

export function releaseOfCandidate(title: DemoTitle, candidateId: string) {
  releasesFor(title)

  const found = releaseById.get(candidateId)

  return found?.titleId === title.id ? found : undefined
}

const torrents = new Map<string, DemoTorrent>()

function torrentOfRelease(release: Release, pendingPolls: number) {
  const id = torrentIdOf(release.candidate.id)
  let torrent = torrents.get(id)

  if (!torrent) {
    torrent = {
      id,
      titleId: release.titleId,
      candidateId: release.candidate.id,
      name: release.candidate.title,
      quality: release.candidate.resolution!.value as Resolution,
      seasons: release.candidate.seasons,
      files: release.files,
      pendingPolls,
    }
    torrents.set(id, torrent)
  }

  return torrent
}

/**
 * Подключает раздачу кандидата. Новая раздача пару опросов «ждёт файлы от
 * пиров», уже подключённая отвечает сразу
 */
export function openRelease(title: DemoTitle, candidateId: string) {
  const release = releaseOfCandidate(title, candidateId)

  return release ? torrentOfRelease(release, 2) : undefined
}

/** Раздача по умолчанию: фильм — 1080p, сериал — 1080p пак сезона */
export function defaultRelease(title: DemoTitle, season?: number) {
  const key
    = title.kind === 'movie'
      ? `movie:${DEFAULT_VARIANT}`
      : `${season ?? 1}:${DEFAULT_VARIANT}`

  return releaseOfCandidate(title, candidateIdOf(title, key))!
}

/** Раздача, которую уже смотрели: подключена и с файлами */
export function knownTorrent(title: DemoTitle, season?: number) {
  return torrentOfRelease(defaultRelease(title, season), 0)
}

export function torrentById(id: string) {
  return torrents.get(id)
}

/**
 * Раздача по id. Чужой id (раздача из демо панели или старая ссылка) — та же
 * раздача тайтла по умолчанию под этим id: файлы показать есть что
 */
export function torrentFor(title: DemoTitle, id: string) {
  const known = torrents.get(id)

  if (known?.titleId === title.id)
    return known

  const release = defaultRelease(title)
  const torrent: DemoTorrent = {
    id,
    titleId: title.id,
    candidateId: release.candidate.id,
    name: release.candidate.title,
    quality: '1080p',
    seasons: release.candidate.seasons,
    files: release.files,
    pendingPolls: 0,
  }

  torrents.set(id, torrent)
  return torrent
}

export function torrentsOf(titleId: string) {
  return [...torrents.values()].filter(item => item.titleId === titleId)
}

export function fileOf(torrent: DemoTorrent, season: number, episode: number) {
  return torrent.files.find(
    file => file.season === season && file.episode === episode,
  )
}

/** Файл серии в уже подключённых раздачах тайтла */
export function episodeFile(titleId: string, season: number, episode: number) {
  for (const torrent of torrentsOf(titleId)) {
    const file = fileOf(torrent, season, episode)

    if (file && torrent.pendingPolls === 0)
      return { torrentId: torrent.id, fileIndex: file.fileIndex }
  }

  return null
}

// Библиотека: что лежит на диске сервера целиком

const LIBRARY_MOVIES = [
  'Big Buck Bunny',
  'Tears of Steel',
  'Lanterns of Vell',
  'The Quiet Orchard',
  'Winter in Tolvar',
  'Paper Comets',
  'The Lamplighters of Osk',
]

const LIBRARY_SERIES = ['Saltwater Lullaby']

interface LibraryEntry extends LibraryFile {
  titleId: string
  name: string
}

function libraryEntries(): LibraryEntry[] {
  const variant = VARIANTS[DEFAULT_VARIANT]!
  const movies = LIBRARY_MOVIES.map((name) => {
    const title = titleNamed(name)
    const [file] = filesOf(title, variant)

    return {
      id: `media-${title.id.split(':')[2]}`,
      titleId: title.id,
      name: file!.name,
      season: null,
      episode: null,
      episodeTo: null,
      quality: '1080p',
      size: file!.size,
      duration: title.runtime * 60,
    }
  })
  const series = LIBRARY_SERIES.flatMap((name) => {
    const title = titleNamed(name)

    return (title.seasons ?? []).flatMap((count, index) => {
      const season = index + 1
      const episodes = Array.from({ length: count }, (_, n) => n + 1)

      return filesOf(title, variant, season, episodes).map(file => ({
        id: `media-${title.id.split(':')[2]}-${season}-${file.episode}`,
        titleId: title.id,
        name: file.name,
        season,
        episode: file.episode,
        episodeTo: null,
        quality: '1080p',
        size: file.size,
        duration: title.runtime * 60,
      }))
    })
  })

  return [...movies, ...series]
}

const library = libraryEntries()

export function libraryTitleIds() {
  return [...new Set(library.map(entry => entry.titleId))]
}

export function isInLibrary(titleId: string) {
  return library.some(entry => entry.titleId === titleId)
}

export function libraryFilesOf(titleId: string): LibraryFile[] {
  return library
    .filter(entry => entry.titleId === titleId)
    .map(({ titleId: _, name: __, ...file }) => file)
}

export function libraryEntry(id: string) {
  return library.find(entry => entry.id === id)
}

// Загрузки: прогресс идёт от времени демо, а не от движка

// За столько секунд демо раздача докачивается целиком
const DOWNLOAD_SECONDS = 180

interface Download {
  titleId: string
  torrentId: string
  files: number[]
  bytes: number
  startedAt: number
}

const downloads = new Map<string, Download>()

export function startDownload(torrent: DemoTorrent, files?: number[]) {
  const chosen = files?.length
    ? torrent.files.filter(file => files.includes(file.fileIndex))
    : torrent.files
  const download: Download = {
    titleId: torrent.titleId,
    torrentId: torrent.id,
    files: chosen.map(file => file.fileIndex),
    bytes: chosen.reduce((sum, file) => sum + file.size, 0),
    startedAt: elapsedSeconds(),
  }

  downloads.set(torrent.titleId, download)
  return download
}

export function downloadOf(titleId: string) {
  return downloads.get(titleId)
}

export function cancelDownload(titleId: string, torrentId?: string) {
  const download = downloads.get(titleId)

  if (!download || (torrentId && download.torrentId !== torrentId))
    return false

  downloads.delete(titleId)
  return true
}

export function progressOfDownload(download: Download) {
  return Math.min(
    1,
    Math.max(0, (elapsedSeconds() - download.startedAt) / DOWNLOAD_SECONDS),
  )
}

/** Карточке: в библиотеке, качается или скачано */
export function availabilityOf(titleId: string) {
  if (isInLibrary(titleId))
    return { availability: 'library' as const }

  const download = downloads.get(titleId)

  if (!download)
    return {}

  const progress = progressOfDownload(download)

  return progress < 1
    ? { availability: 'downloading' as const, downloadProgress: progress }
    : { availability: 'downloaded' as const }
}

export function peersOf(seed: string) {
  const connected = 8 + Math.round(noise(seed) * 24)

  return {
    connected,
    found: connected + 10 + Math.round(noise(`${seed}:found`) * 30),
  }
}

/** Состояние загрузки тайтла для карточки и меню */
export function titleDownload(titleId: string): TitleDownload {
  const empty: TitleDownload = {
    state: null,
    progress: 0,
    canKeep: false,
    release: null,
    peers: { connected: 0, found: 0 },
    speed: 0,
    stalled: false,
    downloads: [],
  }

  if (isInLibrary(titleId))
    return { ...empty, state: 'library', progress: 1 }

  const download = downloads.get(titleId)

  if (!download) {
    // Раздачу смотрели — её можно оставить себе целиком
    return {
      ...empty,
      canKeep: torrentsOf(titleId).some(item => item.pendingPolls === 0),
    }
  }

  const progress = progressOfDownload(download)
  const release = {
    quality: torrentById(download.torrentId)?.quality ?? '1080p',
    voice: null,
  }

  if (progress >= 1)
    return { ...empty, state: 'downloaded', progress: 1, release }

  const peers = peersOf(download.torrentId)
  const speed = Math.round(
    (download.bytes / DOWNLOAD_SECONDS)
    * (0.85 + noise(`${elapsedSeconds() | 0}`) * 0.3),
  )

  return {
    ...empty,
    state: 'downloading',
    progress,
    release,
    peers,
    speed,
    downloads: [
      {
        torrentId: download.torrentId,
        phase: 'downloading',
        seasons: torrentById(download.torrentId)?.seasons ?? [],
        progress,
        release,
        peers,
        speed,
        stalled: false,
      },
    ],
  }
}

/** Загрузка файла раздачи для экрана «Файлы» */
export function fileDownload(torrent: DemoTorrent, fileIndex: number) {
  const download = downloads.get(torrent.titleId)

  if (download?.torrentId !== torrent.id || !download.files.includes(fileIndex))
    return null

  const progress = progressOfDownload(download)

  return progress < 1
    ? { state: 'downloading' as const, progress }
    : { state: 'downloaded' as const, progress: 1 }
}

/** Скорость раздачи при просмотре: от 4 до 12 МБ/с */
export function streamSpeed(seed: string) {
  return Math.round((4 + noise(`${seed}:${elapsedSeconds() | 0}`) * 8) * MB)
}

// Раздача, которая качается с самого начала демо: к открытию — 42 %
startDownload(knownTorrent(titleNamed('Orbit of Small Things'))).startedAt
  = -0.42 * DOWNLOAD_SECONDS
