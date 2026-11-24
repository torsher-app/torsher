import { demoCycle, demoPlaybackSample } from './mine.ts'
import type {
  CreatePlaybackInput,
  HomeVideoList,
  HomeVideoSection,
  MediaSubtitleTrack,
  MessageResponse,
  Playback,
  PlaybackErrorInput,
  PlaybackTitleInput,
  SubtitleApplyInputInput,
  SubtitleCues,
  SubtitleOffset,
  SubtitleOffsetInput,
  SubtitleSearchInputInput,
  SubtitleSearchResponse,
  TorrentStats,
  UpdatePlaybackPreferencesInput,
  UpdateWatchStateInput,
  ViewingAttempt,
  ViewingAttemptResponse,
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
import { currentProfile, savePosition } from '../viewer.ts'

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

type SubtitleLanguage = SubtitleSearchInputInput['language']
const sessions = new Map<
  string,
  {
    playback: Playback
    profileId: string
    subtitleKey: string
    subtitleLanguage?: SubtitleLanguage
  }
>()
const subtitleId = 'f0'
const downloadId = 'm00000000-0000-4000-8000-000000000001'
const resultId = '00000000-0000-4000-8000-000000000002'
const downloads = new Map<string, SubtitleLanguage>()
const subtitleOffsets = new Map<string, number>()
const subtitleCues = [
  {
    start: FOOTAGE_AT,
    end: FOOTAGE_AT + 6,
    text: 'The road leads back to the village.',
  },
  {
    start: FOOTAGE_AT + 10,
    end: FOOTAGE_AT + 17,
    text: 'We should be there by morning.',
  },
]
const russianCues = [
  {
    start: FOOTAGE_AT,
    end: FOOTAGE_AT + 6,
    text: 'Эта дорога ведёт обратно в деревню.',
  },
  {
    start: FOOTAGE_AT + 10,
    end: FOOTAGE_AT + 17,
    text: 'К утру будем на месте.',
  },
]

function subtitleOffsetKey(source: string, id: string) {
  return JSON.stringify([source, id])
}

function subtitleTrack(
  source: string,
  id: string,
  language: SubtitleLanguage,
): MediaSubtitleTrack {
  return {
    id,
    language,
    title: null,
    codec: 'srt',
    external: true,
    forced: false,
    default: false,
    burnIn: false,
    downloaded: id === downloadId,
    offsetMs: subtitleOffsets.get(subtitleOffsetKey(source, id)) ?? 0,
  }
}
const attempts = new Map<string, ViewingAttempt>()
const receipt = new Map<string, { attempt: ViewingAttempt, command: string }>()
const bindings = new Map<
  string,
  {
    profileId: string
    key: string
    source: string
    attempt: ViewingAttempt
    clientId: string
    playerId: string
    cycleId?: string
    line: number
    baseline: number | null
    advanced: boolean
  }
>()
const watermarks = new Map<string, number>()
const cyclePositions = new Map<
  string,
  { source: Source, position: number, duration: number | null }
>()
let viewingSerial = 0

function viewingKey(
  profileId: string,
  id: string | undefined,
  season: number,
  episode: number,
  cycleId?: string,
) {
  return JSON.stringify([profileId, id, season, episode, cycleId])
}

function sourceKey(source: Source) {
  return JSON.stringify(
    source.mediaFileId
      ? ['library', source.mediaFileId]
      : ['torrent', source.torrentId, source.fileIndex],
  )
}

function assertViewer(requested?: string | null) {
  const profileId = currentProfile().id
  if (requested && requested !== profileId)
    throw new DemoError(404, { message: 'Playback not found' })
  return profileId
}

function demoViewing(
  binding: NonNullable<ReturnType<typeof bindings.get>>,
): ViewingAttempt {
  return {
    ...binding.attempt,
    current: attempts.get(binding.key) === binding.attempt,
  }
}

get<ViewingAttemptResponse>('/api/playback/viewing-attempt', ({ query }) => {
  const profileId = assertViewer(query.get('profileId'))
  const cycleId = query.get('cycleId') ?? undefined
  const key = viewingKey(
    profileId,
    query.get('titleId') ?? undefined,
    Number(query.get('season')),
    Number(query.get('episode')),
    cycleId,
  )
  const attempt = attempts.get(key)
  const cursor = cycleId ? cyclePositions.get(key) : undefined
  return {
    attempt: attempt ? { ...attempt, current: true } : null,
    source: cursor?.source.mediaFileId
      ? { mediaFileId: cursor.source.mediaFileId }
      : cursor?.source.torrentId && cursor.source.fileIndex !== undefined
        ? {
            torrentId: cursor.source.torrentId,
            fileIndex: cursor.source.fileIndex,
          }
        : undefined,
  }
})

post<Playback, CreatePlaybackInput>('/api/playback', ({ body }) => {
  const profileId = assertViewer(body.profileId)
  if (body.viewing === null)
    throw new DemoError(400, { message: 'Invalid viewing request' })
  const target = targetOf(body, body.title)
  const film = filmOf(target.title)
  const title = target.title ?? film.title
  const key = viewingKey(
    profileId,
    title.id,
    target.season,
    target.episode,
    body.viewing?.cycleId,
  )
  const sessionId = nextId('playback')
  if (body.viewing) {
    if (
      body.mediaFileId
        ? !libraryEntry(body.mediaFileId)
        : !body.torrentId
          || !torrentById(body.torrentId)?.files.some(
            file => file.fileIndex === body.fileIndex,
          )
    ) {
      throw new DemoError(404, { message: 'Playback not found' })
    }
    const {
      requestId,
      clientId,
      playerId,
      cycleId,
      intent,
      expectedGeneration,
    } = body.viewing
    if (
      !requestId
      || !clientId
      || !playerId
      || !['join', 'restart'].includes(intent)
      || (intent === 'restart' && !Number.isSafeInteger(expectedGeneration))
      || !target.title
      || (cycleId && !target.episode)
    ) {
      throw new DemoError(400, { message: 'Invalid viewing request' })
    }
    const receiptKey = JSON.stringify([profileId, requestId])
    const source = sourceKey(body)
    const command = JSON.stringify([
      key,
      source,
      intent,
      expectedGeneration ?? null,
    ])
    const before = receipt.get(receiptKey)
    const current = attempts.get(key)
    if (
      before
        ? before.command !== command
        : expectedGeneration !== undefined
          && expectedGeneration !== (current?.generation ?? 0)
    ) {
      throw new DemoError(409, {
        message: 'Viewing attempt conflict',
        kind: 'viewingAttemptConflict',
      })
    }
    let attempt = before?.attempt ?? (intent === 'join' ? current : undefined)
    if (!attempt) {
      if (current?.state === 'open')
        current.state = 'abandoned'
      attempt = {
        attemptId: `00000000-0000-4000-8000-${(++viewingSerial).toString(16).padStart(12, '0')}`,
        generation: (current?.generation ?? 0) + 1,
        state: 'open',
      }
      attempts.set(key, attempt)
    }
    receipt.set(receiptKey, { attempt, command })
    bindings.set(sessionId, {
      profileId,
      key,
      attempt,
      source,
      clientId,
      playerId,
      cycleId,
      line: 0,
      baseline: null,
      advanced: false,
    })
  }

  playingFilm.value = film.title.title

  const binding = bindings.get(sessionId)
  const cursor = binding?.cycleId ? cyclePositions.get(key) : undefined
  const subtitleKey = JSON.stringify([profileId, sourceKey(body)])
  const downloaded = downloads.get(subtitleKey)
  const subtitles
    = film.title.title === 'Big Buck Bunny'
      ? [subtitleTrack(subtitleKey, subtitleId, 'en')]
      : []
  if (downloaded)
    subtitles.push(subtitleTrack(subtitleKey, downloadId, downloaded))
  const playback: Playback = {
    sessionId,
    viewing: binding && demoViewing(binding),
    status: 'ready',
    mode: 'direct',
    streamUrl: film.url,
    externalUrl: film.url,
    title: title.title,
    fileName: target.name ?? `${releaseName(film.title)}.mkv`,
    size: target.size ?? film.size,
    duration: film.seconds,
    startPosition: body.startPosition ?? cursor?.position ?? FOOTAGE_AT,
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
      subtitles,
    },
    audioStream: 1,
    subtitle: subtitles.some(track => track.id === body.subtitle)
      ? body.subtitle!
      : null,
    subtitleSearch: {
      providers: ['opensubtitles'],
      languages: ['en', 'ru'],
      defaultLanguage: currentProfile().language === 'en_US' ? 'en' : 'ru',
      canRemove: true,
    },
    audioSwitch: 'platform',
    reasons: [],
    transcode: null,
  }

  sessions.set(playback.sessionId, { playback, profileId, subtitleKey })
  return playback
})

get<Playback>('/api/playback/:id', ({ params }) => {
  const { playback } = playbackSession(params.id!)
  const binding = bindings.get(params.id!)

  return binding ? { ...playback, viewing: demoViewing(binding) } : playback
})

function playbackSession(id: string) {
  const session = sessions.get(id)
  if (!session || session.profileId !== currentProfile().id)
    throw new DemoError(404, { message: 'Playback not found' })
  return session
}

put<MessageResponse, UpdatePlaybackPreferencesInput>(
  '/api/playback/:id/preferences',
  ({ params, body }) => {
    const { playback } = playbackSession(params.id!)
    if (
      (body.audioStream !== undefined
        && !playback.media?.audio.some(
          track => track.index === body.audioStream,
        ))
        || (body.subtitle
          && !playback.media?.subtitles.some(track => track.id === body.subtitle))
    ) {
      throw new DemoError(400, { message: 'Track not found' })
    }
    return { message: 'Playback preferences saved' }
  },
)

del<MessageResponse>('/api/playback/:id', ({ params }) => {
  sessions.delete(params.id!)
  return NO_CONTENT
})

// Журнала в демо нет: отчёт об ошибке плеера просто принимаем
post<MessageResponse, PlaybackErrorInput>(
  '/api/playback/:id/error',
  () => NO_CONTENT,
)

get<SubtitleCues>(
  '/api/playback/:id/subtitles/:trackId',
  ({ params, query }) => {
    const { playback } = playbackSession(params.id!)
    const track = playback.media?.subtitles.find(
      item => item.id === params.trackId,
    )
    if (!track)
      throw new DemoError(404, { message: 'Subtitle track not found' })
    const from = Number(query.get('from') ?? 0)
    const cues = track.language === 'ru' ? russianCues : subtitleCues
    return { cues: cues.filter(cue => cue.end > from), done: true }
  },
)

post<SubtitleSearchResponse, SubtitleSearchInputInput>(
  '/api/playback/:id/subtitles/search',
  ({ params, body }) => {
    const session = playbackSession(params.id!)
    if (!session.playback.subtitleSearch?.languages.includes(body.language))
      throw new DemoError(400, { message: 'Unsupported subtitle language' })
    session.subtitleLanguage = body.language
    return {
      items: [
        {
          id: resultId,
          provider: 'opensubtitles',
          language: body.language,
          release: session.playback.fileName,
          match: 'release',
        },
      ],
      issues: [],
    }
  },
)

post<MediaSubtitleTrack, SubtitleApplyInputInput>(
  '/api/playback/:id/subtitles/apply',
  ({ params, body }) => {
    const { playback, subtitleKey, subtitleLanguage } = playbackSession(
      params.id!,
    )
    if (body.resultId !== resultId || !subtitleLanguage || !playback.media)
      throw new DemoError(404, { message: 'Subtitle result not found' })
    downloads.set(subtitleKey, subtitleLanguage)
    const track = subtitleTrack(subtitleKey, downloadId, subtitleLanguage)
    playback.media.subtitles = [
      ...playback.media.subtitles.filter(item => item.id !== downloadId),
      track,
    ]
    return track
  },
)

del<MessageResponse>('/api/playback/:id/subtitles/:trackId', ({ params }) => {
  const { playback, subtitleKey } = playbackSession(params.id!)
  if (
    params.trackId !== downloadId
    || !playback.media?.subtitles.some(item => item.id === downloadId)
  ) {
    throw new DemoError(404, { message: 'Subtitle track not found' })
  }
  downloads.delete(subtitleKey)
  subtitleOffsets.delete(subtitleOffsetKey(subtitleKey, downloadId))
  playback.media.subtitles = playback.media.subtitles.filter(
    item => item.id !== downloadId,
  )
  if (playback.subtitle === downloadId)
    playback.subtitle = null
  return NO_CONTENT
})

put<SubtitleOffset, SubtitleOffsetInput>(
  '/api/playback/:id/subtitles/:trackId/offset',
  ({ params, body }) => {
    const { playback, subtitleKey } = playbackSession(params.id!)
    const track = playback.media?.subtitles.find(
      track => track.id === params.trackId,
    )
    if (!track)
      throw new DemoError(404, { message: 'Subtitle track not found' })
    if (!Number.isInteger(body.offsetMs) || Math.abs(body.offsetMs) > 30_000)
      throw new DemoError(400, { message: 'Invalid subtitle offset' })
    subtitleOffsets.set(
      subtitleOffsetKey(subtitleKey, track.id),
      body.offsetMs,
    )
    track.offsetMs = body.offsetMs
    return { offsetMs: body.offsetMs }
  },
)

put<WatchState, UpdateWatchStateInput>('/api/watch-state', ({ body }) => {
  const profileId = assertViewer(body.profileId)
  if (body.viewing === null)
    throw new DemoError(400, { message: 'Invalid viewing checkpoint' })
  const target = targetOf(body, body.title)
  const binding = body.sessionId ? bindings.get(body.sessionId) : undefined
  const response = {
    torrentId: body.torrentId ?? null,
    fileIndex: body.fileIndex ?? null,
    mediaFileId: body.mediaFileId ?? null,
    position: body.position,
    duration: body.duration ?? null,
    updatedAt: new Date().toISOString(),
  }
  if (binding && !body.viewing)
    throw new DemoError(404, { message: 'Playback not found' })
  if (body.viewing) {
    const { line, playerId, kind } = body.viewing
    const event = body.event
    if (
      !body.sessionId
      || !event
      || !playerId
      || !Number.isSafeInteger(event.sequence)
      || event.sequence < 1
      || !Number.isSafeInteger(line)
      || line < 0
      || !['playback', 'seek', 'pause', 'stop', 'source_switch'].includes(kind)
    ) {
      throw new DemoError(400, { message: 'Invalid viewing checkpoint' })
    }
    if (
      !binding
      || profileId !== binding.profileId
      || binding.playerId !== playerId
      || binding.clientId !== event.clientId
      || binding.source !== sourceKey(body)
      || binding.key
      !== viewingKey(
        profileId,
        target.title?.id,
        target.season,
        target.episode,
        binding.cycleId,
      )
      || !demoViewing(binding).current
      || binding.attempt.state === 'abandoned'
    ) {
      return {
        ...response,
        position: 0,
        duration: null,
        accepted: false,
        rejection: 'viewingConflict',
      }
    }
    const resource = binding.cycleId
      ? [profileId, binding.cycleId]
      : binding.key
    const watermark = JSON.stringify([resource, event.clientId])
    if (
      line < binding.line
      || event.sequence <= (watermarks.get(watermark) ?? 0)
    ) {
      return { ...response, accepted: false, rejection: 'stale' }
    }
    const cycle = binding.cycleId
      ? demoCycle(profileId, binding.cycleId)
      : undefined
    if (cycle && cycle.state !== 'active')
      return { ...response, accepted: false, rejection: 'viewingConflict' }
    const previous = line === binding.line ? binding.baseline : null
    const reset = kind === 'seek' || kind === 'source_switch'
    const playing = kind === 'playback'
    const forward = playing && previous !== null && body.position > previous
    const backward = playing && previous !== null && body.position < previous
    binding.advanced
      = !reset
        && !backward
        && (forward || (line === binding.line && binding.advanced))
    binding.baseline = reset ? null : playing ? body.position : previous
    binding.line = line
    watermarks.set(watermark, event.sequence)
    const duration = body.duration ?? null
    const completed
      = binding.attempt.state === 'open'
        && binding.advanced
        && (playing || kind === 'stop')
        && duration !== null
        && duration > 0
        && body.position >= duration * 0.9
        && body.position <= duration
    if (target.title) {
      demoPlaybackSample(
        profileId,
        {
          titleId: target.title.id,
          season: target.season,
          episode: target.episode,
        },
        body.mediaFileId
          ? { kind: 'library', mediaFileId: body.mediaFileId }
          : body.torrentId && body.fileIndex !== undefined
            ? {
                kind: 'torrent',
                torrentId: body.torrentId,
                fileIndex: body.fileIndex,
              }
            : null,
        body.position,
        duration,
        forward,
        completed,
        binding.cycleId,
      )
      if (completed)
        binding.attempt.state = 'completed'
    }
    if (binding.cycleId) {
      cyclePositions.set(binding.key, {
        source: {
          mediaFileId: body.mediaFileId,
          torrentId: body.torrentId,
          fileIndex: body.fileIndex,
        },
        position: body.position,
        duration: body.duration ?? null,
      })
      return { ...response, accepted: true }
    }
  }

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
    ...response,
    accepted: body.viewing ? true : undefined,
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
    peers: { ...peersOf(params.id!), seeders: 0 },
    downloadSpeed: streamSpeed(params.id!),
    uploadSpeed: Math.round(streamSpeed(`${params.id}:up`) / 8),
    file: {
      size,
      downloaded: size,
      bufferedAhead: size - offset,
      ...(query.has('time')
        ? {
            playbackCache: {
              sampledAtSeconds: Number(query.get('time')),
              anchorOffset: 0,
              contiguousEndOffset: size,
              bufferedUntilSeconds: (
                FILMS.find(item => item.size === size) ?? SINTEL
              ).seconds,
              verifiedToEnd: true,
            },
          }
        : {}),
    },
    badPieces: 0,
  }
})

// Домашнего видео в демо нет: раздел пустой
get<HomeVideoSection>('/api/library/home', () => ({ albums: [] }))
get<HomeVideoList>('/api/library/home/videos', () => ({ items: [] }))
