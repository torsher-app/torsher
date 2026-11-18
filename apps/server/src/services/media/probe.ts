import { execFile } from 'node:child_process'
import { config } from '../../config.ts'
import { untrustedInputArgs } from './inputSafety.ts'

export type Container = 'mp4' | 'webm' | 'mkv' | 'avi' | 'ts' | 'other'

/** Container family for timing and Cues; device support still distinguishes WebM and MKV. */
export function isMatroska(container: Container) {
  return container === 'mkv' || container === 'webm'
}

export interface StreamTiming {
  /** Signed timestamps in the source clock, before format start normalization. */
  startTime?: number
  duration?: number
}

export interface VideoStreamInfo extends StreamTiming {
  /** Decoder reorder delay reported by ffprobe; absent means unknown. */
  videoDelay?: number
  index: number
  codec: string
  profile: string | null
  width: number | null
  height: number | null
  /** 10 бит и выше: браузеры не играют H.264 High 10 */
  highBitDepth: boolean
  hdr: boolean
  /** Кадров в секунду; неизвестно — null */
  frameRate: number | null
  /** Чересстрочное: при перекодировании нужен деинтерлейс */
  interlaced: boolean
  /** бит/с видеопотока, без него — всего файла; неизвестно — null */
  bitrate: number | null
  /** Пропорции пикселя (SAR): у DVD и анаморфных рипов не 1 */
  pixelAspect: number
}

export interface AudioStreamInfo extends StreamTiming {
  index: number
  /** ISO 639-2 из тегов файла (`rus`, `eng`), `und` и пустое — null */
  language: string | null
  title: string | null
  codec: string
  channels: number | null
  /** бит/с */
  bitrate: number | null
  default: boolean
}

export interface SubtitleStreamInfo {
  index: number
  language: string | null
  title: string | null
  codec: string
  forced: boolean
  default: boolean
  /** Текстовые переводятся в WebVTT, графические (PGS, VobSub) — нет */
  text: boolean
  /** Графические: показываются только прожигом в кадр при перекодировании */
  image: boolean
}

export interface MediaInfo {
  /** Common source origin; HLS normalizes this to zero. */
  startTime?: number
  container: Container
  /** Секунды; у недокачанного файла без длительности в заголовке — null */
  duration: number | null
  video: VideoStreamInfo | null
  audio: AudioStreamInfo[]
  subtitles: SubtitleStreamInfo[]
  /**
   * Дата съёмки из тегов контейнера как есть: сначала QuickTime с зоной
   * (iPhone), затем `creation_time`, затем `date`. Нужна домашнему видео
   */
  created?: string | null
}

const TEXT_SUBTITLES = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'webvtt',
  'mov_text',
  'text',
])

const IMAGE_SUBTITLES = new Set([
  'hdmv_pgs_subtitle',
  'dvd_subtitle',
  'dvb_subtitle',
  'xsub',
])

const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])

interface ProbeStream {
  index: number
  start_time?: string
  duration?: string
  duration_ts?: number
  time_base?: string
  has_b_frames?: number
  codec_type?: string
  codec_name?: string
  profile?: string
  width?: number
  height?: number
  pix_fmt?: string
  bits_per_raw_sample?: string
  color_transfer?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  field_order?: string
  sample_aspect_ratio?: string
  channels?: number
  bit_rate?: string
  disposition?: Record<string, number>
  tags?: Record<string, string | undefined>
}

export interface ProbeOutput {
  streams?: ProbeStream[]
  format?: {
    start_time?: string
    format_name?: string
    duration?: string
    bit_rate?: string
    tags?: Record<string, string | undefined>
  }
}

const CREATED_TAGS = [
  'com.apple.quicktime.creationdate',
  'creation_time',
  'date',
]

function createdOf(output: ProbeOutput) {
  const tags = output.format?.tags ?? {}

  for (const name of CREATED_TAGS) {
    const value = tags[name] ?? tags[name.toUpperCase()]

    if (value)
      return value
  }

  return null
}

function tag(
  source: { tags?: Record<string, string | undefined> },
  name: string,
) {
  const tags = source.tags ?? {}
  const value = tags[name] ?? tags[name.toUpperCase()]

  return value?.trim() || null
}

/** Matroska may attach a language suffix to track statistics. Keep it for pairing. */
function languageTag(stream: ProbeStream, name: string) {
  const plain = tag(stream, name)
  if (plain)
    return { value: plain, suffix: '' }

  const key = Object.keys(stream.tags ?? {}).find(
    key =>
      key.toUpperCase().startsWith(`${name.toUpperCase()}-`)
      && tag(stream, key),
  )
  return key
    ? { value: tag(stream, key)!, suffix: key.slice(name.length) }
    : null
}

function languageOf(stream: ProbeStream) {
  const value = tag(stream, 'language')?.toLowerCase()

  return value && value !== 'und' ? value : null
}

function numberOf(value: string | number | undefined) {
  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function signedNumber(value: string | number | undefined) {
  if (value === undefined || value === '')
    return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function taggedDuration(
  stream: ProbeStream,
  start: number,
  muxer: string | null,
) {
  const duration = languageTag(stream, 'DURATION')
  if (!duration)
    return null
  const parts = duration.value.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/)
  if (!parts)
    return null
  const end
    = Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3])

  // Lavf rewrites the plain tag as an end timestamp, even when remuxing
  // old _STATISTICS_WRITING_APP and language-suffixed statistics unchanged.
  if (!duration.suffix && /^Lavf[\d.]*$/i.test(muxer ?? ''))
    return numberOf(end - start)
  const marker = tag(stream, `_STATISTICS_WRITING_APP${duration.suffix}`)
  if (!marker)
    return numberOf(end - start)
  const mkvmerge = /^mkvmerge\b/i.test(marker)
  const mkvToolNixMuxer = /^(?:mkvmerge\b|libebml\b.+\blibmatroska\b)/i.test(
    muxer ?? '',
  )
  return mkvmerge && (duration.suffix || mkvToolNixMuxer)
    ? numberOf(end)
    : null
}

function timingOf(
  stream: ProbeStream,
  origin: number | undefined,
  muxer: string | null,
): StreamTiming {
  const startTime = signedNumber(stream.start_time)
  const ticks = signedNumber(stream.duration_ts)
  const base = ratioOf(stream.time_base)
  const duration
    = numberOf(stream.duration)
      ?? (ticks !== undefined && base ? numberOf(ticks * base) : null)
      ?? taggedDuration(stream, startTime ?? origin ?? 0, muxer)
  return {
    ...(startTime !== undefined ? { startTime } : {}),
    ...(duration !== null ? { duration } : {}),
  }
}

/** Packet ends are absolute timestamps, indexed by ffprobe stream index. */
export type PacketEnds = ReadonlyMap<number, number>

/** Selected streams only; the raw cached probe remains selection-independent. */
export function hlsTiming(
  media: MediaInfo,
  audioIndex: number | null,
  packetEnds?: PacketEnds,
) {
  const origin = media.startTime ?? 0
  // Matroska's container duration can be an absolute end timestamp or include
  // other tracks; it is not evidence for a selected stream's relative end.
  const fallback = isMatroska(media.container) ? null : media.duration
  const endOf = (stream: (StreamTiming & { index: number }) | null) => {
    if (!stream)
      return fallback
    if (stream.duration !== undefined) {
      return Math.max(
        0,
        (stream.startTime ?? origin) + stream.duration - origin,
      )
    }
    const measured
      = media.startTime === undefined ? undefined : packetEnds?.get(stream.index)
    return measured !== undefined && measured > origin
      ? measured - origin
      : fallback
  }
  const videoEnd = endOf(media.video)
  const audio = media.audio.find(track => track.index === audioIndex)
  const audioEnd = audio ? endOf(audio) : 0
  return {
    videoEnd,
    duration:
      videoEnd !== null && audioEnd !== null
        ? Math.max(videoEnd, audioEnd)
        : fallback,
  }
}

// mkvmerge пишет битрейт в теги статистики (`BPS`, `BPS-eng`), а не в поле потока
function bitrateOf(stream: ProbeStream) {
  return (
    numberOf(stream.bit_rate)
    ?? numberOf(tag(stream, 'BPS') ?? undefined)
    ?? numberOf(tag(stream, 'BPS-eng') ?? undefined)
  )
}

// Название дорожки без служебных подписей контейнера
function titleOf(stream: ProbeStream) {
  const title = tag(stream, 'title')

  return title && !/^(?:sound|audio|video|subtitle)\s*handler$/i.test(title)
    ? title
    : null
}

function containerOf(formatName: string, fileName: string): Container {
  const extension = fileName.split('.').pop()?.toLowerCase()
  const formats = formatName.split(',')

  if (formats.includes('matroska'))
    return extension === 'webm' ? 'webm' : 'mkv'

  if (formats.includes('mp4') || formats.includes('mov'))
    return 'mp4'

  if (formats.includes('avi'))
    return 'avi'

  if (formats.includes('mpegts'))
    return 'ts'

  return 'other'
}

function isHighBitDepth(stream: ProbeStream) {
  return (
    Number(stream.bits_per_raw_sample) > 8
    || /p1[0-6](?:le|be)?$/.test(stream.pix_fmt ?? '')
  )
}

// `25/1`, `30000/1001`; `0/0` у потоков без частоты
function ratioOf(value: string | undefined) {
  const [num, den] = (value ?? '').split(/[/:]/).map(Number)

  return num && den ? num / den : null
}

// Прогрессивное и неизвестное не трогаем: `progressive`, `unknown`
const INTERLACED_ORDERS = new Set(['tt', 'bb', 'tb', 'bt'])

/** Вывод `ffprobe -show_format -show_streams` → то, что нужно решению и меню */
export function parseProbe(output: ProbeOutput, fileName: string): MediaInfo {
  const streams = output.streams ?? []
  const container = containerOf(output.format?.format_name ?? '', fileName)
  const startTime = signedNumber(output.format?.start_time)
  const matroska = isMatroska(container)
  const tagOrigin = matroska ? startTime : undefined
  const muxer = matroska ? tag(output.format ?? {}, 'encoder') : null
  // Обложки в MKV и MP4 приходят видеопотоком с `attached_pic`
  const video = streams.find(
    stream =>
      stream.codec_type === 'video' && !stream.disposition?.attached_pic,
  )

  return {
    container,
    duration: numberOf(output.format?.duration),
    ...(startTime !== undefined ? { startTime } : {}),
    created: createdOf(output),
    video: video
      ? {
          ...timingOf(video, tagOrigin, muxer),
          ...(video.has_b_frames !== undefined
            ? { videoDelay: video.has_b_frames }
            : {}),
          index: video.index,
          codec: video.codec_name ?? 'unknown',
          profile: video.profile ?? null,
          width: video.width ?? null,
          height: video.height ?? null,
          highBitDepth: isHighBitDepth(video),
          hdr: HDR_TRANSFERS.has(video.color_transfer ?? ''),
          frameRate:
            ratioOf(video.avg_frame_rate) ?? ratioOf(video.r_frame_rate),
          interlaced: INTERLACED_ORDERS.has(video.field_order ?? ''),
          bitrate: bitrateOf(video) ?? numberOf(output.format?.bit_rate),
          pixelAspect: ratioOf(video.sample_aspect_ratio) ?? 1,
        }
      : null,
    audio: streams
      .filter(stream => stream.codec_type === 'audio')
      .map(stream => ({
        ...timingOf(stream, tagOrigin, muxer),
        index: stream.index,
        language: languageOf(stream),
        title: titleOf(stream),
        codec: stream.codec_name ?? 'unknown',
        channels: stream.channels ?? null,
        bitrate: bitrateOf(stream),
        default: stream.disposition?.default === 1,
      })),
    subtitles: streams
      .filter(stream => stream.codec_type === 'subtitle')
      .map(stream => ({
        index: stream.index,
        language: languageOf(stream),
        title: titleOf(stream),
        codec: stream.codec_name ?? 'unknown',
        forced: stream.disposition?.forced === 1,
        default: stream.disposition?.default === 1,
        text: TEXT_SUBTITLES.has(stream.codec_name ?? ''),
        image: IMAGE_SUBTITLES.has(stream.codec_name ?? ''),
      })),
  }
}

// ffprobe читает начало файла (и индекс в конце у MP4): у свежей раздачи —
// пока движок не получит эти куски от пиров
const PROBE_TIMEOUT_MS = 120_000

export function probeArgs(url: string) {
  return [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    ...untrustedInputArgs(url),
    url,
  ]
}

function runProbe(url: string, signal?: AbortSignal) {
  return new Promise<ProbeOutput>((resolve, reject) => {
    execFile(
      config.ffprobePath,
      probeArgs(url),
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, signal },
      (err, stdout) => {
        if (err) {
          reject(err)
          return
        }

        try {
          resolve(JSON.parse(stdout) as ProbeOutput)
        }
        catch (parseError) {
          reject(parseError)
        }
      },
    )
  })
}

interface ProbePacket {
  stream_index: number
  pts_time?: string
  duration_time?: string
}

/** Measures only a structurally validated, bounded Matroska fragment. */
export function probePacketEnds(fragment: Uint8Array, signal: AbortSignal) {
  return new Promise<PacketEnds | null>((resolve) => {
    if (signal.aborted) {
      resolve(null)
      return
    }
    const child = execFile(
      config.ffprobePath,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'pipe',
        '-f',
        'matroska',
        '-show_packets',
        '-show_entries',
        'packet=stream_index,pts_time,duration_time',
        '-of',
        'json',
        'pipe:0',
      ],
      { signal, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err || stderr || signal.aborted) {
          resolve(null)
          return
        }
        try {
          const { packets } = JSON.parse(stdout) as { packets: ProbePacket[] }
          const ends = new Map<number, number>()
          const unknown = new Set<number>()
          for (const packet of packets) {
            const index = packet.stream_index
            const pts = signedNumber(packet.pts_time)
            const duration = numberOf(packet.duration_time)
            if (
              pts === undefined
              || duration === null
              || !Number.isFinite(pts + duration)
            ) {
              unknown.add(index)
            }
            else {
              ends.set(
                index,
                Math.max(ends.get(index) ?? -Infinity, pts + duration),
              )
            }
          }
          for (const index of unknown) ends.delete(index)
          resolve(ends.size ? ends : null)
        }
        catch {
          resolve(null)
        }
      },
    )
    child.stdin?.on('error', () => child.kill('SIGKILL'))
    child.stdin?.end(fragment)
  })
}

const CACHE_SIZE = 200
const cache = new Map<
  string,
  { promise: Promise<MediaInfo>, ready?: MediaInfo }
>()

/** Already completed exact-file probe only; never starts or waits for IO. */
export function peekMediaProbe(key: string) {
  return cache.get(key)?.ready
}

/**
 * Проба файла раздачи по потоку движка. Результат кэшируется на процесс:
 * повторный запуск файла обходится без ffprobe. Одинаковые запросы ждут одну
 * пробу; неудачная проба из кэша уходит.
 */
export function probeMedia(
  key: string,
  url: string,
  fileName: string,
  confirmRevision?: () => Promise<boolean>,
) {
  const cached = cache.get(key)

  if (cached) {
    // Свежий доступ поднимает запись в конец очереди вытеснения
    cache.delete(key)
    cache.set(key, cached)
    return cached.promise
  }

  const probe = runProbe(url).then(async (output) => {
    if (confirmRevision && !(await confirmRevision()))
      throw new Error('Media file changed during probe')
    return parseProbe(output, fileName)
  })

  const entry: { promise: Promise<MediaInfo>, ready?: MediaInfo } = {
    promise: probe,
  }
  cache.set(key, entry)
  void probe.then(
    (media) => {
      entry.ready = media
    },
    () => {
      if (cache.get(key) === entry)
        cache.delete(key)
    },
  )

  while (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value

    if (oldest === undefined)
      break
    cache.delete(oldest)
  }

  return probe
}

export function clearProbeCache() {
  cache.clear()
}
