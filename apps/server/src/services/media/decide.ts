import type {
  AudioStreamInfo,
  Container,
  MediaInfo,
  SubtitleStreamInfo,
} from './probe.ts'
import { parseAudioLabel } from '@torsher/release-parser'

/** Что умеет плеер клиента: его присылает витрина в `POST /playback` */
export interface DeviceProfile {
  containers: Container[]
  video: string[]
  audio: string[]
  /** Плеер сам переключает аудиодорожку файла (`audioTracks`) */
  audioTracks: boolean
  /** Плеер сам показывает встроенные текстовые субтитры файла */
  embeddedSubtitles: boolean
  /** Плеер играет HLS: hls.js на MSE или нативно */
  hls: boolean
}

/** Почему не прямое воспроизведение — в журнал, как причины транскода */
export type PlaybackReason
  = | 'ContainerNotSupported'
    | 'VideoCodecNotSupported'
    | 'VideoBitDepthNotSupported'
    | 'AudioCodecNotSupported'
    | 'AudioTrackSwitchNotSupported'
    | 'SubtitleCodecNotSupported'
    | 'HlsNotSupported'
    | 'ToolsMissing'
    | 'ProbeFailed'
    | 'DurationUnknown'

export interface PlaybackDecision {
  mode: 'direct' | 'hls'
  reasons: PlaybackReason[]
  /** В HLS: аудио копией или в AAC */
  audio: 'copy' | 'aac' | null
  /** Как менять озвучку: плеером на месте или перезапуском потока */
  audioSwitch: 'platform' | 'restart'
}

export interface DecisionInput {
  media: MediaInfo
  device: DeviceProfile
  /** Индекс потока выбранной озвучки; null — в файле нет звука */
  audioStream: number | null
  /** Выбраны встроенные субтитры: их надо показать */
  embeddedSubtitle: boolean
  toolsReady: boolean
}

// Что hls.js переносит из MPEG-TS без перекодирования; остальное — в AAC
const HLS_COPY_AUDIO = new Set(['aac', 'mp3', 'ac3'])

/** Дорожка, которая заиграет сама: с флагом `default`, иначе первая */
function naturalAudio(media: MediaInfo) {
  return (media.audio.find(track => track.default) ?? media.audio[0])?.index
}

/**
 * Прямое воспроизведение или перепаковка в HLS: напрямую, если плеер играет
 * контейнер, видео и выбранную озвучку и может её включить. Видео не перекодируем: если плеер его не играет, перепаковка
 * не поможет — пробуем напрямую и пишем причину.
 */
export function decidePlayback(input: DecisionInput): PlaybackDecision {
  const { media, device, audioStream, embeddedSubtitle, toolsReady } = input
  const audio = media.audio.find(track => track.index === audioStream)
  const video = media.video
  const reasons: PlaybackReason[] = []
  const audioSwitch = device.audioTracks ? 'platform' : 'restart'

  if (!device.containers.includes(media.container))
    reasons.push('ContainerNotSupported')

  if (audio && !device.audio.includes(audio.codec))
    reasons.push('AudioCodecNotSupported')

  if (audio && audio.index !== naturalAudio(media) && !device.audioTracks)
    reasons.push('AudioTrackSwitchNotSupported')

  if (embeddedSubtitle && !device.embeddedSubtitles)
    reasons.push('SubtitleCodecNotSupported')

  const videoReasons: PlaybackReason[] = []

  if (video && !device.video.includes(video.codec))
    videoReasons.push('VideoCodecNotSupported')
  else if (video?.codec === 'h264' && video.highBitDepth)
    videoReasons.push('VideoBitDepthNotSupported')

  if (reasons.length === 0)
    return { mode: 'direct', reasons: videoReasons, audio: null, audioSwitch }

  // Перепаковка видео не меняет: что не играет напрямую, не заиграет и так
  const blockers: PlaybackReason[] = [...videoReasons]

  if (!toolsReady)
    blockers.push('ToolsMissing')

  if (!device.hls)
    blockers.push('HlsNotSupported')

  if (blockers.length > 0) {
    return {
      mode: 'direct',
      reasons: [...reasons, ...blockers],
      audio: null,
      audioSwitch,
    }
  }

  return {
    mode: 'hls',
    reasons,
    audio:
      !audio
      || (HLS_COPY_AUDIO.has(audio.codec) && device.audio.includes(audio.codec))
        ? 'copy'
        : 'aac',
    // В потоке HLS одна озвучка: другая — новый поток
    audioSwitch: 'restart',
  }
}

/** Студия и тип озвучки из названия дорожки: «MVO LostFilm» → LostFilm */
export function voiceOfTrack(track: AudioStreamInfo) {
  return track.title ? parseAudioLabel(track.title) : undefined
}

export interface AudioPreference {
  /** Студия, выбранная для серии или закреплённая за сезоном */
  studio?: string | null
  /** Язык профиля в формате витрины (`ru_RU`) */
  locale?: string | null
}

// ISO 639-2 из тегов файла: и библиографический, и терминологический код
const LANGUAGE_CODES: Record<string, string[]> = {
  ru: ['rus', 'ru'],
  en: ['eng', 'en'],
  uk: ['ukr', 'uk'],
}

export function languageMatches(code: string | null, locale: string) {
  const language = locale.split('_')[0]?.toLowerCase() ?? ''

  return !!code && (LANGUAGE_CODES[language] ?? [language]).includes(code)
}

/**
 * Озвучка по умолчанию: выбранная в листе источников студия, иначе язык
 * профиля (среди них — с флагом `default`), иначе `default`, иначе первая.
 */
export function pickAudioStream(
  media: MediaInfo,
  preference: AudioPreference,
): number | null {
  const tracks = media.audio

  if (tracks.length === 0)
    return null

  const studio = preference.studio?.toLowerCase()

  if (studio) {
    const byStudio = tracks.find(
      track => voiceOfTrack(track)?.studio?.toLowerCase() === studio,
    )

    if (byStudio)
      return byStudio.index
  }

  const locale = preference.locale

  if (locale) {
    const inLanguage = tracks.filter(track =>
      languageMatches(track.language, locale),
    )
    const picked = inLanguage.find(track => track.default) ?? inLanguage[0]

    if (picked)
      return picked.index
  }

  return naturalAudio(media) ?? null
}

/** Субтитры, которые можно показать: текстовые встроенные */
export function textSubtitles(media: MediaInfo): SubtitleStreamInfo[] {
  return media.subtitles.filter(track => track.text)
}
