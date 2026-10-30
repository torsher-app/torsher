import type {
  CreatePlaybackInput,
  HomeVideoList,
  HomeVideoSection,
  MessageResponse,
  Playback,
  PlaybackErrorInput,
  PlaybackTitleInput,
  SubtitleCues,
  TorrentStats,
  UpdateWatchStateInput,
  WatchState,
} from '@torsher/api-client'
import type { DemoTitle } from '@torsher/demo/titles'
import bbbVideo from '@torsher/demo/media/bbb-demo.mp4?url'
import sintelVideo from '@torsher/demo/media/sintel-demo.mp4?url'
import tosVideo from '@torsher/demo/media/tos-demo.mp4?url'
import {
  del,
  DemoError,
  get,
  NO_CONTENT,
  post,
  put,
} from '@torsher/demo/router'
import { nextId } from '@torsher/demo/state'
import { findTitle, releaseName, titleNamed } from '@torsher/demo/titles'
import { libraryEntry, peersOf, streamSpeed, torrentById } from '../library.ts'
import { playingFilm } from '../playing.ts'
import { savePosition } from '../viewer.ts'

interface Film {
  title: DemoTitle
  url: string
  seconds: number
  size: number
}

/**
 * Ролики плеера демо (`packages/demo/scripts/demo-videos.sh`): у каждого
 * фильма Blender свой, длиной как фильм. Выдуманные тайтлы играют Sintel
 */
const SINTEL: Film = {
  title: titleNamed('Sintel'),
  url: sintelVideo,
  seconds: 888,
  size: 189_440_000,
}
const FILMS: Film[] = [
  SINTEL,
  {
    title: titleNamed('Big Buck Bunny'),
    url: bbbVideo,
    seconds: 596,
    size: 276_134_964,
  },
  {
    title: titleNamed('Tears of Steel'),
    url: tosVideo,
    seconds: 734,
    size: 372_178_639,
  },
]

function filmOf(title?: DemoTitle) {
  return FILMS.find(film => film.title.id === title?.id) ?? SINTEL
}

interface Source {
  torrentId?: string
  fileIndex?: number
  mediaFileId?: string
}

/** Тайтл, серия и файл источника; ссылка на чужую раздачу — без тайтла */
function targetOf(source: Source, title?: PlaybackTitleInput) {
  const entry = source.mediaFileId
    ? libraryEntry(source.mediaFileId)
    : undefined
  const torrent = source.torrentId ? torrentById(source.torrentId) : undefined
  const file = torrent?.files.find(
    item => item.fileIndex === source.fileIndex,
  )
  const titleId = title?.id ?? entry?.titleId ?? torrent?.titleId

  return {
    title: titleId ? findTitle(titleId) : undefined,
    season: title?.season ?? entry?.season ?? file?.season ?? 0,
    episode: title?.episode ?? entry?.episode ?? file?.episode ?? 0,
    name: entry?.name ?? file?.name,
    size: entry?.size ?? file?.size,
  }
}

/**
 * В роликах кадры фильма идут только с 5:12, остальное — чёрная тишина.
 * Запуск без явной позиции начинается с них, иначе посетитель увидит чёрный
 * экран
 */
const FOOTAGE_AT = 312

const sessions = new Map<string, Playback>()

post<Playback, CreatePlaybackInput>('/api/playback', ({ body }) => {
  const target = targetOf(body, body.title)
  const film = filmOf(target.title)
  const title = target.title ?? film.title

  playingFilm.value = film.title.title

  const playback: Playback = {
    sessionId: nextId('playback'),
    status: 'ready',
    mode: 'direct',
    streamUrl: film.url,
    externalUrl: film.url,
    title: title.title,
    fileName: target.name ?? `${releaseName(film.title)}.mkv`,
    size: target.size ?? film.size,
    duration: film.seconds,
    startPosition: body.startPosition ?? FOOTAGE_AT,
    media: {
      container: 'mp4',
      video: { codec: 'h264', width: 1280, height: 720, hdr: false },
      audio: [
        {
          index: 1,
          language: 'en',
          title: null,
          codec: 'aac',
          channels: 2,
          bitrate: 128_000,
          default: true,
          studio: null,
          voiceType: null,
        },
      ],
      subtitles: [],
    },
    audioStream: 1,
    subtitle: null,
    audioSwitch: 'platform',
    reasons: [],
    transcode: null,
  }

  sessions.set(playback.sessionId, playback)
  return playback
})

get<Playback>('/api/playback/:id', ({ params }) => {
  const playback = sessions.get(params.id!)

  if (!playback)
    throw new DemoError(404, { message: 'Playback not found' })

  return playback
})

del<MessageResponse>('/api/playback/:id', ({ params }) => {
  sessions.delete(params.id!)
  return NO_CONTENT
})

// Журнала в демо нет: отчёт об ошибке плеера просто принимаем
post<MessageResponse, PlaybackErrorInput>(
  '/api/playback/:id/error',
  () => NO_CONTENT,
)

get<SubtitleCues>('/api/playback/:id/subtitles/:trackId', () => ({
  cues: [],
  done: true,
}))

put<WatchState, UpdateWatchStateInput>('/api/watch-state', ({ body }) => {
  const target = targetOf(body, body.title)

  if (target.title) {
    savePosition({
      titleId: target.title.id,
      season: target.season,
      episode: target.episode,
      position: body.position,
      duration: body.duration ?? null,
      torrentId: body.torrentId,
      fileIndex: body.fileIndex,
      mediaFileId: body.mediaFileId,
    })
  }

  return {
    torrentId: body.torrentId ?? null,
    fileIndex: body.fileIndex ?? null,
    mediaFileId: body.mediaFileId ?? null,
    position: body.position,
    duration: body.duration ?? null,
    updatedAt: new Date().toISOString(),
  }
})

/**
 * Статистика раздачи для плеера: файл с позиции уже есть — играет без
 * буферизации, а пиры и скорость живые
 */
get<TorrentStats>('/api/torrents/:id/stats', ({ params, query }) => {
  const file = torrentById(params.id!)?.files.find(
    item => item.fileIndex === Number(query.get('fileIndex')),
  )
  const size = file?.size ?? SINTEL.size
  const offset = Math.min(size, Number(query.get('offset')) || 0)

  return {
    activity: 'downloading',
    peers: peersOf(params.id!),
    downloadSpeed: streamSpeed(params.id!),
    uploadSpeed: Math.round(streamSpeed(`${params.id}:up`) / 8),
    file: { size, downloaded: size, bufferedAhead: size - offset },
    badPieces: 0,
  }
})

// Домашнего видео в демо нет: раздел пустой
get<HomeVideoSection>('/api/library/home', () => ({ albums: [] }))
get<HomeVideoList>('/api/library/home/videos', () => ({ items: [] }))
