import type { AddonMedia } from '../addons/media.ts'
import { AddonMediaError } from '../addons/media.ts'
import { currentAddon, onAddonChanged } from '../addons/index.ts'
import type { SavedSubtitlePreference } from './trackPreferences.ts'
import { matchesAudio, preferredSubtitle } from './trackPreferences.ts'
import type { DiagnosticContext } from '../diagnostics/index.ts'
import { recordDecision, recordFailure } from '../diagnostics/index.ts'
import type { SkipSegment } from '../segments/model.ts'
import type { PlayedVoice, SourceEvidence } from '../library/playedSource.ts'
import type { LaunchSelection, TitleRef } from '../sources/progress.ts'
import {
  getTitleProgress,
  launchSelectionCurrent,
} from '../sources/progress.ts'
import type {
  PreparedPlayedSource,
  SourceRef,
} from '../sources/playedSource.ts'
import { trackPlayback } from '../segments/activity.ts'
import { readySegments } from '../segments/index.ts'
import { open, readdir, rm, stat } from 'node:fs/promises'
import { acquireMaintenanceLease } from '../libraryMaintenance/admission.ts'
import {
  libraryContentKey,
  libraryProbeKey,
  libraryRevisionMatches,
} from '../library/playedSource.ts'
import type { DownloadedSubtitle, Torrent } from '../../db/schema.ts'
import type {
  AudioPreference,
  DeviceProfile,
  PlaybackDecision,
} from './decide.ts'
import type { HlsLog } from './hls.ts'
import type { MediaInfo } from './probe.ts'
import type { ExternalSubtitle } from './subtitles.ts'
import type { Cue } from './webvtt.ts'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { config } from '../../config.ts'
import { EngineError, engineStreamUrl } from '../engine/index.ts'
import { trackStream } from '../storage/index.ts'
import {
  addonSubtitleTrack,
  clearAddonSubtitleTracks,
  copyAddonSubtitleTracks,
} from '../subtitles/addons.ts'
import {
  rememberVideoSize,
  streamWindowOf,
  touchTorrent,
} from '../torrents/index.ts'
import { encoderCapsOf, mediaAccel } from './accel.ts'
import {
  decidePlayback,
  pickAudioStream,
  textSubtitles,
  voiceOfTrack,
} from './decide.ts'
import { describePlan, planEncode } from './encode.ts'
import {
  encodeSegmentStarts,
  hasDenseCues,
  HlsTranscode,
  segmentStarts,
} from './hls.ts'
import { readSubtitleIndex } from './matroska.ts'
import { loadAddonCues, loadLibraryCues, loadTorrentCues } from './cueCache.ts'
import { mergeCues } from './webvtt.ts'
import { hlsTiming, isMatroska, probeMedia } from './probe.ts'
import {
  findExternalSubtitles,
  librarySubtitles,
  loadExternalSubtitle,
  loadSubtitleFile,
} from './subtitles.ts'
import { mediaTools } from './tools.ts'
import {
  downloadedSubtitleId,
  downloadedSubtitleRevision,
  downloadedSubtitlesOf,
  loadDownloadedSubtitle,
  ownedManagedSubtitleNames,
  touchDownloadedSubtitle,
} from './downloadedSubtitles.ts'

/** Файл библиотеки: играется с диска, без движка */
export interface LibrarySource {
  /** `media_files.id` */
  id: string
  path: string
  size: number
  origin?: Pick<SourceRef, 'torrentId' | 'fileIndex'>
  storedEvidence?: { probeKey: string, video?: SourceEvidence['video'] }
}

export interface PlaybackSession {
  diagnosticContext?: DiagnosticContext
  id: string
  /** Чей поток: устройство или владелец, как у токена потока */
  subject: string
  progressRef?: TitleRef
  launchSelection?: LaunchSelection
  playedEvidence?: { probeKey: string, source: SourceEvidence }
  /** Источник — файл раздачи (`torrent` + `fileIndex`) или файл библиотеки */
  torrent: Torrent | null
  library: LibrarySource | null
  addonMedia?: AddonMedia
  addonMediaFailed?: boolean
  addonSubtitles?: boolean
  fileIndex: number
  fileName: string
  status: 'probing' | 'ready'
  skipSegments?: SkipSegment[]
  media: MediaInfo | null
  external: ExternalSubtitle[]
  downloadedSubtitles: DownloadedSubtitle[]
  subtitleKeys: Map<string, string>
  audioStream: number | null
  subtitle: string | null
  preferenceMismatch?: ('audio' | 'subtitles')[]
  decision: PlaybackDecision
  hls: HlsTranscode | null
  /** Ожидание пробы: ответ `POST /playback` ждёт его недолго */
  ready: Promise<void>
  /** Записи сессии несут её id и раздачу полями: поиск журнала по ним собирает весь случай */
  log: SessionLog
  startedAt: number
  touchedAt: number
}

export interface SessionLog extends HlsLog {
  info: {
    (message: string): void
    (fields: Record<string, string | number | boolean>, message: string): void
  }
  child: (bindings: Record<string, string | number>) => SessionLog
}

export interface SessionInput {
  diagnosticContext?: DiagnosticContext
  subject: string
  owner?: boolean
  progressRef?: TitleRef
  launchSelection?: LaunchSelection
  torrent?: Torrent
  library?: LibrarySource
  addonMedia?: AddonMedia
  previousAddonSession?: PlaybackSession
  addonSubtitles?: boolean
  fileIndex: number
  fileName: string
  device?: DeviceProfile
  /** Кто смотрит — в журнал: устройство или панель */
  client?: string
  preference: AudioPreference
  audioStream?: number
  subtitle?: string | null
  subtitlePreference?: SavedSubtitlePreference | null
  log: SessionLog
}

// Плеер ходит в сессию постоянно (сегменты, субтитры, статус); тишина —
// плеер закрыли, не позвав `DELETE`
const IDLE_MS = 2 * 60 * 1000
const SWEEP_MS = 30 * 1000
const EXTERNAL_CACHE_SIZE = 50
const subtitleIndexes = new WeakMap<
  PlaybackSession,
  ReturnType<typeof readSubtitleIndex>
>()
// Перезапуск движка обрывает пробу на полпути: повтор берёт новый адрес
const PROBE_RETRIES = 2
const PROBE_RETRY_MS = 3000

/** Пауза перед повтором пробы: тесты подменяют её через `vi.spyOn` */
export const probeDeps = {
  pause: (signal: AbortSignal) => sleep(PROBE_RETRY_MS, undefined, { signal }),
}

const sessions = new Map<string, PlaybackSession>()
const CLOSED_CHECKPOINT_TTL_MS = 2 * 60 * 1000
const CLOSED_CHECKPOINT_LIMIT = 256
const closedCheckpoints = new Map<
  string,
  { expiresAt: number, context: CheckpointContext }
>()
const CHECKPOINT_OWNERS_LIMIT = 512
const addonCheckpoints = new Map<string, { current?: string, order: number }>()
let playbackOrder = 0

export function nextPlaybackOrder() {
  return ++playbackOrder
}

function checkpointKey(ref: TitleRef) {
  return JSON.stringify([
    ref.profileId,
    ref.titleId,
    ref.season ?? 0,
    ref.episode ?? 0,
  ])
}

export function supersedeAddonCheckpoint(ref: TitleRef, order: number) {
  const key = checkpointKey(ref)
  const entry = addonCheckpoints.get(key)
  if (entry && entry.order < order)
    addonCheckpoints.delete(key)
}

function openAddonCheckpoint(session: PlaybackSession, ref: TitleRef) {
  const key = checkpointKey(ref)
  const previous = addonCheckpoints.get(key)
  const entry = { current: previous?.current, order: nextPlaybackOrder() }
  addonCheckpoints.delete(key)
  addonCheckpoints.set(key, entry)
  if (addonCheckpoints.size > CHECKPOINT_OWNERS_LIMIT)
    addonCheckpoints.delete(addonCheckpoints.keys().next().value!)

  void session.ready.then(() => {
    if (addonCheckpoints.get(key) !== entry)
      return
    if (
      isOpen(session)
      && !session.addonMediaFailed
      && session.addonMedia?.accessible
    ) {
      // The outgoing HTTP session can report its final position while this
      // probe is running. Adopt that stamp only while it is still current.
      const prior = entry.current
      const closed = prior ? closedCheckpoints.get(prior) : undefined
      const previousLaunch = prior
        ? (sessions.get(prior)?.launchSelection
          ?? (closed && closed.expiresAt > Date.now()
            ? closed.context.launchSelection
            : undefined))
        : undefined
      if (
        previousLaunch
        && launchSelectionCurrent(ref, previousLaunch, getTitleProgress(ref))
      ) {
        session.launchSelection = previousLaunch
      }
      entry.current = session.id
    }
    if (!entry.current)
      addonCheckpoints.delete(key)
  })
}

export function refreshAddonCheckpoint(
  sessionId: string,
  launch: LaunchSelection,
) {
  const live = sessions.get(sessionId)
  if (live?.addonMedia) {
    live.launchSelection = launch
  }
  else {
    const closed = closedCheckpoints.get(sessionId)
    if (closed?.context.addon)
      closed.context.launchSelection = launch
  }
}

const releases = new Map<string, () => void>()
/** Закрытие сессии обрывает её фоновые чтения потока */
const closers = new Map<string, AbortController>()
const externalCues = new Map<string, Promise<Cue[]>>()
let sweeper: ReturnType<typeof setInterval> | undefined

const DIRECT: PlaybackDecision = {
  mode: 'direct',
  reasons: [],
  video: null,
  audio: null,
  audioSwitch: 'restart',
}

function rangeReader(url: string, signal: AbortSignal) {
  return async (start: number, end: number) => {
    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end - 1}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    })

    if (response.status === 416)
      return new Uint8Array()

    if (!response.ok)
      throw new Error(`Engine stream failed: ${response.status}`)

    return new Uint8Array(await response.arrayBuffer())
  }
}

/** Чтение диапазонов файла библиотеки — для индекса MKV, как поток движка */
function fileRangeReader(path: string) {
  return async (start: number, end: number) => {
    const handle = await open(path, 'r')

    try {
      const buffer = new Uint8Array(Math.max(0, end - start))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)

      return buffer.subarray(0, bytesRead)
    }
    finally {
      await handle.close()
    }
  }
}

function fileSizeOf(session: PlaybackSession) {
  return (
    session.addonMedia?.size
    ?? session.library?.size
    ?? session.torrent?.files?.[session.fileIndex]?.size
    ?? 0
  )
}

/**
 * Окно просмотра для прямого потока файла: по длительности из пробы открытой
 * сессии этого файла, без неё — окно по умолчанию.
 */
export function streamWindowFor(torrent: Torrent, fileIndex: number) {
  let duration: number | null = null

  for (const session of sessions.values()) {
    if (
      session.torrent?.id === torrent.id
      && session.fileIndex === fileIndex
      && session.media?.duration
    ) {
      duration = session.media.duration
      break
    }
  }

  return streamWindowOf(torrent.files?.[fileIndex]?.size ?? 0, duration)
}

// Сессию могли закрыть, пока шла проба: дальше готовить её незачем
function isOpen(session: PlaybackSession) {
  return sessions.get(session.id) === session
}

interface CheckpointContext {
  subject: string
  ref: TitleRef
  source: SourceRef
  launchSelection?: LaunchSelection
  evidence: PreparedPlayedSource
  hlsAudioStream: number | null | undefined
  voices: { index: number, voice: PlayedVoice }[]
  addon?: { id: string, revision: string }
}

function checkpointContext(
  session: PlaybackSession,
): CheckpointContext | undefined {
  if (
    session.status !== 'ready'
    || !session.progressRef
    || session.addonMediaFailed
  ) {
    return
  }
  const source = {
    torrentId:
      session.torrent?.id ?? session.library?.origin?.torrentId ?? null,
    fileIndex: session.torrent
      ? session.fileIndex
      : (session.library?.origin?.fileIndex ?? null),
    mediaFileId: session.library?.id ?? null,
    ...(session.addonMedia && { lastSourceKind: 'addonHttp' as const }),
  }
  const audio
    = !session.library || session.playedEvidence
      ? session.media?.audio
      : undefined
  return {
    subject: session.subject,
    ref: session.progressRef,
    launchSelection: session.launchSelection,
    source,
    addon: session.addonMedia && {
      id: session.addonMedia.launch.addon.id,
      revision: session.addonMedia.launch.addon.revision,
    },
    evidence: { ...session.playedEvidence?.source, ref: source },
    hlsAudioStream: session.hls?.audioStream,
    voices:
      audio?.map((track) => {
        const voice = voiceOfTrack(track)
        return {
          index: track.index,
          voice:
            voice?.studio || voice?.type
              ? { studio: voice.studio, type: voice.type }
              : null,
        }
      }) ?? [],
  }
}

/** Closed sessions retain only the context needed to accept a final checkpoint. */
export function validatedCheckpoint(
  sessionId: string | undefined,
  subject: string | undefined,
  ref: TitleRef,
  source: SourceRef,
  appliedAudioStream?: number | null,
) {
  if (!sessionId || !subject)
    return
  const live = sessions.get(sessionId)
  const closed = closedCheckpoints.get(sessionId)
  const context = live
    ? checkpointContext(live)
    : closed && closed.expiresAt > Date.now()
      ? closed.context
      : undefined
  if (
    !context
    || context.subject !== subject
    || (context.source.lastSourceKind ?? null)
    !== (source.lastSourceKind ?? null)
    || (context.addon
      && (addonCheckpoints.get(checkpointKey(ref))?.current !== sessionId
        || !currentAddon(context.addon.id, context.addon.revision, 'stream')))
      || context.ref.profileId !== ref.profileId
      || context.ref.titleId !== ref.titleId
      || (context.ref.season ?? 0) !== (ref.season ?? 0)
      || (context.ref.episode ?? 0) !== (ref.episode ?? 0)
  ) {
    return
  }
  const expected = context.source
  const sourceChanged = expected.mediaFileId
    ? expected.mediaFileId !== source.mediaFileId
    : !!source.mediaFileId
      || expected.torrentId !== source.torrentId
      || expected.fileIndex !== source.fileIndex
  if (sourceChanged)
    return

  const actual
    = context.hlsAudioStream === undefined
      ? appliedAudioStream
      : context.hlsAudioStream
  return {
    voice:
      context.voices.find(track => track.index === actual)?.voice ?? null,
    launchSelection: context.launchSelection,
    evidence: context.evidence,
  }
}

/**
 * Сбой движка или сети, а не файла: ffprobe упал на чтении потока или движок
 * недоступен. Таймаут пробы не повторяем — куски не пришли за две минуты, а
 * не-медиа файл не прочитается и со второго раза.
 */
function isRetryableProbeError(err: unknown) {
  if (err instanceof EngineError)
    return err.kind === 'unavailable' || err.kind === 'timeout'

  const failure = err as NodeJS.ErrnoException & {
    killed?: boolean
    signal?: NodeJS.Signals | null
  }

  if (failure.code === 'ECONNRESET' || failure.code === 'ECONNREFUSED')
    return true

  if (failure.killed)
    return false

  return (
    (typeof failure.code === 'number' || !!failure.signal)
    && !/Invalid data found/i.test(failure.message)
  )
}

async function prepare(
  session: PlaybackSession,
  input: SessionInput,
  signal: AbortSignal,
) {
  const { torrent, library, addonMedia, fileIndex, device } = input
  if (addonMedia) {
    await addonMedia.prepare(signal, input.previousAddonSession?.addonMedia)
    if (!isOpen(session))
      return
  }
  const mediaInput = (window?: ReturnType<typeof streamWindowOf>) =>
    addonMedia
      ? addonMedia.url
      : (library?.path
        ?? engineStreamUrl(torrent!.infoHash, fileIndex, window))
  const libraryStat = library ? await stat(library.path) : undefined
  const probeKey = addonMedia
    ? `addon:${addonMedia.revision}`
    : library
      ? libraryProbeKey(library.id, libraryStat!)
      : `${torrent!.infoHash}:${fileIndex}`
  const confirmRevision = library
    ? () => libraryRevisionMatches(library.path, library.id, probeKey)
    : undefined
  const evidence: SourceEvidence = library
    ? {
        path: library.path,
        contentKey: libraryContentKey(libraryStat!),
        video:
          library.storedEvidence?.probeKey === probeKey
            ? library.storedEvidence.video
            : undefined,
      }
    : addonMedia
      ? {}
      : { path: session.fileName, contentKey: `torrent:${probeKey}` }
  session.playedEvidence = { probeKey, source: evidence }
  if (library)
    session.skipSegments = await readySegments(library.id)
  const { log } = session
  const tools = await mediaTools()

  if (!isOpen(session))
    return

  if (library) {
    const names = await readdir(dirname(library.path)).catch(() => [])

    const owned = ownedManagedSubtitleNames(library.id)
    session.external = librarySubtitles(basename(library.path), names).filter(
      track => !owned.has(track.path),
    )
  }
  else if (torrent) {
    session.external = findExternalSubtitles(torrent.files ?? [], fileIndex)
  }

  if (tools.status !== 'ok') {
    if (addonMedia)
      throw new AddonMediaError()
    session.decision = { ...DIRECT, reasons: ['ToolsMissing'] }
    return
  }

  const prepareStatsCues = () => {
    if (torrent && /\.(?:mkv|webm)$/i.test(session.fileName))
      void loadTorrentCues(torrent, fileIndex, signal)
  }
  if (!device)
    prepareStatsCues()

  for (let attempt = 0; ; attempt++) {
    try {
      const media = await probeMedia(
        probeKey,
        mediaInput(),
        addonMedia ? `video.${addonMedia.container}` : session.fileName,
        confirmRevision,
        addonMedia && AbortSignal.any([signal, addonMedia.signal]),
      )
      if (addonMedia) {
        if (media.container !== addonMedia.container || !media.video)
          throw new AddonMediaError()
        for (const track of [...media.audio, ...media.subtitles]) {
          track.title = addonMedia.safeText(track.title)
          track.language = addonMedia.safeText(track.language)
        }
      }
      session.media = media
      const video = session.media.video
      if (video)
        evidence.video = { width: video.width, height: video.height }
      break
    }
    catch (err) {
      if (addonMedia)
        throw new AddonMediaError()
      const message = (err as Error).message

      if (attempt >= PROBE_RETRIES || !isRetryableProbeError(err)) {
        log.warn(`playback ${session.id}: probe failed: ${message}`)
        session.decision = { ...DIRECT, reasons: ['ProbeFailed'] }
        return
      }

      log.warn(`playback ${session.id}: probe failed, retrying: ${message}`)

      try {
        await probeDeps.pause(signal)
      }
      catch {
        return
      }

      if (!isOpen(session))
        return
    }
  }

  if (!isOpen(session))
    return

  const media = session.media
  if (
    addonMedia
    && input.previousAddonSession
    && isOpen(input.previousAddonSession)
  ) {
    copyAddonSubtitleTracks(session, input.previousAddonSession)
  }
  session.downloadedSubtitles = addonMedia
    ? []
    : await downloadedSubtitlesOf(probeKey, input.owner === true)
  for (const track of media.subtitles) {
    if (track.text && !track.image) {
      const id = `s${track.index}`
      session.subtitleKeys.set(id, id)
    }
  }
  const externalKeys = await Promise.all(
    session.external.map(async (track) => {
      const id = `f${track.fileIndex}`
      return [id, await externalSubtitleKey(session, track)] as const
    }),
  )
  if (!isOpen(session))
    return
  for (const [id, key] of externalKeys) {
    if (key)
      session.subtitleKeys.set(id, key)
  }
  for (const track of session.downloadedSubtitles) {
    const id = downloadedSubtitleId(track)
    session.subtitleKeys.set(id, id)
  }

  if (torrent && media.video?.width && media.video.height)
    rememberVideoSize(torrent, media.video.width, media.video.height)

  const requested = media.audio.find(
    track => track.index === input.audioStream,
  )

  session.audioStream
    = requested?.index ?? pickAudioStream(media, input.preference)

  const subtitle
    = input.subtitle !== undefined
      ? input.subtitle
      : (input.previousAddonSession?.subtitle?.startsWith('a')
        && addonSubtitleTrack(session, input.previousAddonSession.subtitle)
          ?.id)
        || preferredSubtitle(
          media,
          session.external,
          input.subtitlePreference,
          session.downloadedSubtitles,
        )
  session.preferenceMismatch = []
  if (
    input.audioStream === undefined
    && input.preference.selected
    && !media.audio.some(
      track =>
        track.index === session.audioStream
        && matchesAudio(track, input.preference.selected!),
    )
  ) {
    session.preferenceMismatch.push('audio')
  }
  if (
    input.audioStream === undefined
    && !input.preference.selected
    && input.preference.studio
    && !media.audio.some(
      track =>
        track.index === session.audioStream
        && voiceOfTrack(track)?.studio?.toLowerCase()
        === input.preference.studio?.toLowerCase(),
    )
  ) {
    session.preferenceMismatch.push('audio')
  }
  if (
    input.subtitle === undefined
    && input.subtitlePreference?.enabled
    && !subtitle
  ) {
    session.preferenceMismatch.push('subtitles')
  }

  const embedded = media.subtitles.find(
    track => track.text && `s${track.index}` === subtitle,
  )
  const burned = media.subtitles.find(
    track => track.image && `s${track.index}` === subtitle,
  )
  const external
    = session.external.some(track => `f${track.fileIndex}` === subtitle)
      || session.downloadedSubtitles.some(
        track => downloadedSubtitleId(track) === subtitle,
      )
      || (subtitle && addonSubtitleTrack(session, subtitle))

  session.subtitle = embedded || burned || external ? subtitle! : null

  if (!device) {
    session.decision = DIRECT
    return
  }

  let timing = hlsTiming(media, session.audioStream)
  let keyframeIndex = true
  const decide = (canEncode: boolean) =>
    decidePlayback({
      media,
      device,
      audioStream: session.audioStream,
      embeddedSubtitle: !!embedded,
      burnSubtitle: !!burned,
      toolsReady: true,
      canEncode,
      keyframeIndex,
    })

  let decision = decide(true)
  let cues: number[] | null = null
  const matroska = isMatroska(media.container)
  const sourceOrigin = media.startTime ?? 0
  let videoStart
    = media.container === 'mp4' ? media.video?.startTime : undefined
  const measureEndpoints
    = decision.mode === 'hls'
      && matroska
      && media.video !== null
      && timing.duration === null
      && media.startTime !== undefined
  const prepareMatroska
    = decision.mode === 'hls'
      && matroska
      && (measureEndpoints
        || (timing.videoEnd !== null
          && segmentStarts(timing.videoEnd, null).length > 1))
  if (prepareMatroska) {
    // Header, index and optional frame/packet evidence share one budget.
    const prepared = addonMedia
      ? await loadAddonCues(
          probeKey,
          addonMedia.size,
          addonMedia.read.bind(addonMedia),
          signal,
          measureEndpoints,
          media.video?.index,
        )
      : library
        ? await loadLibraryCues(
            { ...library, size: libraryStat!.size },
            probeKey,
            signal,
            measureEndpoints,
            media.video?.index,
          )
        : await loadTorrentCues(
            torrent!,
            fileIndex,
            signal,
            measureEndpoints,
            media.video?.index,
          )
    if (!isOpen(session))
      return
    timing = hlsTiming(media, session.audioStream, prepared?.packetEnds)
    cues = prepared?.times.map(time => time - sourceOrigin) ?? null
    if (prepared?.videoStart?.stream === media.video?.index)
      videoStart = prepared?.videoStart?.time
  }
  else {
    prepareStatsCues()
  }

  // VOD requires both a video cut boundary and the duration of selected streams.
  const { videoEnd, duration } = timing
  if (
    decision.mode === 'hls'
    && (!media.video
      || videoEnd === null
      || !duration
      || (!matroska && !media.duration))
  ) {
    if (addonMedia)
      throw new AddonMediaError()
    session.decision = {
      ...decision,
      mode: 'direct',
      reasons: [...decision.reasons, 'DurationUnknown'],
    }
    return
  }

  if (
    decision.mode === 'hls'
    && decision.video === 'copy'
    && videoEnd !== null
  ) {
    const starts = segmentStarts(videoEnd, cues)
    // Reordered video needs seek preroll. Dense Cues cannot safely accommodate
    // the existing half-second bias across FFmpeg versions: encode exact cuts.
    const denseReordered
      = media.video?.videoDelay !== 0 && cues && hasDenseCues(starts, cues)
    if (!cues || cues.length < 2 || denseReordered) {
      // Copy cannot cut at arbitrary timestamps. Without an index, encode the
      // keyframes required by the VOD playlist rather than repeat whole GOPs.
      keyframeIndex
        = !denseReordered && segmentStarts(videoEnd, null).length === 1
      if (!keyframeIndex) {
        log.warn(
          'HLS video keyframe index unavailable; encoding to align segments',
        )
        decision = decide(true)
      }
    }
  }
  // Детект ускорения нужен только перекодированию: прямой поток и копия его не ждут
  const accel
    = decision.video === 'encode'
      ? await mediaAccel().catch((err: Error) => {
          log.warn(
            `playback ${session.id}: acceleration check failed: ${err.message}`,
          )
          return null
        })
      : null

  if (!isOpen(session))
    return

  const { caps, software } = accel
    ? encoderCapsOf(accel)
    : { caps: null, software: null }

  if (decision.video === 'encode' && !caps)
    decision = decide(false)

  if (addonMedia && decision.mode === 'direct' && decision.reasons.length > 0)
    throw new AddonMediaError()

  if (decision.mode === 'hls' && duration && videoEnd !== null && media.video) {
    if (prepareMatroska && library) {
      const current = await stat(library.path).catch(() => null)
      if (!current || libraryProbeKey(library.id, current) !== probeKey) {
        session.decision = {
          ...decision,
          mode: 'direct',
          reasons: [...decision.reasons, 'DurationUnknown'],
        }
        return
      }
    }
    const encode
      = decision.video === 'encode' && caps
        ? planEncode(media.video, caps, burned?.index ?? null, software)
        : null
    const encodeTimeline
      = encode && videoStart !== undefined
        ? {
            videoStart: videoStart - sourceOrigin,
            sourceOrigin,
            mov: media.container === 'mp4',
          }
        : undefined
    const starts
      = encode && encodeTimeline
        ? encodeSegmentStarts(
            videoEnd,
            encodeTimeline.videoStart,
            encode.frameRate,
          )
        : segmentStarts(videoEnd, encode ? null : cues)

    if (!isOpen(session))
      return

    const window = streamWindowOf(fileSizeOf(session), media.duration)

    session.hls = new HlsTranscode(
      join(config.transcodesPath, session.id),
      {
        // Порт движка меняется после его перезапуска: адрес берётся на каждый запуск ffmpeg
        url: () => mediaInput(window),
        privateInput: !!addonMedia,
        videoStream: media.video.index,
        audioStream: session.audioStream,
        audio: decision.audio ?? 'aac',
        subtitleStreams: textSubtitles(media).map(track => track.index),
        starts,
        cues,
        videoDelay: media.video.videoDelay,
        firstVideoTime: cues?.[0],
        duration,
        encode,
        encodeTimeline: starts.length > 1 ? encodeTimeline : undefined,
        session: session.id,
      },
      log,
    )

    if (encode?.hdrUntouched) {
      log.warn(
        `playback ${session.id}: HDR video without tone mapping, colors will look washed out`,
      )
    }
  }

  session.decision = decision
}

function ensureSweeper() {
  if (sweeper)
    return

  sweeper = setInterval(() => {
    const now = Date.now()

    for (const session of sessions.values()) {
      if (now - session.touchedAt > IDLE_MS)
        void stopSession(session.id, 'idle')
    }
  }, SWEEP_MS)
  sweeper.unref()
}

// Раздача — infohash, как в журнале движка: по нему сводятся провалы хэша и
// сессии. Имён файлов в журнале нет
function describeSource(session: PlaybackSession) {
  if (session.addonMedia)
    return 'source=http-addon'
  return session.torrent
    ? `torrent=${session.torrent.infoHash} file=${session.fileIndex}`
    : `library=${session.library!.id}`
}

/** Контейнер, видео и выбранная озвучка: `mkv h264 aac` */
function describeMedia(session: PlaybackSession) {
  const media = session.media!
  const audio = media.audio.find(
    track => track.index === session.audioStream,
  )

  return [
    media.container,
    media.video?.codec ?? 'novideo',
    audio?.codec ?? 'noaudio',
  ].join(' ')
}

/**
 * Что за файл — фактами вместо названия: по ним видно «4K HEVC 60 Мбит/с»
 * или «кусок 16 МБ», а журнал, приложенный к публичному issue, не говорит,
 * что смотрели
 */
function fileFacts(session: PlaybackSession) {
  const video = session.media?.video
  const facts: Record<string, string | number | boolean> = {
    size: fileSizeOf(session),
  }

  if (video?.width && video.height)
    facts.resolution = `${video.width}x${video.height}`
  if (video?.bitrate)
    facts.bitrate = video.bitrate
  if (video?.hdr)
    facts.hdr = true
  if (session.torrent?.pieceLength)
    facts.pieceLength = session.torrent.pieceLength
  if (session.torrent?.files)
    facts.files = session.torrent.files.filter(file => !file.padding).length

  return facts
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours)
    return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
  if (minutes)
    return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  return `${seconds}s`
}

/** Новая сессия: проба и решение идут в фоне, `ready` — их окончание */
const maintenanceReleases = new Map<string, () => void>()

export function createSession(input: SessionInput) {
  const maintenanceRelease = acquireMaintenanceLease({
    torrentId: input.torrent?.id,
    mediaFileId: input.library?.id,
  })
  const releasePlayback = input.torrent
    ? trackStream(input.torrent.id)
    : trackPlayback()
  const id = randomUUID()
  const session: PlaybackSession = {
    id,
    diagnosticContext: input.diagnosticContext,
    subject: input.subject,
    progressRef: input.progressRef,
    launchSelection: input.launchSelection,
    torrent: input.torrent ?? null,
    library: input.library ?? null,
    addonMedia: input.addonMedia,
    addonSubtitles: input.addonSubtitles,
    fileIndex: input.fileIndex,
    fileName: input.fileName,
    status: 'probing',
    media: null,
    external: [],
    downloadedSubtitles: [],
    subtitleKeys: new Map(),
    audioStream: null,
    subtitle: null,
    decision: DIRECT,
    hls: null,
    ready: Promise.resolve(),
    log: input.log.child(
      input.torrent
        ? {
            session: id,
            infoHash: input.torrent.infoHash,
            fileIndex: input.fileIndex,
          }
        : input.library
          ? { session: id, libraryId: input.library.id }
          : { session: id },
    ),
    startedAt: Date.now(),
    touchedAt: Date.now(),
  }

  recordDecision('playback', 'playback.requested', input.diagnosticContext, {
    session: id,
    torrentId: session.torrent?.id,
    fileIndex: session.fileIndex,
    mediaFileId: session.library?.id,
  })
  const closer = new AbortController()

  session.ready = prepare(session, input, closer.signal)
    .catch((err: Error) => {
      recordFailure('playback', 'probe_failed', session.diagnosticContext, {
        session: id,
      })
      if (session.addonMedia) {
        session.addonMediaFailed = true
        session.addonMedia.close()
        session.log.warn(
          `playback ${session.id}: HTTP video preparation failed`,
        )
      }
      else {
        session.log.warn(`playback ${session.id}: ${err.message}`)
      }
      session.decision = { ...DIRECT, reasons: ['ProbeFailed'] }
    })
    .finally(async () => {
      const evidence = session.playedEvidence
      if (
        isOpen(session)
        && session.library
        && evidence
        && !(await libraryRevisionMatches(
          session.library.path,
          session.library.id,
          evidence.probeKey,
        ))
      ) {
        session.playedEvidence = undefined
      }
      session.status = 'ready'

      const { decision } = session
      const encode = session.hls?.encode
      recordDecision(
        'playback',
        'playback.ready',
        session.diagnosticContext,
        {
          session: id,
          torrentId: session.torrent?.id,
          fileIndex: session.fileIndex,
          mediaFileId: session.library?.id,
          mode: decision.mode,
          outcome: sessions.has(id) ? 'ready' : 'stale',
          width: session.media?.video?.width,
          height: session.media?.video?.height,
          elapsedMs: Date.now() - session.startedAt,
        },
        {
          reasons: decision.reasons,
          encode: encode
            ? { width: encode.width, height: encode.height }
            : undefined,
        },
      )

      session.log.info(
        fileFacts(session),
        `playback ${session.id}: ${decision.mode}${
          decision.reasons.length
            ? `, reasons=[${decision.reasons.join(', ')}]`
            : ''
        }${decision.audio ? `, audio=${decision.audio}` : ''}${
          encode ? `, video=encode(${describePlan(encode)})` : ''
        }, ${describeSource(session)}${
          session.media ? `, media=${describeMedia(session)}` : ''
        }${input.client ? `, client=${input.client}` : ''}`,
      )
    })

  maintenanceReleases.set(session.id, maintenanceRelease)
  sessions.set(session.id, session)
  closers.set(session.id, closer)
  // Пока сессия открыта, раздачу не вытесняют и не ставят на паузу — и до
  // конца пробы, и в прямом режиме, где плеер переоткрывает поток при перемотке
  releases.set(session.id, releasePlayback)
  if (session.addonMedia && session.progressRef)
    openAddonCheckpoint(session, session.progressRef)
  ensureSweeper()

  return session
}

/** Сессия этого зрителя; обращение продлевает её */
export function getSession(id: string, subject: string | undefined) {
  const session = sessions.get(id)

  if (!session || session.subject !== subject)
    return undefined

  session.touchedAt = Date.now()
  return session
}

/**
 * Закрыть сессию. `client` — плеер закрыл её сам, `idle` — плеер пропал без
 * `DELETE`, `shutdown` — сервер останавливается
 */
export async function stopSession(
  id: string,
  reason: 'client' | 'idle' | 'shutdown' = 'client',
  context?: DiagnosticContext,
) {
  const session = sessions.get(id)

  if (!session)
    return

  const checkpoint = reason !== 'shutdown' && checkpointContext(session)
  if (checkpoint) {
    const now = Date.now()
    for (const [sessionId, previous] of closedCheckpoints) {
      if (
        previous.expiresAt > now
        && closedCheckpoints.size < CLOSED_CHECKPOINT_LIMIT
      ) {
        break
      }
      closedCheckpoints.delete(sessionId)
    }
    closedCheckpoints.set(id, {
      expiresAt: now + CLOSED_CHECKPOINT_TTL_MS,
      context: checkpoint,
    })
  }
  sessions.delete(id)
  clearAddonSubtitleTracks(session)
  recordDecision(
    'playback',
    'playback.closed',
    context ?? session.diagnosticContext,
    { session: id, reason, elapsedMs: Date.now() - session.startedAt },
  )
  session.log.info(
    `playback ${id}: closed after ${formatDuration(Date.now() - session.startedAt)}, reason=${reason}`,
  )
  // Пробу не отменяем: она общая в кэше для всех сессий этого файла
  closers.get(id)?.abort()
  session.addonMedia?.close()
  closers.delete(id)
  releases.get(id)?.()
  releases.delete(id)
  // Зритель мог выйти ненадолго (следующая серия, пауза): вытеснение
  // отсчитывает недавнее использование от закрытия сессии
  if (session.torrent)
    touchTorrent(session.torrent.id)
  try {
    await session.hls?.stop()
  }
  finally {
    // Закрытие клиента не ждёт общей пробы, но maintenance аренда живёт
    // до закрытия всех её чтений. Это также покрывает abort во время prepare.
    void session.ready.finally(() => {
      maintenanceReleases.get(id)?.()
      maintenanceReleases.delete(id)
    })
  }
}

onAddonChanged((id, revision) => {
  for (const session of sessions.values()) {
    const addon = session.addonMedia?.launch.addon
    if (addon?.id === id && addon.revision === revision)
      void stopSession(session.id, 'shutdown').catch(() => {})
  }
})

export async function stopAllSessions() {
  closedCheckpoints.clear()
  addonCheckpoints.clear()
  await Promise.all(
    [...sessions.keys()].map(id => stopSession(id, 'shutdown')),
  )
}

/** Сегменты прошлого запуска сервера никому не нужны */
export async function cleanTranscodes() {
  await rm(config.transcodesPath, { recursive: true, force: true })
}

async function externalSubtitleKey(
  session: PlaybackSession,
  track: ExternalSubtitle,
) {
  if (!session.library)
    return `f${track.fileIndex}`

  const info = await stat(
    join(dirname(session.library.path), track.path),
  ).catch(() => undefined)
  if (!info?.isFile())
    return undefined

  return JSON.stringify([
    track.path,
    info.dev,
    info.ino,
    info.size,
    info.mtimeMs,
    info.ctimeMs,
  ])
}

export function activeDownloadedSubtitleIds() {
  return new Set(
    [...sessions.values()].flatMap(session =>
      session.downloadedSubtitles.map(track => track.id),
    ),
  )
}

export function attachDownloadedSubtitle(
  session: PlaybackSession,
  track: DownloadedSubtitle,
) {
  const id = downloadedSubtitleId(track)
  session.downloadedSubtitles = [
    ...session.downloadedSubtitles.filter(item => item.id !== track.id),
    track,
  ]
  session.subtitleKeys.set(id, id)
}

export function detachDownloadedSubtitle(track: DownloadedSubtitle) {
  const id = downloadedSubtitleId(track)
  for (const session of sessions.values()) {
    session.downloadedSubtitles = session.downloadedSubtitles.filter(
      item => item.id !== track.id,
    )
    session.subtitleKeys.delete(id)
    if (session.subtitle === id)
      session.subtitle = null
  }
  for (const key of externalCues.keys()) {
    if (key.startsWith(`${id}:`))
      externalCues.delete(key)
  }
}

export function subtitleSessionSignal(session: PlaybackSession) {
  return isOpen(session)
    ? (closers.get(session.id)?.signal ?? AbortSignal.abort())
    : AbortSignal.abort()
}

export async function currentSubtitleSource(session: PlaybackSession) {
  const revision = session.playedEvidence?.probeKey
  if (
    !revision
    || !isOpen(session)
    || (session.addonMedia && !session.addonMedia.accessible)
  ) {
    return undefined
  }
  if (
    session.library
    && !(await libraryRevisionMatches(
      session.library.path,
      session.library.id,
      revision,
    ))
  ) {
    return undefined
  }
  return isOpen(session) ? revision : undefined
}

export async function currentSubtitleKey(
  session: PlaybackSession,
  trackId: string,
) {
  if (session.status !== 'ready')
    return undefined
  if (trackId.startsWith('a')) {
    const revision = await currentSubtitleSource(session)
    return revision && addonSubtitleTrack(session, trackId)
      ? { revision, key: trackId }
      : undefined
  }
  const key = session.subtitleKeys.get(trackId)
  if (!key)
    return undefined

  const downloaded = session.downloadedSubtitles.find(
    track => downloadedSubtitleId(track) === trackId,
  )
  if (downloaded && !(await downloadedSubtitleRevision(downloaded)))
    return undefined

  const sidecar = session.external.find(
    track => `f${track.fileIndex}` === trackId,
  )
  if (sidecar && key !== (await externalSubtitleKey(session, sidecar)))
    return undefined

  const revision = await currentSubtitleSource(session)
  return revision ? { revision, key } : undefined
}

function cachedExternalCues(key: string, load: () => Promise<Cue[]>) {
  const cached = externalCues.get(key)
  if (cached)
    return cached

  const pending = load()
  externalCues.set(key, pending)
  void pending.catch(() => {
    if (externalCues.get(key) === pending)
      externalCues.delete(key)
  })

  if (externalCues.size > EXTERNAL_CACHE_SIZE)
    externalCues.delete(externalCues.keys().next().value!)

  return pending
}

/**
 * Реплики дорожки субтитров. Внешний файл читается целиком один раз,
 * встроенные копит перепаковка по ходу просмотра.
 */
export async function sessionCues(
  session: PlaybackSession,
  trackId: string,
  from = 0,
): Promise<{ cues: Cue[], done: boolean } | undefined> {
  if (trackId.startsWith('a')) {
    if (!(await currentSubtitleSource(session)))
      return
    const track = addonSubtitleTrack(session, trackId)
    return track ? { cues: track.cues, done: true } : undefined
  }
  if (trackId.startsWith('m')) {
    const track = session.downloadedSubtitles.find(
      item => downloadedSubtitleId(item) === trackId,
    )
    if (!track)
      return undefined

    const revision = await downloadedSubtitleRevision(track)
    if (!revision)
      return undefined
    const cues = await cachedExternalCues(`${trackId}:${revision}`, () =>
      loadDownloadedSubtitle(track))
    if (
      revision !== (await downloadedSubtitleRevision(track))
      || !session.downloadedSubtitles.includes(track)
    ) {
      return undefined
    }
    touchDownloadedSubtitle(track)
    return { cues, done: true }
  }

  const index = Number(trackId.slice(1))

  if (trackId.startsWith('f')) {
    const subtitle = session.external.find(
      track => track.fileIndex === index,
    )

    if (!subtitle)
      return undefined

    const { library, torrent } = session
    const revision = await externalSubtitleKey(session, subtitle)
    const expected = session.subtitleKeys.get(trackId)
    if (!revision || (expected && revision !== expected))
      return undefined
    const key = library
      ? `library:${library.id}:${revision}`
      : `${torrent!.infoHash}:${index}`
    const cues = await cachedExternalCues(key, () =>
      library
        ? loadSubtitleFile(join(dirname(library.path), subtitle.path), subtitle)
        : loadExternalSubtitle(
            engineStreamUrl(torrent!.infoHash, index),
            subtitle,
          ))

    if (
      library
      && revision !== (await externalSubtitleKey(session, subtitle))
    ) {
      externalCues.delete(key)
      return undefined
    }

    return { cues, done: true }
  }

  const track = session.media?.subtitles.find(
    item => item.index === index && item.text,
  )

  if (!track)
    return undefined

  let cues = session.hls ? await session.hls.cues(index) : []
  if (
    session.hls
    && session.media?.container === 'mkv'
    && track.codec === 'subrip'
    && from > 0
  ) {
    let pending = subtitleIndexes.get(session)
    try {
      if (!pending) {
        const signal = closers.get(session.id)?.signal
        if (!signal || signal.aborted)
          return { cues, done: true }
        const addonMedia = session.addonMedia
        const read = addonMedia
          ? (start: number, end: number) => addonMedia.read(start, end, signal)
          : session.library
            ? fileRangeReader(session.library.path)
            : (start: number, end: number) =>
                rangeReader(
                  engineStreamUrl(session.torrent!.infoHash, session.fileIndex),
                  signal,
                )(start, end)
        pending = readSubtitleIndex(read)
        subtitleIndexes.set(session, pending)
      }
      const lookup = await pending
      if (lookup) {
        const origin = session.media.startTime ?? 0
        const indexed = await lookup(index, from + origin)
        cues = mergeCues([
          cues,
          indexed.map(cue => ({
            ...cue,
            start: cue.start - origin,
            end: cue.end - origin,
          })),
        ])
      }
    }
    catch {
      // Индекс лишь дополняет ffmpeg: сбой не должен скрывать готовые реплики.
      // Не повторяем повреждённое/недоступное чтение на каждом опросе.
      if (subtitleIndexes.get(session) === pending) {
        subtitleIndexes.set(session, Promise.resolve(null))
        session.log.warn('Subtitle index unavailable; using extracted cues')
      }
    }
  }
  return {
    cues,
    done: !session.hls,
  }
}

export function addonSessionCount() {
  let count = 0
  for (const session of sessions.values()) {
    if (session.addonMedia)
      count++
  }
  return count
}

/** Только для тестов */
export function sessionCount() {
  return sessions.size
}

/** Read-only activity snapshot for maintenance; includes probing and paused players. */
export function playbackResources() {
  return [...sessions.values()].map(session => ({
    torrentId: session.torrent?.id ?? null,
    mediaFileId: session.library?.id ?? null,
  }))
}

/** Diagnostic binding does not touch/extend a playback session or expose its data. */
export function diagnosticSessionState(
  id: string,
  subject: string,
): 'owned' | 'foreign' | 'closed' {
  const session = sessions.get(id)
  return session
    ? session.subject === subject
      ? 'owned'
      : 'foreign'
    : 'closed'
}
