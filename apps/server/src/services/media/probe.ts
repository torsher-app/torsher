import { execFile } from 'node:child_process'
import { config } from '../../config.ts'

export type Container = 'mp4' | 'webm' | 'mkv' | 'avi' | 'ts' | 'other'

export interface VideoStreamInfo {
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

export interface AudioStreamInfo {
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

function tag(stream: ProbeStream, name: string) {
  const tags = stream.tags ?? {}
  const value = tags[name] ?? tags[name.toUpperCase()]

  return value?.trim() || null
}

function languageOf(stream: ProbeStream) {
  const value = tag(stream, 'language')?.toLowerCase()

  return value && value !== 'und' ? value : null
}

function numberOf(value: string | number | undefined) {
  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
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
  // Обложки в MKV и MP4 приходят видеопотоком с `attached_pic`
  const video = streams.find(
    stream =>
      stream.codec_type === 'video' && !stream.disposition?.attached_pic,
  )

  return {
    container: containerOf(output.format?.format_name ?? '', fileName),
    duration: numberOf(output.format?.duration),
    created: createdOf(output),
    video: video
      ? {
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

function runProbe(url: string, signal?: AbortSignal) {
  return new Promise<ProbeOutput>((resolve, reject) => {
    execFile(
      config.ffprobePath,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        url,
      ],
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

const CACHE_SIZE = 200
const cache = new Map<string, Promise<MediaInfo>>()

/**
 * Проба файла раздачи по потоку движка. Результат кэшируется на процесс:
 * повторный запуск файла обходится без ffprobe. Одинаковые запросы ждут одну
 * пробу; неудачная проба из кэша уходит.
 */
export function probeMedia(key: string, url: string, fileName: string) {
  const cached = cache.get(key)

  if (cached) {
    // Свежий доступ поднимает запись в конец очереди вытеснения
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }

  const probe = runProbe(url).then(output => parseProbe(output, fileName))

  cache.set(key, probe)
  probe.catch(() => cache.delete(key))

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
