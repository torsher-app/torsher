import type { Torrent } from '../../db/schema.ts'
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
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../../config.ts'
import { engineStreamUrl } from '../engine/index.ts'
import { trackStream } from '../storage/index.ts'
import { decidePlayback, pickAudioStream, textSubtitles } from './decide.ts'
import { HlsTranscode, segmentStarts } from './hls.ts'
import { readCueTimes } from './matroska.ts'
import { probeMedia } from './probe.ts'
import { findExternalSubtitles, loadExternalSubtitle } from './subtitles.ts'
import { mediaTools } from './tools.ts'

export interface PlaybackSession {
  id: string
  /** Чей поток: устройство или владелец, как у токена потока */
  subject: string
  torrent: Torrent
  fileIndex: number
  fileName: string
  status: 'probing' | 'ready'
  media: MediaInfo | null
  external: ExternalSubtitle[]
  audioStream: number | null
  subtitle: string | null
  decision: PlaybackDecision
  hls: HlsTranscode | null
  /** Ожидание пробы: ответ `POST /playback` ждёт его недолго */
  ready: Promise<void>
  touchedAt: number
}

export interface SessionInput {
  subject: string
  torrent: Torrent
  fileIndex: number
  fileName: string
  device?: DeviceProfile
  preference: AudioPreference
  audioStream?: number
  subtitle?: string
  log: HlsLog
}

// Плеер ходит в сессию постоянно (сегменты, субтитры, статус); тишина —
// плеер закрыли, не позвав `DELETE`
const IDLE_MS = 2 * 60 * 1000
const SWEEP_MS = 30 * 1000
const EXTERNAL_CACHE_SIZE = 50

const sessions = new Map<string, PlaybackSession>()
const releases = new Map<string, () => void>()
const externalCues = new Map<string, Promise<Cue[]>>()
let sweeper: ReturnType<typeof setInterval> | undefined

const DIRECT: PlaybackDecision = {
  mode: 'direct',
  reasons: [],
  audio: null,
  audioSwitch: 'restart',
}

function rangeReader(url: string) {
  return async (start: number, end: number) => {
    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end - 1}` },
      signal: AbortSignal.timeout(120_000),
    })

    if (response.status === 416)
      return new Uint8Array()

    if (!response.ok)
      throw new Error(`Engine stream failed: ${response.status}`)

    return new Uint8Array(await response.arrayBuffer())
  }
}

async function prepare(session: PlaybackSession, input: SessionInput) {
  const { torrent, fileIndex, device, log } = input
  const tools = await mediaTools()
  const url = engineStreamUrl(torrent.infoHash, fileIndex)

  session.external = findExternalSubtitles(torrent.files ?? [], fileIndex)

  if (tools.status !== 'ok') {
    session.decision = { ...DIRECT, reasons: ['ToolsMissing'] }
    return
  }

  // Индекс MKV читаем вместе с пробой, а не после: он нужен перепаковке, а у
  // холодной раздачи это ещё одно ожидание кусков — с конца файла
  const earlyCues
    = device && /\.mkv$/i.test(session.fileName)
      ? readCueTimes(rangeReader(url)).catch(() => null)
      : undefined

  try {
    session.media = await probeMedia(
      `${torrent.infoHash}:${fileIndex}`,
      url,
      session.fileName,
    )
  }
  catch (err) {
    log.warn(`playback ${session.id}: probe failed: ${(err as Error).message}`)
    session.decision = { ...DIRECT, reasons: ['ProbeFailed'] }
    return
  }

  const media = session.media
  const requested = media.audio.find(
    track => track.index === input.audioStream,
  )

  session.audioStream
    = requested?.index ?? pickAudioStream(media, input.preference)

  const embedded = media.subtitles.find(
    track => track.text && `s${track.index}` === input.subtitle,
  )
  const external = session.external.find(
    track => `f${track.fileIndex}` === input.subtitle,
  )

  session.subtitle = embedded || external ? input.subtitle! : null

  if (!device) {
    session.decision = DIRECT
    return
  }

  let decision = decidePlayback({
    media,
    device,
    audioStream: session.audioStream,
    embeddedSubtitle: !!embedded,
    toolsReady: true,
  })

  // Плейлист HLS строится заранее: без длительности и видео его нет
  if (decision.mode === 'hls' && (!media.duration || !media.video)) {
    decision = {
      ...decision,
      mode: 'direct',
      reasons: [...decision.reasons, 'DurationUnknown'],
    }
  }

  if (decision.mode === 'hls' && media.duration && media.video) {
    const cues
      = media.container === 'mkv'
        ? await (earlyCues ?? readCueTimes(rangeReader(url)).catch(() => null))
        : null

    session.hls = new HlsTranscode(
      join(config.transcodesPath, session.id),
      {
        url,
        videoStream: media.video.index,
        audioStream: session.audioStream,
        audio: decision.audio ?? 'aac',
        subtitleStreams: textSubtitles(media).map(track => track.index),
        starts: segmentStarts(media.duration, cues),
        duration: media.duration,
      },
      log,
    )
    // Пока идёт перепаковка, раздачу не вытесняют и не ставят на паузу
    releases.set(session.id, trackStream(torrent.id))
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
        void stopSession(session.id)
    }
  }, SWEEP_MS)
  sweeper.unref()
}

/** Новая сессия: проба и решение идут в фоне, `ready` — их окончание */
export function createSession(input: SessionInput) {
  const session: PlaybackSession = {
    id: randomUUID(),
    subject: input.subject,
    torrent: input.torrent,
    fileIndex: input.fileIndex,
    fileName: input.fileName,
    status: 'probing',
    media: null,
    external: [],
    audioStream: null,
    subtitle: null,
    decision: DIRECT,
    hls: null,
    ready: Promise.resolve(),
    touchedAt: Date.now(),
  }

  session.ready = prepare(session, input)
    .catch((err: Error) => {
      input.log.warn(`playback ${session.id}: ${err.message}`)
      session.decision = { ...DIRECT, reasons: ['ProbeFailed'] }
    })
    .finally(() => {
      session.status = 'ready'

      const { decision } = session

      input.log.info(
        `playback ${session.id}: ${decision.mode}${
          decision.reasons.length
            ? `, reasons=[${decision.reasons.join(', ')}]`
            : ''
        }${decision.audio ? `, audio=${decision.audio}` : ''}`,
      )
    })

  sessions.set(session.id, session)
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

export async function stopSession(id: string) {
  const session = sessions.get(id)

  if (!session)
    return

  sessions.delete(id)
  releases.get(id)?.()
  releases.delete(id)
  await session.hls?.stop()
}

export async function stopAllSessions() {
  await Promise.all([...sessions.keys()].map(stopSession))
}

/** Сегменты прошлого запуска сервера никому не нужны */
export async function cleanTranscodes() {
  await rm(config.transcodesPath, { recursive: true, force: true })
}

/**
 * Реплики дорожки субтитров. Внешний файл читается целиком один раз,
 * встроенные копит перепаковка по ходу просмотра.
 */
export async function sessionCues(
  session: PlaybackSession,
  trackId: string,
): Promise<{ cues: Cue[], done: boolean } | undefined> {
  const index = Number(trackId.slice(1))

  if (trackId.startsWith('f')) {
    const subtitle = session.external.find(
      track => track.fileIndex === index,
    )

    if (!subtitle)
      return undefined

    const key = `${session.torrent.infoHash}:${index}`
    let cues = externalCues.get(key)

    if (!cues) {
      cues = loadExternalSubtitle(
        engineStreamUrl(session.torrent.infoHash, index),
        subtitle,
      )
      externalCues.set(key, cues)
      cues.catch(() => externalCues.delete(key))

      // Файлы субтитров маленькие, но раздач много: держим последние
      if (externalCues.size > EXTERNAL_CACHE_SIZE)
        externalCues.delete(externalCues.keys().next().value!)
    }

    return { cues: await cues, done: true }
  }

  const track = session.media?.subtitles.find(
    item => item.index === index && item.text,
  )

  if (!track)
    return undefined

  return {
    cues: session.hls ? await session.hls.cues(index) : [],
    done: !session.hls,
  }
}

/** Только для тестов */
export function sessionCount() {
  return sessions.size
}
