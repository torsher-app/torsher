import { z } from 'zod'
import {
  subtitleApplyInput,
  subtitleSearchInput,
  subtitleSearchResponse,
} from '../dto/subtitles.ts'
import {
  applyPlaybackSubtitle,
  downloadedSubtitleView,
  removePlaybackSubtitle,
  searchPlaybackSubtitles,
  SubtitlePlaybackError,
  subtitleSearchContextOf,
} from '../services/subtitles/playback.ts'
import { preparePlayedSource } from '../services/sources/playedSource.ts'
import { acceptWatchEvent } from '../services/watchEvents.ts'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/index.ts'
import { libraryFolders, mediaFiles } from '../db/schema.ts'
import { TS_OFFSET_SECONDS } from '../services/media/hls.ts'
import {
  folderWithLibrary,
  playableMediaFile,
  unavailableTorrentFiles,
} from '../services/library/folders.ts'
import { stat } from 'node:fs/promises'
import {
  getPlaybackPreferences,
  savePlaybackPreferences,
} from '../services/playbackPreferences.ts'
import {
  audioPreferenceOf,
  trackLanguage,
} from '../services/media/trackPreferences.ts'
import type { SavedTrackPreferences } from '../services/media/trackPreferences.ts'
import { diagnosticContext } from '../services/diagnostics/index.ts'
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { PlaybackSession } from '../services/media/index.ts'
import type { CycleSource, MediaFile, Torrent } from '../db/schema.ts'
import type { SessionInput } from '../services/media/sessions.ts'
import {
  currentSubtitleKey,
  currentSubtitleSource,
  validatedCheckpoint,
} from '../services/media/sessions.ts'
import {
  availableDownloadedSubtitles,
  downloadedSubtitleId,
  saveSubtitleOffset,
  subtitleOffsetsOf,
} from '../services/media/downloadedSubtitles.ts'
import {
  libraryProbeKey,
  libraryRevisionMatches,
  storedProbeMatches,
} from '../services/library/playedSource.ts'
import { viewingAttemptQuery, viewingAttemptResponse } from '../dto/viewing.ts'
import {
  applyViewingCheckpoint,
  beginViewing,
  bindViewing,
  currentViewingAttempt,
  cycleRevision,
  exactViewingRef,
  getCycleCursor,
  isCurrentViewing,
  liveViewingAttempt,
  playableCycle,
  rememberLegacyCompletion,
  saveCycleCursor,
  validateViewing,
  viewingAttemptWire,
} from '../services/mine/viewing.ts'
import { messageResponse } from '../dto/common.ts'
import {
  createPlayback,
  insufficientStorageResponse,
  playback,
  playbackError,
  playbackParams,
  playbackStartConflict,
  subtitleCues,
  subtitleOffset,
  subtitleParams,
  subtitleQuery,
  subtitleTrack,
  updatePlaybackPreferences,
  updateWatchState,
  watchState,
} from '../dto/playback.ts'
import { engineUnavailableResponse } from '../dto/torrents.ts'
import {
  requireSameOrigin,
  requireViewer,
  streamSubjectOf,
  viewerStillOnProfile,
} from '../middleware/auth.ts'
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
import { fileProgressId } from '../services/library/index.ts'
import { clearMovieWatchlist } from '../services/mine/index.ts'
import { getProfile } from '../services/profiles/index.ts'
import {
  getTitleProgress,
  hasProgress,
  lastVoiceOfSeason,
  launchSelectionOf,
  rememberVoice,
  rememberVoiceIntent,
  sameTitleRef,
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
  torrentsByInfoHash,
  touchTorrent,
} from '../services/torrents/index.ts'
import { sessionVersionOf } from '../services/users/session.ts'
import { signToken } from '../utils/token.ts'
import { engineFailureOf, sendEngineError } from './engineResponses.ts'
import {
  hasAgeLimit,
  titleAllowed,
  titleAllowedCached,
} from '../services/profiles/access.ts'
import { getMediaFile } from '../services/library/files.ts'
import {
  bindSessionProfile,
  sessionAccessible,
} from '../services/profiles/playbackAccess.ts'

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
      : signToken(
          subject,
          'stream',
          sessionVersionOf(subject),
          request.profileId,
        ),
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

/** Отказ открыть просмотр: клиенту уходит код, в журнал — причина */
function logRejection(
  request: FastifyRequest,
  reason: string,
  fields: Record<string, string | number>,
) {
  request.log
    .child({ source: 'playback' })
    .warn(fields, `playback rejected: ${reason}`)
}

// Текст плеера идёт в журнал одной строкой
function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

interface Resume {
  duration: number | null
  startPosition: number | null
}

const sessionViewings = new WeakSet<PlaybackSession>()

async function toPlaybackResponse(
  session: PlaybackSession,
  request: FastifyRequest,
  resume: Resume,
) {
  const { profileId } = request
  let downloaded = session.downloadedSubtitles
  if (downloaded.length) {
    const present = await availableDownloadedSubtitles(downloaded)
    const revision = await currentSubtitleSource(session)
    if (
      getSession(session.id, streamSubjectOf(request)) !== session
      || !viewerStillOnProfile(request, profileId)
      || !playbackSessionAccessible(session, profileId)
    ) {
      return undefined
    }

    downloaded = revision ? present : []
  }
  const selected
    = session.subtitle?.startsWith('m')
      && !downloaded.some(
        track => downloadedSubtitleId(track) === session.subtitle,
      )
      ? null
      : session.subtitle
  const ready = session.status === 'ready'
  const { media, decision } = session
  const token = streamTokenOf(request)
  const revision = session.playedEvidence?.probeKey
  const offsets
    = media && revision && session.subtitleKeys.size
      ? subtitleOffsetsOf(request.profileId, revision)
      : undefined
  const subtitleOffsetMs = (id: string) => {
    const key = session.subtitleKeys.get(id)
    return key && offsets ? (offsets.get(key) ?? 0) : undefined
  }

  return {
    sessionId: session.id,
    viewing: sessionViewings.has(session)
      ? sessionViewingResponse(session.id)
      : undefined,
    skipSegments: session.skipSegments,
    status: session.status,
    mode: ready ? decision.mode : null,
    streamUrl: ready ? streamUrlOf(session, token) : null,
    ...(session.hls ? { hlsTimestampOffset: TS_OFFSET_SECONDS } : {}),
    // Внешний плеер читает файл сам: перепаковка закрывается вместе с плеером
    externalUrl: streamUrlOf(session, token, 'direct'),
    title: session.torrent?.name ?? session.fileName,
    fileName: session.fileName,
    size:
      session.library?.size
      ?? session.torrent?.files?.[session.fileIndex]?.size
      ?? 0,
    duration: session.hls?.duration ?? media?.duration ?? resume.duration,
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
            offsetMs: subtitleOffsetMs(`s${track.index}`),
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
          offsetMs: subtitleOffsetMs(`f${track.fileIndex}`),
        })),
        ...downloaded.map(track =>
          downloadedSubtitleView(
            track,
            subtitleOffsetMs(downloadedSubtitleId(track)) ?? 0,
          ),
        ),
      ],
    },
    preferenceMismatch: session.preferenceMismatch,
    audioStream: session.audioStream,
    subtitle: selected,
    subtitleSearch: subtitleSearchContextOf(
      session,
      !!request.userId && !request.deviceId,
      profileId,
      downloaded,
    ),
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
const preferenceOwners = new WeakMap<
  PlaybackSession,
  NonNullable<SessionInput['progressRef']>
>()
const sessionCycleSources = new WeakMap<PlaybackSession, CycleSource>()

function playbackSessionAccessible(
  session: PlaybackSession,
  profileId: string,
) {
  const cycle = sessionCycleSources.get(session)
  return (
    sessionAccessible(session, profileId)
    && (cycle?.kind !== 'torrent'
      || (!!session.torrent
        && !unavailableTorrentFiles(profileId, session.torrent.id).has(
          session.fileIndex,
        )))
  )
}
const subtitleActionErrors = {
  ...guardResponses,
  403: messageResponse,
  404: messageResponse,
  409: messageResponse,
  429: messageResponse,
  502: messageResponse,
}

function subtitleActionContext(request: FastifyRequest, id: string) {
  const subject = streamSubjectOf(request)
  const { profileId } = request
  const session = getSession(id, subject)
  if (!session || !playbackSessionAccessible(session, profileId))
    return undefined

  return {
    session,
    viewer: {
      owner: !!request.userId && !request.deviceId,
      profileId,
      current: () =>
        getSession(id, subject) === session
        && viewerStillOnProfile(request, profileId)
        && playbackSessionAccessible(session, profileId),
    },
  }
}

function sessionViewingResponse(id: string) {
  const attempt = liveViewingAttempt(id)
  return (
    attempt
    && viewingAttemptWire(
      attempt,
      isCurrentViewing(attempt, attempt.cycleLifecycleRevision),
    )
  )
}

function linkedPlaybackTitle(file?: MediaFile) {
  return file?.titleId
    ? {
        id: file.titleId,
        season: file.episode ? (file.season ?? undefined) : undefined,
        episode: file.episode || undefined,
      }
    : undefined
}

function libraryFileStillPlayable(
  snapshot: NonNullable<ReturnType<typeof playableMediaFile>>,
  profileId: string,
  titleId?: string,
) {
  const current = playableMediaFile(snapshot.file.id, profileId)
  return (
    current?.path === snapshot.path
    && current.file.folderId === snapshot.file.folderId
    && current.file.titleId === snapshot.file.titleId
    && current.file.season === snapshot.file.season
    && current.file.episode === snapshot.file.episode
    && current.file.episodeTo === snapshot.file.episodeTo
    && current.file.torrentId === snapshot.file.torrentId
    && current.file.fileIndex === snapshot.file.fileIndex
    && (!titleId || !hasAgeLimit(profileId) || titleId === current.file.titleId)
  )
}

function torrentFileStillPlayable(
  snapshot: Torrent,
  fileIndex: number,
  profileId: string,
  titleId?: string,
  cycle = false,
) {
  const current = getTorrent(snapshot.id)
  return (
    current?.infoHash === snapshot.infoHash
    && !!playableFile(current, fileIndex)
    && titleAllowedCached(profileId, current.titleId)
    && (!titleId || !hasAgeLimit(profileId) || titleId === current.titleId)
    && (!cycle || !unavailableTorrentFiles(profileId, current.id).has(fileIndex))
  )
}

function playbackOwner(
  profileId: string,
  title?: { id: string, season?: number, episode?: number },
  mediaFileId?: string,
) {
  if (title) {
    return {
      profileId,
      titleId: title.id,
      season: title.season,
      episode: title.episode,
    }
  }
  if (mediaFileId)
    return { profileId, titleId: fileProgressId(mediaFileId) }
}

async function cycleResumeSource(
  ref: NonNullable<ReturnType<typeof exactViewingRef>>,
  source: CycleSource,
) {
  if (source.kind === 'library') {
    const entry = getDb()
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .innerJoin(libraryFolders, eq(mediaFiles.folderId, libraryFolders.id))
      .where(
        and(
          eq(libraryFolders.path, source.folder),
          eq(mediaFiles.relPath, source.path),
        ),
      )
      .get()
    const file = entry && playableMediaFile(entry.id, ref.profileId)
    if (
      !file
      || file.file.titleId !== ref.titleId
      || file.file.season !== ref.season
      || file.file.episode === null
      || ref.episode < file.file.episode
      || ref.episode > (file.file.episodeTo ?? file.file.episode)
    ) {
      return undefined
    }
    const info = await stat(file.path).catch(() => undefined)
    return info?.isFile() && libraryFileStillPlayable(file, ref.profileId)
      ? { mediaFileId: file.file.id }
      : undefined
  }
  const torrent = torrentsByInfoHash([source.infoHash]).get(source.infoHash)
  if (
    !torrent
    || torrent.titleId !== ref.titleId
    || torrent.status !== 'ready'
    || !playableFile(torrent, source.fileIndex)
    || unavailableTorrentFiles(ref.profileId, torrent.id).has(source.fileIndex)
  ) {
    return undefined
  }
  return { torrentId: torrent.id, fileIndex: source.fileIndex }
}

export const playbackRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireViewer)

  app.get(
    '/playback/viewing-attempt',
    {
      schema: {
        operationId: 'getViewingAttempt',
        tags: ['Playback'],
        querystring: viewingAttemptQuery,
        response: {
          200: viewingAttemptResponse,
          400: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const {
        titleId,
        season,
        episode,
        cycleId,
        profileId = request.profileId,
      } = request.query
      const current = () => viewerStillOnProfile(request, profileId)
      const ref = exactViewingRef({ profileId, titleId, season, episode })
      if (
        !current()
        || !ref
        || !(await titleAllowed(profileId, titleId))
        || !current()
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }

      const revision = cycleId ? cycleRevision(profileId, cycleId) : undefined
      if (
        cycleId
        && (revision === undefined || !playableCycle(ref, cycleId, revision))
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }
      const cursor = cycleId && getCycleCursor(ref, cycleId)
      const source
        = cursor && cursor.source
          ? await cycleResumeSource(ref, cursor.source)
          : undefined
      if (
        !current()
        || !titleAllowedCached(profileId, titleId)
        || (cycleId && !playableCycle(ref, cycleId, revision))
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }
      const attempt = currentViewingAttempt(ref, cycleId)
      return {
        attempt: attempt ? viewingAttemptWire(attempt) : null,
        source,
        voiceStudio: cursor ? (cursor.voiceStudio ?? undefined) : undefined,
      }
    },
  )

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
          409: playbackStartConflict,
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
      if (
        request.body.profileId
        && request.body.profileId !== request.profileId
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }

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
        viewing,
      } = request.body
      const cycleId = viewing?.cycleId
      const { profileId } = request
      const currentViewer = () =>
        viewerStillOnProfile(request, request.body.profileId ?? profileId)
      const revisionAtStart = cycleId
        ? cycleRevision(request.profileId, cycleId)
        : undefined
      if (cycleId && revisionAtStart === undefined)
        return reply.code(404).send({ message: 'Playback not found' })
      const { title: requestedTitle } = request.body
      const actual = mediaFileId ? getMediaFile(mediaFileId) : undefined
      const torrent = torrentId ? getTorrent(torrentId) : undefined
      const entry = torrent && playableFile(torrent, fileIndex!)
      let title = requestedTitle ?? linkedPlaybackTitle(actual?.file)
      const initialOwner = playbackOwner(request.profileId, title, mediaFileId)
      const initialSelection
        = (actual || entry)
          && initialOwner
          && (!requestedTitle || parseCatalogId(requestedTitle.id))
          ? launchSelectionOf(initialOwner, getTitleProgress(initialOwner))
          : undefined
      let source: Pick<SessionInput, 'torrent' | 'library' | 'fileIndex'>
      let fileName: string
      let libraryAtStart: ReturnType<typeof playableMediaFile>
      let viewingSource: { source: CycleSource, revision: string } | undefined

      if (mediaFileId) {
        if (
          !(await titleAllowed(
            request.profileId,
            actual
            && folderWithLibrary(actual.file.folderId)?.library.kind === 'home'
              ? null
              : actual?.file.titleId,
          ))
        ) {
          return reply.code(404).send({ message: 'File not found' })
        }
        const found = playableMediaFile(mediaFileId, request.profileId)

        const available
          = found
            && (await stat(found.path).catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
                return null
              throw error
            }))
        if (
          !found
          || !available?.isFile()
          || (requestedTitle
            && (!parseCatalogId(requestedTitle.id)
              || (hasAgeLimit(request.profileId)
                && requestedTitle.id !== found.file.titleId)))
        ) {
          logRejection(request, 'file not found', { libraryId: mediaFileId })
          return reply.code(404).send({ message: 'File not found' })
        }

        // Серия файла библиотеки известна из сопоставления
        libraryAtStart = found
        title = requestedTitle ?? linkedPlaybackTitle(found.file)
        source = {
          library: {
            id: found.file.id,
            path: found.path,
            size: found.file.size,
            origin: {
              torrentId: found.file.torrentId,
              fileIndex: found.file.fileIndex,
            },
            storedEvidence: storedProbeMatches(found.file, available)
              ? {
                  probeKey: libraryProbeKey(found.file.id, available),
                  video: found.file.probe?.video
                    ? {
                        width: found.file.probe.video.width,
                        height: found.file.probe.video.height,
                      }
                    : null,
                }
              : undefined,
          },
          fileIndex: 0,
        }
        fileName = fileNameOf(found.file.relPath)
        if (viewing) {
          const folder = folderWithLibrary(found.file.folderId)
          if (!folder || folder.library.kind === 'home')
            return reply.code(404).send({ message: 'Playback not found' })
          viewingSource = {
            source: {
              kind: 'library',
              folder: folder.folder.path,
              path: found.file.relPath,
            },
            revision: libraryProbeKey(found.file.id, available),
          }
        }
      }
      else {
        const found = torrent
        const file = entry

        const fields = {
          torrentId: torrentId!,
          ...(found && { infoHash: found.infoHash }),
          fileIndex: fileIndex!,
        }

        if (
          !found
          || !file
          || !(await titleAllowed(request.profileId, found.titleId))
          || (title
            && (!parseCatalogId(title.id)
              || (hasAgeLimit(request.profileId) && title.id !== found.titleId)))
        ) {
          logRejection(request, 'file not found', fields)
          return reply.code(404).send({ message: 'File not found' })
        }

        if (found.status !== 'ready') {
          logRejection(request, 'metadata not ready', {
            ...fields,
            status: found.status,
          })
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
          if (
            !currentViewer()
            || !torrentFileStillPlayable(
              found,
              fileIndex!,
              profileId,
              title?.id,
              !!cycleId,
            )
          ) {
            return reply.code(404).send({ message: 'File not found' })
          }
          const failure = engineFailureOf(err)

          if (failure) {
            logRejection(request, failure.reason, {
              ...fields,
              ...failure.fields,
            })
          }
          return sendEngineError(reply, err, found)
        }

        fileName = fileNameOf(file.path)
        if (viewing) {
          viewingSource = {
            source: {
              kind: 'torrent',
              infoHash: found.infoHash,
              fileIndex: fileIndex!,
            },
            revision: JSON.stringify([
              'torrent',
              found.id,
              found.infoHash,
              fileIndex,
            ]),
          }
        }
      }

      const preferenceOwner = playbackOwner(
        request.profileId,
        title,
        mediaFileId,
      )
      const ref = title ? preferenceOwner : undefined
      const viewingRef = viewing && ref ? exactViewingRef(ref) : undefined
      if (
        viewing
        && (!viewingSource
          || !viewingRef
          || !(await titleAllowed(profileId, viewingRef.titleId)))
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }
      const sourceAccessible = () =>
        libraryAtStart
          ? libraryFileStillPlayable(libraryAtStart, profileId, title?.id)
          : torrentFileStillPlayable(
              source.torrent!,
              source.fileIndex,
              profileId,
              title?.id,
              !!cycleId,
            )
      const current = () =>
        currentViewer() && (!title || titleAllowedCached(profileId, title.id))
      if (
        !current()
        || !sourceAccessible()
        || (cycleId
          && viewingRef
          && !playableCycle(viewingRef, cycleId, revisionAtStart))
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }
      const cycleCursorAtStart
        = cycleId && viewingRef ? getCycleCursor(viewingRef, cycleId) : undefined
      const progress
        = !cycleId && preferenceOwner
          ? getTitleProgress(preferenceOwner)
          : undefined
      // Озвучка прошлой раздачи при её смене, иначе серии (выбранная в
      // источниках или в плеере), иначе последних серий сезона, иначе
      // закреплённая за сезоном
      const lastVoice
        = title && !cycleId
          ? lastVoiceOfSeason(request.profileId, title.id, title.season ?? 0)
          : undefined
      const studio
        = voiceStudio
          ?? progress?.voiceStudio
          ?? cycleCursorAtStart?.voiceStudio
          ?? (lastVoice && 'studio' in lastVoice ? lastVoice.studio : undefined)
          ?? (title
            ? getPinnedVoice(title.id, title.season ?? 0)?.studio
            : undefined)

      const saved = preferenceOwner
        ? getPlaybackPreferences(
            preferenceOwner.profileId,
            preferenceOwner.titleId,
          )
        : undefined
      const audio = !cycleId ? saved?.audio : undefined
      const session = createSession({
        diagnosticContext: {
          ...diagnosticContext(request),
          titleId: title?.id,
          season: title?.season,
          episode: title?.episode,
        },
        subject: streamSubjectOf(request)!,
        owner: !!request.userId && !request.deviceId,
        progressRef: preferenceOwner,
        launchSelection:
          !cycleId
          && initialOwner
          && preferenceOwner
          && sameTitleRef(initialOwner, preferenceOwner)
            ? initialSelection
            : undefined,
        ...source,
        fileName,
        device,
        client: clientOf(request),
        audioStream,
        subtitle,
        subtitlePreference: saved?.subtitles,
        preference: {
          selected: audio,
          studio: audio ? undefined : studio,
          locale: language ?? getProfile(request.profileId)?.language,
        },
        log: request.log.child({ source: 'playback' }),
      })
      bindSessionProfile(session, profileId)
      await Promise.race([
        session.ready,
        new Promise(resolve => setTimeout(resolve, PROBE_WAIT_MS)),
      ])
      const sourceRevisionCurrent
        = !libraryAtStart
          || !viewingSource
          || (await libraryRevisionMatches(
            libraryAtStart.path,
            libraryAtStart.file.id,
            viewingSource.revision,
          ))

      const sessionStillAccessible = () =>
        current()
        && sessionAccessible(session, profileId)
        && sourceAccessible()
      if (!sessionStillAccessible()) {
        await stopSession(session.id, 'client', diagnosticContext(request))
        return reply.code(404).send({ message: 'Playback not found' })
      }
      if (
        !sourceRevisionCurrent
        || (cycleId
          && viewingRef
          && !playableCycle(viewingRef, cycleId, revisionAtStart))
      ) {
        await stopSession(session.id, 'client', diagnosticContext(request))
        return reply.code(409).send({
          message: 'Viewing attempt conflict',
          kind: 'viewingAttemptConflict',
        })
      }

      let attempt: ReturnType<typeof beginViewing>
      try {
        if (viewing && viewingRef && viewingSource) {
          attempt = getDb().transaction(() => {
            const attempt = beginViewing(
              viewingRef,
              viewing,
              viewingSource.source,
              revisionAtStart,
            )
            if (attempt) {
              bindViewing(
                session.id,
                attempt,
                viewing,
                session.subject,
                viewingSource.revision,
                revisionAtStart,
              )
            }
            return attempt
          })
        }
      }
      catch (error) {
        await stopSession(session.id, 'client', diagnosticContext(request))
        throw error
      }
      if (viewing && !attempt) {
        await stopSession(session.id, 'client', diagnosticContext(request))
        return reply.code(409).send({
          message: 'Viewing attempt conflict',
          kind: 'viewingAttemptConflict',
        })
      }

      const cycleCursor
        = cycleId && viewingRef ? getCycleCursor(viewingRef, cycleId) : undefined
      // Прогресс серии сильнее позиции файла: раздачу могли сменить. Отметка
      // с карточки тоже: отмеченную серию не продолжаем с позиции файла
      const state = cycleId
        ? cycleCursor
        : progress && hasProgress(progress)
          ? progress
          : torrentId
            ? getWatchState(request.profileId, torrentId, fileIndex!)
            : undefined
      // Перезапуск с новой дорожкой продолжает с позиции плеера
      const resume: Resume = {
        duration: state?.duration ?? null,
        startPosition:
          startPosition
          ?? (viewing?.intent === 'restart' ? 0 : undefined)
          ?? (cycleCursor && attempt?.state === 'open'
            ? cycleCursor.position
            : undefined)
          ?? (state ? resumePosition(state.position, state.duration) : null),
      }

      resumes.set(session, resume)
      if (attempt && viewingSource) {
        sessionViewings.add(session)
        if (cycleId)
          sessionCycleSources.set(session, viewingSource.source)
      }
      if (preferenceOwner)
        preferenceOwners.set(session, preferenceOwner)

      // Дорожку выбрали в плеере: запоминаем её озвучку, когда проба покажет,
      // какая это дорожка
      const launch = session.launchSelection
      if (ref && launch && audioStream !== undefined) {
        void session.ready
          .then(() => {
            const track = session.media?.audio.find(
              item => item.index === audioStream,
            )
            const voice = track && voiceOfTrack(track)

            if (
              (voice?.studio || voice?.type)
              && (!session.library || session.playedEvidence)
              && getSession(session.id, session.subject)
              && sessionStillAccessible()
              && (!attempt || isCurrentViewing(attempt, revisionAtStart))
            ) {
              const saved = rememberVoice(
                ref,
                voice,
                source.library
                  ? {
                      mediaFileId: source.library.id,
                      torrentId: null,
                      fileIndex: null,
                    }
                  : {
                      torrentId: source.torrent!.id,
                      fileIndex: source.fileIndex,
                      mediaFileId: null,
                    },
                launch,
              )
              if (saved) {
                session.launchSelection = launchSelectionOf(
                  ref,
                  getTitleProgress(ref),
                )
              }
            }
          })
          .catch(() => {
            // Проба не удалась — запоминать нечего, ошибку покажет сама сессия
          })
      }
      const response = await toPlaybackResponse(session, request, resume)
      if (!response) {
        await stopSession(session.id, 'client', diagnosticContext(request))
        return reply.code(404).send({ message: 'Playback not found' })
      }
      return response
    },
  )

  app.put(
    '/playback/:id/preferences',
    {
      schema: {
        operationId: 'putPlaybackPreferences',
        tags: ['Playback'],
        params: playbackParams,
        body: updatePlaybackPreferences,
        response: {
          200: messageResponse,
          400: messageResponse,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const session = getSession(request.params.id, streamSubjectOf(request))
      const owner = session && preferenceOwners.get(session)
      if (
        !session
        || !playbackSessionAccessible(session, request.profileId)
        || !owner
        || owner.profileId !== request.profileId
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }
      if (session.status !== 'ready' || !session.media) {
        return reply
          .code(409)
          .send({ message: 'Tracks are not available yet' })
      }
      const change: SavedTrackPreferences = {}
      if (request.body.audioStream !== undefined) {
        const track = session.media.audio.find(
          item => item.index === request.body.audioStream,
        )
        if (!track)
          return reply.code(400).send({ message: 'Audio track not found' })
        change.audio = audioPreferenceOf(track)
      }
      const subtitle = request.body.subtitle
      if (subtitle !== undefined) {
        const track
          = session.media.subtitles.find(
            item =>
              `s${item.index}` === subtitle && (item.text || item.image),
          )
          ?? session.external.find(item => `f${item.fileIndex}` === subtitle)
          ?? session.downloadedSubtitles.find(
            item => downloadedSubtitleId(item) === subtitle,
          )
        if (subtitle !== null && !track)
          return reply.code(400).send({ message: 'Subtitle track not found' })
        if (
          subtitle?.startsWith('m')
          && (!(await currentSubtitleKey(session, subtitle))
            || !viewerStillOnProfile(request, owner.profileId)
            || !playbackSessionAccessible(session, owner.profileId)
            || getSession(session.id, streamSubjectOf(request)) !== session)
        ) {
          return reply.code(404).send({ message: 'Playback not found' })
        }
        change.subtitles = {
          enabled: subtitle !== null,
          language: trackLanguage(track?.language ?? null),
          forced: track?.forced ?? false,
        }
      }
      getDb().transaction(() => {
        const attempt = liveViewingAttempt(session.id)
        if (attempt) {
          if (!isCurrentViewing(attempt, attempt.cycleLifecycleRevision))
            return
          const cycleSource = sessionCycleSources.get(session)
          if (attempt.cycleKey && cycleSource) {
            if (change.subtitles) {
              savePlaybackPreferences(owner.profileId, owner.titleId, {
                subtitles: change.subtitles,
              })
            }
            if (
              request.body.audioStream !== undefined
              && session.decision.audioSwitch === 'platform'
            ) {
              const track = session.media!.audio.find(
                item => item.index === request.body.audioStream,
              )!
              saveCycleCursor(attempt, attempt.cycleKey, {
                source: cycleSource,
                voice: voiceOfTrack(track) ?? null,
              })
            }
            return
          }
        }
        savePlaybackPreferences(owner.profileId, owner.titleId, change)
        if (request.body.audioStream !== undefined) {
          if (
            session.decision.mode === 'direct'
            && session.decision.audioSwitch === 'platform'
          ) {
            const track = session.media!.audio.find(
              item => item.index === request.body.audioStream,
            )!
            rememberVoice(
              owner,
              voiceOfTrack(track) ?? {},
              session.library
                ? {
                    mediaFileId: session.library.id,
                    torrentId: null,
                    fileIndex: null,
                  }
                : {
                    torrentId: session.torrent!.id,
                    fileIndex: session.fileIndex,
                    mediaFileId: null,
                  },
            )
          }
          else {
            rememberVoiceIntent(owner)
          }
        }
      })
      return { message: 'Playback preferences saved' }
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

      if (!session || !playbackSessionAccessible(session, request.profileId))
        return reply.code(404).send({ message: 'Playback not found' })

      // Статус — пульс плеера: пока он идёт, раздача считается используемой,
      // даже если плеер на паузе и потоков не открывает
      if (session.torrent)
        touchTorrent(session.torrent.id)

      const response = await toPlaybackResponse(
        session,
        request,
        resumes.get(session) ?? { duration: null, startPosition: null },
      )
      return (
        response ?? reply.code(404).send({ message: 'Playback not found' })
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

      await stopSession(session.id, 'client', diagnosticContext(request))
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

      if (!session || !sessionAccessible(session, request.profileId))
        return reply.code(404).send({ message: 'Playback not found' })

      const { error, mediaError, detail, position } = request.body
      // Битые куски раздачи — частая причина ошибки медиа при прямом потоке
      const badPieces = session.torrent
        ? await torrentStats(session.torrent.infoHash).then(
            stats => stats.badPieces,
            () => undefined,
          )
        : undefined

      session.log.warn(
        `playback ${session.id}: player error ${error}${
          mediaError ? `, mediaError=${mediaError}` : ''
        }${detail ? `, detail="${oneLine(detail)}"` : ''}${
          position !== undefined ? `, at=${Math.round(position)}s` : ''
        }${badPieces !== undefined ? `, badPieces=${badPieces}` : ''}`,
      )

      return { message: 'Error logged' }
    },
  )

  app.post(
    '/playback/:id/subtitles/search',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'postPlaybackSubtitleSearch',
        tags: ['Playback'],
        params: playbackParams,
        body: subtitleSearchInput,
        response: { 200: subtitleSearchResponse, ...subtitleActionErrors },
      },
    },
    async (request, reply) => {
      const context = subtitleActionContext(request, request.params.id)
      if (!context)
        return reply.code(404).send({ message: 'Playback not found' })
      try {
        return await searchPlaybackSubtitles(
          context.session,
          context.viewer,
          request.body.language,
        )
      }
      catch (error) {
        if (!(error instanceof SubtitlePlaybackError))
          throw error
        return reply.code(error.status).send({ message: error.message })
      }
    },
  )

  app.post(
    '/playback/:id/subtitles/apply',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'postPlaybackSubtitleApply',
        tags: ['Playback'],
        params: playbackParams,
        body: subtitleApplyInput,
        response: { 200: subtitleTrack, ...subtitleActionErrors },
      },
    },
    async (request, reply) => {
      const context = subtitleActionContext(request, request.params.id)
      if (!context)
        return reply.code(404).send({ message: 'Playback not found' })
      try {
        return await applyPlaybackSubtitle(
          context.session,
          context.viewer,
          request.body.resultId,
        )
      }
      catch (error) {
        if (!(error instanceof SubtitlePlaybackError))
          throw error
        return reply.code(error.status).send({ message: error.message })
      }
    },
  )

  app.delete(
    '/playback/:id/subtitles/:trackId',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'deletePlaybackSubtitle',
        tags: ['Playback'],
        params: subtitleParams,
        response: { 204: z.void(), ...subtitleActionErrors },
      },
    },
    async (request, reply) => {
      const context = subtitleActionContext(request, request.params.id)
      if (!context || !context.viewer.owner)
        return reply.code(404).send({ message: 'Playback not found' })
      try {
        await removePlaybackSubtitle(
          context.session,
          context.viewer,
          request.params.trackId,
        )
        return reply.code(204).send()
      }
      catch (error) {
        if (!(error instanceof SubtitlePlaybackError))
          throw error
        return reply.code(error.status).send({ message: error.message })
      }
    },
  )

  app.put(
    '/playback/:id/subtitles/:trackId/offset',
    {
      onRequest: requireSameOrigin,
      schema: {
        operationId: 'putPlaybackSubtitleOffset',
        tags: ['Playback'],
        params: subtitleParams,
        body: subtitleOffset,
        response: {
          200: subtitleOffset,
          403: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const subject = streamSubjectOf(request)
      const { profileId } = request
      const session = getSession(request.params.id, subject)
      if (!session || !playbackSessionAccessible(session, profileId))
        return reply.code(404).send({ message: 'Playback not found' })

      const target = await currentSubtitleKey(session, request.params.trackId)
      if (
        !target
        || getSession(session.id, subject) !== session
        || !viewerStillOnProfile(request, profileId)
        || !playbackSessionAccessible(session, profileId)
      ) {
        return reply.code(404).send({ message: 'Subtitle track not found' })
      }

      const { offsetMs } = request.body
      saveSubtitleOffset(profileId, target.revision, target.key, offsetMs)
      return { offsetMs }
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
      const subject = streamSubjectOf(request)
      const { profileId } = request
      const session = getSession(request.params.id, subject)
      if (!session || !sessionAccessible(session, profileId))
        return reply.code(404).send({ message: 'Playback not found' })

      const managed = request.params.trackId.startsWith('m')
      const current = () =>
        getSession(session.id, subject) === session
        && viewerStillOnProfile(request, profileId)
        && playbackSessionAccessible(session, profileId)
      if (managed && (!(await currentSubtitleSource(session)) || !current()))
        return reply.code(404).send({ message: 'Playback not found' })

      let result

      try {
        result = await sessionCues(
          session,
          request.params.trackId,
          Number(request.query.from ?? 0),
        )
      }
      catch (err) {
        if (managed && !current())
          return reply.code(404).send({ message: 'Playback not found' })

        session.log.warn(
          `playback ${session.id}: subtitles ${request.params.trackId}: ${(err as Error).message}`,
        )
        return reply.code(502).send({ message: 'Subtitles are not available' })
      }

      if (managed && (!(await currentSubtitleSource(session)) || !current()))
        return reply.code(404).send({ message: 'Playback not found' })

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
      // The player can close its session before its final progress write.
      // Its captured profile still prevents a late write after switching viewers.
      if (
        request.body.profileId
        && request.body.profileId !== request.profileId
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }
      const context = diagnosticContext(request)
      const { torrentId, fileIndex, mediaFileId, position, duration }
        = request.body
      const { viewing, sessionId, event } = request.body
      let { title } = request.body
      const torrent = torrentId ? getTorrent(torrentId) : undefined
      const actualFile = mediaFileId ? getMediaFile(mediaFileId) : undefined
      const actualTitleId = mediaFileId
        ? actualFile
        && folderWithLibrary(actualFile.file.folderId)?.library.kind === 'home'
          ? null
          : actualFile?.file.titleId
        : torrent?.titleId
      if (
        !(await titleAllowed(request.profileId, actualTitleId))
        || (title && hasAgeLimit(request.profileId) && title.id !== actualTitleId)
      ) {
        return reply.code(404).send({ message: 'File not found' })
      }
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
      if (library && !title)
        title = linkedPlaybackTitle(library.file)

      const titleRef = title
        ? {
            profileId: request.profileId,
            titleId: title.id,
            season: title.season,
            episode: title.episode,
          }
        : library
          ? {
              profileId: request.profileId,
              titleId: fileProgressId(library.file.id),
            }
          : undefined
      const source = {
        torrentId: torrentId ?? library?.file.torrentId ?? null,
        fileIndex: fileIndex ?? library?.file.fileIndex ?? null,
        mediaFileId: mediaFileId ?? null,
      }
      const checkpoint
        = titleRef
          && validatedCheckpoint(
            request.body.sessionId,
            streamSubjectOf(request),
            titleRef,
            source,
            request.body.appliedAudioStream,
          )
      const preparedSource
        = checkpoint?.evidence ?? (await preparePlayedSource(source))
      const ref = viewing && titleRef ? exactViewingRef(titleRef) : undefined
      if (
        viewing
        && (!ref || !(await titleAllowed(request.profileId, ref.titleId)))
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }

      const boundAttempt
        = viewing && sessionId ? liveViewingAttempt(sessionId) : undefined
      const revision
        = viewing && library
          ? await stat(library.path).catch(() => undefined)
          : undefined
      const sourceRevision = library
        ? revision?.isFile()
          ? libraryProbeKey(library.file.id, revision)
          : undefined
        : torrent
          && JSON.stringify(['torrent', torrent.id, torrent.infoHash, fileIndex])
      const folder
        = boundAttempt?.cycleKey && library
          ? folderWithLibrary(library.file.folderId)
          : undefined
      const cycleSource: CycleSource | undefined = library
        ? folder && {
          kind: 'library',
          folder: folder.folder.path,
          path: library.file.relPath,
        }
        : torrent && {
          kind: 'torrent',
          infoHash: torrent.infoHash,
          fileIndex: fileIndex!,
        }

      if (
        !viewerStillOnProfile(
          request,
          request.body.profileId ?? request.profileId,
        )
      ) {
        return reply.code(404).send({ message: 'Playback not found' })
      }
      if (
        (title && !titleAllowedCached(request.profileId, title.id))
        || (library
          && !libraryFileStillPlayable(library, request.profileId, title?.id))
        || (torrent
          && !torrentFileStillPlayable(
            torrent,
            fileIndex!,
            request.profileId,
            title?.id,
            !!boundAttempt?.cycleKey,
          ))
      ) {
        return reply.code(404).send({ message: 'File not found' })
      }

      return getDb().transaction(() => {
        const binding
          = viewing && ref && sessionId && event && sourceRevision
            ? validateViewing(ref, {
                sessionId,
                subject: streamSubjectOf(request)!,
                clientId: event.clientId,
                playerId: viewing.playerId,
                sourceRevision,
              })
            : undefined
        // A new session with an incomplete envelope must not write legacy progress.
        if (!viewing && sessionId && liveViewingAttempt(sessionId)) {
          return reply.code(404).send({ message: 'Playback not found' })
        }
        const rejected = (reason: 'stale' | 'viewingConflict') => {
          const saved
            = reason === 'viewingConflict'
              ? undefined
              : binding?.attempt.cycleKey
                ? getCycleCursor(binding.attempt, binding.attempt.cycleKey)
                : torrentId
                  ? getWatchState(request.profileId, torrentId, fileIndex!)
                  : titleRef
                    ? getTitleProgress(titleRef)
                    : undefined
          return {
            torrentId: torrentId ?? null,
            fileIndex: fileIndex ?? null,
            mediaFileId: mediaFileId ?? null,
            position: saved?.position ?? 0,
            duration: saved?.duration ?? null,
            updatedAt: (saved?.updatedAt ?? new Date()).toISOString(),
            ...(viewing && { accepted: false, rejection: reason }),
          }
        }
        if (viewing && (!binding || (binding.attempt.cycleKey && !cycleSource)))
          return rejected('viewingConflict')
        if (viewing && binding && viewing.line < binding.binding.line)
          return rejected('stale')
        const resources = [
          ...(torrentId
            ? [JSON.stringify(['torrent', torrentId, fileIndex])]
            : []),
          ...(mediaFileId ? [JSON.stringify(['library', mediaFileId])] : []),
          ...(titleRef
            ? [
                JSON.stringify([
                  'title',
                  titleRef.titleId,
                  titleRef.season ?? 0,
                  titleRef.episode ?? 0,
                ]),
              ]
            : []),
        ]
        const cycleId = binding?.attempt.cycleKey
        const orderedResources = cycleId
          ? [JSON.stringify(['cycle', cycleId])]
          : resources
        if (!acceptWatchEvent(request.profileId, orderedResources, event)) {
          return rejected('stale')
        }
        const now = new Date()
        if (binding && viewing) {
          const completed = applyViewingCheckpoint(
            binding,
            viewing,
            position,
            duration ?? null,
            now,
          )
          if (cycleId && cycleSource) {
            saveCycleCursor(
              binding.attempt,
              cycleId,
              {
                source: cycleSource,
                voice: checkpoint?.voice || undefined,
                position,
                duration: duration ?? null,
                completedAt: completed ? now : undefined,
              },
              now,
            )
            return {
              torrentId: torrentId ?? null,
              fileIndex: fileIndex ?? null,
              mediaFileId: mediaFileId ?? null,
              position,
              duration: duration ?? null,
              updatedAt: now.toISOString(),
              accepted: true,
            }
          }
        }
        if (titleRef) {
          const saved = saveTitleProgress(
            titleRef,
            {
              ...source,
              position,
              duration: duration ?? null,
            },
            context,
            preparedSource,
            checkpoint?.voice,
            checkpoint?.launchSelection,
          )
          if (!viewing && (!library || preparedSource?.contentKey))
            rememberLegacyCompletion(saved)

          if (
            title
            && title.season === undefined
            && isWatched(position, duration ?? null)
          ) {
            clearMovieWatchlist(request.profileId, title.id)
          }
        }
        if (!torrentId) {
          return {
            torrentId: null,
            fileIndex: null,
            mediaFileId: mediaFileId ?? null,
            position,
            duration: duration ?? null,
            updatedAt: new Date().toISOString(),
            ...(viewing && { accepted: true }),
          }
        }

        const saved = saveWatchState(
          {
            profileId: request.profileId,
            torrentId,
            fileIndex: fileIndex!,
            position,
            duration: duration ?? null,
          },
          context,
          !!(title || library),
        )

        return {
          torrentId: saved.torrentId,
          fileIndex: saved.fileIndex,
          mediaFileId: null,
          position: saved.position,
          duration: saved.duration,
          updatedAt: saved.updatedAt.toISOString(),
          ...(viewing && { accepted: true }),
        }
      })
    },
  )
}
