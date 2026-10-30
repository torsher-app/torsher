import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { PlaybackSession } from '../services/media/index.ts'
import type { SessionInput } from '../services/media/sessions.ts'
import { messageResponse } from '../dto/common.ts'
import {
  createPlayback,
  insufficientStorageResponse,
  playback,
  playbackError,
  playbackParams,
  subtitleCues,
  subtitleParams,
  subtitleQuery,
  updateWatchState,
  watchState,
} from '../dto/playback.ts'
import { engineUnavailableResponse } from '../dto/torrents.ts'
import { requireViewer, streamSubjectOf } from '../middleware/auth.ts'
import { deviceTypeOf, getDevice } from '../services/devices/index.ts'
import { torrentStats } from '../services/engine/index.ts'
import {
  createSession,
  cuesInWindow,
  getSession,
  sessionCues,
  stopSession,
  voiceOfTrack,
} from '../services/media/index.ts'
import { playableMediaFile } from '../services/library/folders.ts'
import { fileProgressId } from '../services/library/index.ts'
import { clearMovieWatchlist } from '../services/mine/index.ts'
import { getProfile } from '../services/profiles/index.ts'
import {
  getTitleProgress,
  hasProgress,
  lastVoiceOfSeason,
  rememberVoice,
  saveTitleProgress,
} from '../services/sources/progress.ts'
import { getPinnedVoice } from '../services/sources/voices.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'
import { isWatched, resumePosition } from '../services/torrents/playback.ts'
import {
  fileNameOf,
  getTorrent,
  getWatchState,
  playableFile,
  prepareStream,
  saveWatchState,
  touchTorrent,
} from '../services/torrents/index.ts'
import { sessionVersionOf } from '../services/users/session.ts'
import { signToken } from '../utils/token.ts'
import { sendEngineError } from './engineResponses.ts'

const guardResponses = {
  401: messageResponse,
}

// Столько ответ `POST /playback` ждёт пробу файла: у скачанного она занимает
// доли секунды, у свежей раздачи клиент дождётся её опросом сессии
const PROBE_WAIT_MS = 4000
// Окно реплик субтитров: клиент спрашивает раз в несколько секунд
const CUES_WINDOW_SECONDS = 120

/** Токен потока: устройство отзывается удалением строки, у владельца — версия сессий */
function streamTokenOf(request: FastifyRequest) {
  const subject = streamSubjectOf(request)

  return encodeURIComponent(
    request.deviceId
      ? signToken(subject, 'stream')
      : signToken(subject, 'stream', sessionVersionOf(subject)),
  )
}

/**
 * Клиенты ходят в API через `/api` своего origin (прокси панели и витрины,
 * в продакшене — сам сервер), поэтому адреса для плеера — с этим префиксом.
 */
function streamUrlOf(
  session: PlaybackSession,
  token: string,
  mode = session.decision.mode,
) {
  if (mode === 'hls')
    return `/api/hls/${session.id}/main.m3u8?token=${token}`

  return session.library
    ? `/api/library/files/${session.library.id}/stream?token=${token}`
    : `/api/stream/${session.torrent!.id}/${session.fileIndex}?token=${token}`
}

/** Кто смотрит — для журнала: подключённое устройство или вход владельца */
function clientOf(request: FastifyRequest) {
  const device = request.deviceId ? getDevice(request.deviceId) : undefined

  return device
    ? `${device.type} "${device.name}"`
    : `owner ${deviceTypeOf(request.headers['user-agent'])}`
}

// Текст плеера идёт в журнал одной строкой
function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

interface Resume {
  duration: number | null
  startPosition: number | null
}

function toPlaybackResponse(
  session: PlaybackSession,
  request: FastifyRequest,
  resume: Resume,
) {
  const ready = session.status === 'ready'
  const { media, decision } = session
  const token = streamTokenOf(request)

  return {
    sessionId: session.id,
    status: session.status,
    mode: ready ? decision.mode : null,
    streamUrl: ready ? streamUrlOf(session, token) : null,
    // Внешний плеер читает файл сам: перепаковка закрывается вместе с плеером
    externalUrl: streamUrlOf(session, token, 'direct'),
    title: session.torrent?.name ?? session.fileName,
    fileName: session.fileName,
    size:
      session.library?.size
      ?? session.torrent?.files?.[session.fileIndex]?.size
      ?? 0,
    duration: media?.duration ?? resume.duration,
    startPosition: resume.startPosition,
    media: media && {
      container: media.container,
      video: media.video && {
        codec: media.video.codec,
        width: media.video.width,
        height: media.video.height,
        hdr: media.video.hdr,
      },
      audio: media.audio.map((track) => {
        const voice = voiceOfTrack(track)

        return {
          ...track,
          studio: voice?.studio ?? null,
          voiceType: voice?.type ?? null,
        }
      }),
      subtitles: [
        ...media.subtitles
          .filter(track => track.text || track.image)
          .map(track => ({
            id: `s${track.index}`,
            language: track.language,
            title: track.title,
            codec: track.codec,
            external: false,
            forced: track.forced,
            default: track.default,
            burnIn: track.image,
          })),
        ...session.external.map(track => ({
          id: `f${track.fileIndex}`,
          language: track.language,
          title: track.title,
          codec: track.format,
          external: true,
          forced: track.forced,
          default: false,
          burnIn: false,
        })),
      ],
    },
    audioStream: session.audioStream,
    subtitle: session.subtitle,
    audioSwitch: decision.audioSwitch,
    reasons: decision.reasons,
    transcode:
      decision.mode === 'hls' && decision.audio
        ? { audio: decision.audio, video: videoTranscodeOf(session) }
        : null,
  }
}

function videoTranscodeOf(session: PlaybackSession) {
  const plan = session.hls?.encode

  return plan
    ? {
        encoder: plan.encoder,
        width: plan.width,
        height: plan.height,
        toneMapping: plan.toneMapping,
      }
    : null
}

// Позиция для продолжения не меняется, пока сессия жива: запоминаем её
const resumes = new WeakMap<PlaybackSession, Resume>()

export const playbackRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireViewer)

  app.post(
    '/playback',
    {
      schema: {
        operationId: 'postPlayback',
        tags: ['Playback'],
        body: createPlayback,
        response: {
          200: playback,
          400: messageResponse,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
          502: messageResponse,
          503: engineUnavailableResponse,
          504: messageResponse,
          // Места не хватит даже после вытеснения кэша
          507: insufficientStorageResponse,
        },
      },
    },
    async (request, reply) => {
      const {
        torrentId,
        fileIndex,
        mediaFileId,
        device,
        language,
        audioStream,
        subtitle,
        startPosition,
        voiceStudio,
      } = request.body
      let { title } = request.body
      let source: Pick<SessionInput, 'torrent' | 'library' | 'fileIndex'>
      let fileName: string

      if (mediaFileId) {
        const found = playableMediaFile(mediaFileId, request.profileId)

        if (!found || (title && !parseCatalogId(title.id)))
          return reply.code(404).send({ message: 'File not found' })

        // Серия файла библиотеки известна из сопоставления
        title ??= found.file.titleId
          ? {
              id: found.file.titleId,
              season: found.file.season || undefined,
              episode: found.file.episode || undefined,
            }
          : undefined
        source = {
          library: {
            id: found.file.id,
            path: found.path,
            size: found.file.size,
          },
          fileIndex: 0,
        }
        fileName = fileNameOf(found.file.relPath)
      }
      else {
        const found = getTorrent(torrentId!)
        const file = found && playableFile(found, fileIndex!)

        if (!found || !file || (title && !parseCatalogId(title.id)))
          return reply.code(404).send({ message: 'File not found' })

        if (found.status !== 'ready') {
          return reply
            .code(409)
            .send({ message: 'Torrent metadata is not ready' })
        }

        try {
          source = {
            torrent: (await prepareStream(found, fileIndex!)) ?? found,
            fileIndex: fileIndex!,
          }
        }
        catch (err) {
          return sendEngineError(reply, err)
        }

        fileName = fileNameOf(file.path)
      }

      const ref = title && {
        profileId: request.profileId,
        titleId: title.id,
        season: title.season,
        episode: title.episode,
      }
      // Файл библиотеки без тайтла помнит позицию под своим ключом
      const fileRef
        = !title && mediaFileId
          ? {
              profileId: request.profileId,
              titleId: fileProgressId(mediaFileId),
            }
          : undefined
      // Прогресс серии сильнее позиции файла: раздачу могли сменить. Отметка
      // с карточки тоже: отмеченную серию не продолжаем с позиции файла
      const progress = ref
        ? getTitleProgress(ref)
        : fileRef && getTitleProgress(fileRef)
      const state
        = progress && hasProgress(progress)
          ? progress
          : torrentId
            ? getWatchState(request.profileId, torrentId, fileIndex!)
            : undefined
      // Озвучка прошлой раздачи при её смене, иначе серии (выбранная в
      // источниках или в плеере), иначе последних серий сезона, иначе
      // закреплённая за сезоном
      const lastVoice = title
        ? lastVoiceOfSeason(request.profileId, title.id, title.season ?? 0)
        : undefined
      const studio
        = voiceStudio
          ?? progress?.voiceStudio
          ?? (lastVoice && 'studio' in lastVoice ? lastVoice.studio : undefined)
          ?? (title
            ? getPinnedVoice(title.id, title.season ?? 0)?.studio
            : undefined)

      const session = createSession({
        subject: streamSubjectOf(request)!,
        ...source,
        fileName,
        device,
        client: clientOf(request),
        audioStream,
        subtitle,
        preference: {
          studio,
          locale: language ?? getProfile(request.profileId)?.language,
        },
        log: request.log.child({ source: 'playback' }),
      })
      // Перезапуск с новой дорожкой продолжает с позиции плеера
      const resume: Resume = {
        duration: state?.duration ?? null,
        startPosition:
          startPosition
          ?? (state ? resumePosition(state.position, state.duration) : null),
      }

      resumes.set(session, resume)

      // Дорожку выбрали в плеере: запоминаем её озвучку, когда проба покажет,
      // какая это дорожка
      if (ref && audioStream !== undefined) {
        void session.ready
          .then(() => {
            const track = session.media?.audio.find(
              item => item.index === audioStream,
            )
            const voice = track && voiceOfTrack(track)

            if (voice?.studio || voice?.type)
              rememberVoice(ref, voice)
          })
          .catch(() => {
            // Проба не удалась — запоминать нечего, ошибку покажет сама сессия
          })
      }
      await Promise.race([
        session.ready,
        new Promise(resolve => setTimeout(resolve, PROBE_WAIT_MS)),
      ])

      return toPlaybackResponse(session, request, resume)
    },
  )

  app.get(
    '/playback/:id',
    {
      schema: {
        operationId: 'getPlayback',
        tags: ['Playback'],
        params: playbackParams,
        response: { 200: playback, 404: messageResponse, ...guardResponses },
      },
    },
    async (request, reply) => {
      const session = getSession(request.params.id, streamSubjectOf(request))

      if (!session)
        return reply.code(404).send({ message: 'Playback not found' })

      // Статус — пульс плеера: пока он идёт, раздача считается используемой,
      // даже если плеер на паузе и потоков не открывает
      if (session.torrent)
        touchTorrent(session.torrent.id)

      return toPlaybackResponse(
        session,
        request,
        resumes.get(session) ?? { duration: null, startPosition: null },
      )
    },
  )

  app.delete(
    '/playback/:id',
    {
      schema: {
        operationId: 'deletePlayback',
        tags: ['Playback'],
        params: playbackParams,
        response: {
          200: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const session = getSession(request.params.id, streamSubjectOf(request))

      if (!session)
        return reply.code(404).send({ message: 'Playback not found' })

      await stopSession(session.id)
      return { message: 'Playback stopped' }
    },
  )

  app.post(
    '/playback/:id/error',
    {
      schema: {
        operationId: 'postPlaybackError',
        tags: ['Playback'],
        params: playbackParams,
        body: playbackError,
        response: {
          200: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const session = getSession(request.params.id, streamSubjectOf(request))

      if (!session)
        return reply.code(404).send({ message: 'Playback not found' })

      const { error, mediaError, detail, position } = request.body
      // Битые куски раздачи — частая причина ошибки медиа при прямом потоке
      const badPieces = session.torrent
        ? await torrentStats(session.torrent.infoHash).then(
            stats => stats.badPieces,
            () => undefined,
          )
        : undefined

      request.log
        .child({ source: 'playback' })
        .warn(
          `playback ${session.id}: player error ${error}${
            mediaError ? `, mediaError=${mediaError}` : ''
          }${detail ? `, detail="${oneLine(detail)}"` : ''}${
            position !== undefined ? `, at=${Math.round(position)}s` : ''
          }${badPieces !== undefined ? `, badPieces=${badPieces}` : ''}`,
        )

      return { message: 'Error logged' }
    },
  )

  app.get(
    '/playback/:id/subtitles/:trackId',
    {
      schema: {
        operationId: 'getPlaybackSubtitles',
        tags: ['Playback'],
        params: subtitleParams,
        querystring: subtitleQuery,
        response: {
          200: subtitleCues,
          404: messageResponse,
          502: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const session = getSession(request.params.id, streamSubjectOf(request))

      if (!session)
        return reply.code(404).send({ message: 'Playback not found' })

      let result

      try {
        result = await sessionCues(session, request.params.trackId)
      }
      catch (err) {
        request.log
          .child({ source: 'playback' })
          .warn(
            `subtitles ${request.params.trackId}: ${(err as Error).message}`,
          )
        return reply.code(502).send({ message: 'Subtitles are not available' })
      }

      if (!result)
        return reply.code(404).send({ message: 'Subtitle track not found' })

      const from = Number(request.query.from ?? 0)

      return {
        cues: cuesInWindow(result.cues, from, from + CUES_WINDOW_SECONDS),
        done: result.done,
      }
    },
  )

  app.put(
    '/watch-state',
    {
      schema: {
        operationId: 'putWatchState',
        tags: ['Playback'],
        body: updateWatchState,
        response: {
          200: watchState,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const { torrentId, fileIndex, mediaFileId, position, duration }
        = request.body
      let { title } = request.body
      const torrent = torrentId ? getTorrent(torrentId) : undefined
      const library = mediaFileId
        ? playableMediaFile(mediaFileId, request.profileId)
        : undefined

      if (
        (torrentId && (!torrent || !playableFile(torrent, fileIndex!)))
        || (mediaFileId && !library)
        || (title && !parseCatalogId(title.id))
      ) {
        return reply.code(404).send({ message: 'File not found' })
      }

      // У файла библиотеки позиция — по его серии тайтла
      if (library && !title && library.file.titleId) {
        title = {
          id: library.file.titleId,
          season: library.file.season || undefined,
          episode: library.file.episode || undefined,
        }
      }

      if (title) {
        saveTitleProgress(
          {
            profileId: request.profileId,
            titleId: title.id,
            season: title.season,
            episode: title.episode,
          },
          {
            position,
            duration: duration ?? null,
            // Файл библиотеки из раздачи помнит её: «Вы смотрели» и раздачи сезонов
            torrentId: torrentId ?? library?.file.torrentId ?? null,
            fileIndex: fileIndex ?? library?.file.fileIndex ?? null,
            mediaFileId: mediaFileId ?? null,
          },
        )

        if (title.season === undefined && isWatched(position, duration ?? null))
          clearMovieWatchlist(request.profileId, title.id)
      }
      else if (library) {
        saveTitleProgress(
          {
            profileId: request.profileId,
            titleId: fileProgressId(library.file.id),
          },
          {
            position,
            duration: duration ?? null,
            torrentId: library.file.torrentId,
            fileIndex: library.file.fileIndex,
            mediaFileId: library.file.id,
          },
        )
      }

      if (!torrentId) {
        return {
          torrentId: null,
          fileIndex: null,
          mediaFileId: mediaFileId ?? null,
          position,
          duration: duration ?? null,
          updatedAt: new Date().toISOString(),
        }
      }

      const saved = saveWatchState({
        profileId: request.profileId,
        torrentId,
        fileIndex: fileIndex!,
        position,
        duration: duration ?? null,
      })

      return {
        torrentId: saved.torrentId,
        fileIndex: saved.fileIndex,
        mediaFileId: null,
        position: saved.position,
        duration: saved.duration,
        updatedAt: saved.updatedAt.toISOString(),
      }
    },
  )
}
