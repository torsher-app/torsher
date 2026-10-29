import type {
  DownloadTitleInput,
  OpenTitleInput,
  SourceCandidate,
  TitleDownload,
  TitleDownloadStart,
  TitleFiles,
  TitleOpen,
  TitleSources,
  Torrent,
  UpdateTorrentTitleInput,
} from '@torsher/api-client'
import type { DemoTorrent } from '../library.ts'
import { del, DemoError, get, post, put } from '@torsher/demo/router'
import { fakeInfohash } from '@torsher/demo/titles'
import { titleById } from '../cards.ts'
import {
  cancelDownload,
  fileDownload,
  openRelease,
  releasesFor,
  startDownload,
  titleDownload,
  torrentById,
  torrentFor,
  torrentsOf,
} from '../library.ts'
import { lastProgress, progressAt } from '../viewer.ts'

// Тройка «лучших» сервера: по профилю, по качеству и поменьше
const PICKS: NonNullable<SourceCandidate['pickReason']>[] = [
  'profile',
  'bestQuality',
  'smaller',
]

get<TitleSources>('/api/titles/:id/sources', ({ params }) => {
  const title = titleById(params.id!)
  const watchedFrom = lastProgress(title.id)?.torrentId
  const watchedCandidate = watchedFrom && torrentById(watchedFrom)?.candidateId
  const list = releasesFor(title).map(item => item.candidate)
  const top = [
    list.find(item => item.quality === '1080p'),
    list.find(item => item.quality === '2160p'),
    list.find(item => item.quality === '720p'),
  ].flatMap(item => item ?? [])
  const candidates = list.map(item => ({
    ...item,
    pickReason: top.includes(item) ? PICKS[top.indexOf(item)]! : null,
    lastWatched: item.id === watchedCandidate,
  }))
  const seasons = title.seasons?.length

  return {
    season: null,
    episode: null,
    updatedAt: new Date().toISOString(),
    profile: { qualities: ['1080p', '2160p'], voiceTypes: ['Original'] },
    pinnedVoice: null,
    seasonCandidate: seasons
      ? (list.find(item => item.isPack && item.seasons[0] === seasons)?.id
        ?? null)
      : null,
    top: top.map(item => item.id),
    candidates,
    voices: [
      {
        key: 'type:Original',
        type: 'Original',
        maxQuality: '2160p',
        seeders: list.reduce((sum, item) => sum + item.seeders, 0),
        count: list.length,
        pinned: false,
      },
    ],
    query: {
      current: null,
      suggestions: [title.title, `${title.title} ${title.year}`],
    },
    indexers: { total: 2, failed: [] },
  }
})

function openOrFail(titleId: string, candidateId: string) {
  const title = titleById(titleId)
  const torrent = openRelease(title, candidateId)

  if (!torrent) {
    throw new DemoError(422, {
      message: 'Release is gone',
      kind: 'candidate_gone',
    })
  }

  return torrent
}

post<TitleOpen, OpenTitleInput>('/api/titles/:id/open', ({ params, body }) => {
  const torrent = openOrFail(params.id!, body.candidateId)

  return {
    status: torrent.pendingPolls > 0 ? 'resolving' : 'ready',
    torrentId: torrent.id,
  }
})

/** Файлы раздачи; новая сначала пару опросов ждёт метаданные от пиров */
get<TitleFiles>('/api/titles/:id/files/:torrentId', ({ params }) => {
  const title = titleById(params.id!)
  const torrent = torrentFor(title, params.torrentId!)

  if (torrent.pendingPolls > 0) {
    torrent.pendingPolls -= 1
    return { status: 'resolving', name: '', files: [] }
  }

  return {
    status: 'ready',
    name: torrent.name,
    files: torrent.files.map((file) => {
      const point = progressAt(title.id, file.season ?? 0, file.episode ?? 0)

      return {
        ...file,
        position: point?.position ?? 0,
        duration: point?.duration ?? title.runtime * 60,
        watched: point?.watched ?? false,
        download: fileDownload(torrent, file.fileIndex),
      }
    }),
  }
})

get<TitleDownload>('/api/titles/:id/download', ({ params }) =>
  titleDownload(titleById(params.id!).id))

/**
 * «Скачать»: раздача из «Файлов» с отмеченными файлами или кандидат из
 * «Источников» (тогда сначала ждём его файлы, как сервер)
 */
post<TitleDownloadStart, DownloadTitleInput>(
  '/api/titles/:id/download',
  ({ params, body }) => {
    const title = titleById(params.id!)
    let torrent: DemoTorrent | undefined

    if (body.torrentId) {
      torrent = torrentFor(title, body.torrentId)
    }
    else if (body.candidateId) {
      torrent = openOrFail(title.id, body.candidateId)
    }
    else {
      throw new DemoError(422, {
        message: 'Nothing to download',
        kind: 'no_sources',
      })
    }

    if (torrent.pendingPolls > 0) {
      return {
        status: 'resolving',
        torrentId: torrent.id,
        candidateId: torrent.candidateId,
        files: 0,
        bytes: 0,
      }
    }

    const files
      = body.files
        ?? (body.season === undefined
          ? undefined
          : torrent.files
              .filter(file => file.season === body.season)
              .map(file => file.fileIndex))
    const download = startDownload(torrent, files)

    return {
      status: 'started',
      torrentId: torrent.id,
      candidateId: torrent.candidateId,
      files: download.files.length,
      bytes: download.bytes,
    }
  },
)

/** «Оставить»: раздачу, которую смотрели, докачать целиком */
post<TitleDownload>('/api/titles/:id/keep', ({ params }) => {
  const title = titleById(params.id!)
  const watched = lastProgress(title.id)?.torrentId
  const torrent
    = (watched && torrentById(watched))
      || torrentsOf(title.id).find(item => item.pendingPolls === 0)

  if (!torrent || !titleDownload(title.id).canKeep)
    throw new DemoError(409, { message: 'Nothing to keep' })

  startDownload(torrent)
  return titleDownload(title.id)
})

del<TitleDownload>('/api/titles/:id/download', ({ params, query }) => {
  const title = titleById(params.id!)

  if (!cancelDownload(title.id, query.get('torrentId') ?? undefined))
    throw new DemoError(409, { message: 'Nothing to cancel' })

  return titleDownload(title.id)
})

function torrentView(torrent: DemoTorrent, titleId: string | null): Torrent {
  const totalSize = torrent.files.reduce((sum, file) => sum + file.size, 0)

  return {
    id: torrent.id,
    infoHash: fakeInfohash(torrent.id),
    name: torrent.name,
    source: 'magnet',
    status: 'ready',
    error: null,
    files: torrent.files.map(file => ({
      index: file.fileIndex,
      path: file.name,
      size: file.size,
      isVideo: true,
      downloaded: 0,
      selected: false,
      inLibrary: false,
    })),
    totalSize,
    addedAt: new Date().toISOString(),
    lastAccessAt: null,
    titleId,
    matchStatus: titleId ? 'user' : 'unmatched',
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

put<Torrent, UpdateTorrentTitleInput>(
  '/api/torrents/:id/title',
  ({ params, body }) => {
    const torrent = torrentById(params.id!)

    if (!torrent)
      throw new DemoError(404, { message: 'Torrent not found' })

    if (body.titleId)
      torrent.titleId = titleById(body.titleId).id

    return torrentView(torrent, body.titleId)
  },
)
